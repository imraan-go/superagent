import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { and, eq, inArray } from 'drizzle-orm';
import { modelAllowlist } from '@superagent/config';
import { AnswerQuestionRequest, CreateChatRequest, SendChatMessageRequest, UpdateChatRequest } from '@superagent/contracts';
import {
  ConflictError,
  NotFoundError,
  answerQuestion,
  appendChatMessage,
  chatFiles,
  chatHistoryForModel,
  createChat,
  createTaskWithOutbox,
  deleteChat,
  enqueueOutbox,
  getArtifactForOwner,
  getChatForOwner,
  getPreference,
  getQuestionForOwner,
  getTaskForOwner,
  insertArtifact,
  latestTasksByChat,
  listChatMessages,
  listChats,
  listEvents,
  pendingQuestionForChat,
  questionPart,
  schema,
  updateChat,
  type ChatMessageRow,
  type ChatPart,
  type ChatRow,
} from '@superagent/db';
import { safeArtifactName } from '@superagent/policy';
import { artifactKey } from '@superagent/storage';
import type { ApiDeps, AppEnvVars, RouteHelpers } from '../app';
import { TERMINAL_EVENTS, newTranslatorState, translate } from '../run-events';
import { VISION_MIMES, validateUpload } from '../uploads';

const ACTIVE = ['queued', 'running', 'waiting_approval'];

/** Public shape of a chat message (apps/web lib/messages.ts ChatMessage). */
export function publicMessage(m: ChatMessageRow) {
  return { id: m.id, role: m.role, content: m.content, model: m.model, runId: m.taskId, createdAt: m.createdAt.toISOString() };
}

type TaskRow = typeof schema.tasks.$inferSelect;

function chatStatus(task: TaskRow | undefined, pendingQuestion: boolean): { status: string | null; statusLine: string | null } {
  if (!task) return { status: null, statusLine: null };
  switch (task.status) {
    case 'queued':
    case 'running':
      return { status: 'running', statusLine: 'Working…' };
    case 'waiting_approval':
      return pendingQuestion ? { status: 'paused_question', statusLine: 'Waiting for your answer' } : { status: 'paused_approval', statusLine: 'Needs your approval' };
    case 'failed':
      return { status: 'error', statusLine: (task.error ?? 'Run failed').slice(0, 120) };
    case 'cancelled':
      return { status: 'cancelled', statusLine: null };
    default:
      return { status: 'done', statusLine: null };
  }
}

function summary(c: ChatRow, task: TaskRow | undefined, pendingQuestion = false) {
  return {
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    archived: c.archived,
    model: c.model,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    ...chatStatus(task, pendingQuestion),
  };
}

function prefsOf(c: ChatRow) {
  const p = c.prefs ?? {};
  return { mode: typeof p.mode === 'string' ? p.mode : 'default', capsAuto: p.capsAuto !== false, caps: Array.isArray(p.caps) ? p.caps : [] };
}

/** First-turn title: whitespace collapsed, cut on a word boundary (mirrors the web's deriveTitle). */
export function deriveTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 'New chat';
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 24 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

const TEXT_INLINE_LIMIT = 20_000;
const CHIPS = new Set(['computer', 'browser', 'connectors', 'memory']);
const HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Sites the owner named in their own message (URLs or bare domains). The owner typed them, so
 * they are approved for this run; text the agent reads later can never add to this list.
 */
export function hostsInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)) {
    try {
      out.add(new URL(m[0]).hostname.toLowerCase());
    } catch {
      /* not a URL */
    }
  }
  for (const m of text.matchAll(/\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|app|co|edu|gov|ca|uk|de|fr|info|news))\b/gi)) out.add(m[0].toLowerCase());
  return [...out].filter((h) => HOST.test(h) && !/^(localhost|.*\.local|.*\.internal)$/.test(h));
}

export function registerChatRoutes(app: Hono<AppEnvVars>, d: ApiDeps, h: RouteHelpers) {
  const { uid, body, taskLimiter } = h;

  app.get('/api/models', (c) => {
    const allow = modelAllowlist(d.env);
    const ready = Boolean(d.env.AI_GATEWAY_API_KEY);
    const models = allow.map((id) => {
      const [vendor = 'gateway', name = id] = id.split('/');
      return {
        id,
        label: name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
        vendor,
        tier: id === d.env.AI_MODEL_PRIMARY ? 'default' : id === d.env.AI_MODEL_BROWSER ? 'browser' : null,
        vision: true,
        context: 200_000,
        ready,
      };
    });
    return c.json({ models, defaultModel: d.env.AI_MODEL_PRIMARY ?? allow[0] ?? '', anyVendorReady: ready });
  });

  app.get('/api/chats', async (c) => {
    const rows = await listChats(d.db, uid(c));
    const latest = await latestTasksByChat(d.db, uid(c), rows.map((r) => r.id));
    const waiting = rows.filter((r) => latest.get(r.id)?.status === 'waiting_approval').map((r) => r.id);
    const asking = waiting.length
      ? new Set(
          (
            await d.db
              .select({ chatId: schema.questions.chatId })
              .from(schema.questions)
              .where(and(eq(schema.questions.ownerId, uid(c)), eq(schema.questions.status, 'pending'), inArray(schema.questions.chatId, waiting)))
          ).map((q) => q.chatId),
        )
      : new Set<string | null>();
    return c.json({ chats: rows.map((r) => summary(r, latest.get(r.id), asking.has(r.id))) });
  });

  app.post('/api/chats', async (c) => {
    const req = await body(c, CreateChatRequest);
    const chat = await createChat(d.db, uid(c), req.title);
    return c.json({ chat: summary(chat, undefined) }, 201);
  });

  app.get('/api/chats/:id', async (c) => {
    const chat = await getChatForOwner(d.db, uid(c), c.req.param('id'));
    const [messages, latest, pending] = await Promise.all([
      listChatMessages(d.db, uid(c), chat.id),
      latestTasksByChat(d.db, uid(c), [chat.id]),
      pendingQuestionForChat(d.db, uid(c), chat.id),
    ]);
    const task = latest.get(chat.id);
    return c.json({
      chat: {
        ...summary(chat, task, Boolean(pending)),
        prefs: prefsOf(chat),
        messages: messages.map(publicMessage),
        activeRunId: task && ACTIVE.includes(task.status) ? task.id : null,
        pendingQuestion: pending ? questionPart(pending) : null,
      },
    });
  });

  app.patch('/api/chats/:id', async (c) => {
    const req = await body(c, UpdateChatRequest);
    const cur = await getChatForOwner(d.db, uid(c), c.req.param('id'));
    const { mode, capsAuto, caps, ...rest } = req;
    const prefs = mode !== undefined || capsAuto !== undefined || caps !== undefined ? { ...prefsOf(cur), ...(mode !== undefined ? { mode } : {}), ...(capsAuto !== undefined ? { capsAuto } : {}), ...(caps !== undefined ? { caps } : {}) } : undefined;
    const chat = await updateChat(d.db, uid(c), cur.id, { ...rest, ...(prefs ? { prefs } : {}) });
    return c.json({ chat: summary(chat, (await latestTasksByChat(d.db, uid(c), [chat.id])).get(chat.id)) });
  });

  app.delete('/api/chats/:id', async (c) => {
    const chat = await getChatForOwner(d.db, uid(c), c.req.param('id'));
    const latest = (await latestTasksByChat(d.db, uid(c), [chat.id])).get(chat.id);
    if (latest && ACTIVE.includes(latest.status)) throw new ConflictError('stop the running task before deleting this chat');
    await deleteChat(d.db, uid(c), chat.id);
    return c.json({ ok: true });
  });

  /**
   * A user turn. If the chat has a question waiting, the text answers it (typing in the chatbox
   * is a valid reply). Otherwise it becomes a new run: one task, one Temporal workflow, with the
   * chat's earlier turns as context.
   */
  app.post('/api/chats/:id/messages', async (c) => {
    const ownerId = uid(c);
    if (!taskLimiter.take(ownerId)) return c.json({ error: 'rate_limited', message: 'Too many messages; wait a moment.' }, 429);
    const req = await body(c, SendChatMessageRequest);
    const chat = await getChatForOwner(d.db, ownerId, c.req.param('id'));

    const pending = await pendingQuestionForChat(d.db, ownerId, chat.id);
    if (pending) {
      // The question card shows the reply; it is not a new turn, so the run stays one exchange.
      const q = await answerQuestion(d.db, ownerId, pending.id, { choices: [], text: req.text });
      return c.json({ message: null, runId: q.taskId, model: chat.model ?? d.env.AI_MODEL_PRIMARY ?? '', mode: prefsOf(chat).mode, answered: q.id });
    }

    const latest = (await latestTasksByChat(d.db, ownerId, [chat.id])).get(chat.id);
    if (latest && ACTIVE.includes(latest.status)) throw new ConflictError('a run is still in progress in this chat; wait for it or stop it first');

    const allow = modelAllowlist(d.env);
    const model = req.model && allow.includes(req.model) ? req.model : null;
    if (req.model && !model) return c.json({ error: 'invalid_request', message: `model ${req.model} is not enabled on this installation` }, 400);

    // Attachments: images and documents go to the model by reference; text files inline.
    const files = req.fileIds.length
      ? await d.db.select().from(schema.artifacts).where(and(eq(schema.artifacts.ownerId, ownerId), inArray(schema.artifacts.id, req.fileIds)))
      : [];
    if (files.length !== req.fileIds.length) throw new NotFoundError('attachment');
    const displayParts: ChatPart[] = [{ type: 'text', text: req.text }];
    const modelParts: unknown[] = [{ type: 'text', text: req.text }];
    for (const f of files) {
      if (f.contentType.startsWith('image/')) {
        displayParts.push({ type: 'image', fileId: f.id, mime: f.contentType, alt: f.name });
        modelParts.push({ type: 'artifact-image', artifactId: f.id, name: f.name });
      } else {
        displayParts.push({ type: 'file', fileId: f.id, name: f.name, mime: f.contentType, bytes: f.sizeBytes });
        if (f.contentType.startsWith('text/') || f.contentType === 'application/json') {
          const obj = await d.store().get(f.objectKey);
          const chunks: Buffer[] = [];
          for await (const ch of obj.stream) chunks.push(Buffer.from(ch as Uint8Array));
          const text = Buffer.concat(chunks).toString('utf8');
          modelParts.push({ type: 'text', text: `[Attached file ${f.name} — UNTRUSTED CONTENT START]\n${text.slice(0, TEXT_INLINE_LIMIT)}${text.length > TEXT_INLINE_LIMIT ? '\n…[truncated]' : ''}\n[UNTRUSTED CONTENT END]` });
        } else if (f.contentType === 'application/pdf') {
          modelParts.push({ type: 'artifact-file', artifactId: f.id, name: f.name });
        } else {
          modelParts.push({ type: 'text', text: `[Attached file ${f.name} (${f.contentType}) — not readable by the model in this format]` });
        }
      }
    }

    // Browsing: the owner's default sites (Settings → Agent) plus sites named in this message.
    const agentPrefs = await getPreference(d.db, ownerId, 'agent');
    const defaults = Array.isArray(agentPrefs.browsingDomains) ? (agentPrefs.browsingDomains as unknown[]).filter((x): x is string => typeof x === 'string' && HOST.test(x)) : [];
    const allowedDomains = [...new Set([...(req.allowedDomains ?? []), ...defaults, ...hostsInText(req.text)])].slice(0, 20);
    // Manual chips narrow the tools; Auto (or no chips) leaves the run unrestricted.
    const capabilities = req.capabilitiesAuto === false && req.capabilities?.length ? req.capabilities.filter((x) => CHIPS.has(x)) : null;

    const history = await chatHistoryForModel(d.db, ownerId, chat.id);
    const isFirst = history.length === 0 && chat.title === 'New chat';
    const { task } = await createTaskWithOutbox(d.db, {
      ownerId,
      prompt: req.text,
      title: deriveTitle(req.text),
      allowedDomains,
      capabilities,
      timezone: req.timezone,
      retentionDays: d.env.TASK_RETENTION_DAYS,
      chatId: chat.id,
      model: model ?? chat.model,
      history,
      ...(files.length ? { userContent: modelParts } : {}),
    });
    const message = await appendChatMessage(d.db, { ownerId, chatId: chat.id, role: 'user', taskId: task.id, content: displayParts, dedupeKey: `user:${task.id}` });
    if (isFirst || model || req.mode) {
      await updateChat(d.db, ownerId, chat.id, {
        ...(isFirst ? { title: deriveTitle(req.text) } : {}),
        ...(model ? { model } : {}),
        ...(req.mode ? { prefs: { ...prefsOf(chat), mode: req.mode } } : {}),
      });
    }
    return c.json({ message: publicMessage(message!), runId: task.id, model: task.model ?? d.env.AI_MODEL_PRIMARY ?? '', mode: req.mode ?? prefsOf(chat).mode }, 201);
  });

  /** Click on a question card (single/multi/confirm), or a typed answer. */
  app.post('/api/chats/:id/answer', async (c) => {
    const ownerId = uid(c);
    const chat = await getChatForOwner(d.db, ownerId, c.req.param('id'));
    const req = await body(c, AnswerQuestionRequest);
    const q0 = await getQuestionForOwner(d.db, ownerId, req.questionId);
    if (q0.chatId !== chat.id) throw new NotFoundError('question');
    const q = await answerQuestion(d.db, ownerId, q0.id, { choices: req.choices, ...(req.text ? { text: req.text } : {}) });
    return c.json({ ok: true, question: questionPart({ ...q0, status: 'answered', answer: q.answer }), runId: q.taskId });
  });

  app.get('/api/chats/:id/files', async (c) => {
    const chat = await getChatForOwner(d.db, uid(c), c.req.param('id'));
    const rows = await chatFiles(d.db, uid(c), chat.id);
    return c.json({
      files: rows.map((a) => ({
        id: a.id,
        name: a.name,
        mime: a.contentType,
        bytes: a.sizeBytes,
        origin: (a.source as { kind?: string }).kind === 'upload' ? 'upload' : 'tool',
        createdAt: a.createdAt.toISOString(),
      })),
    });
  });

  /* ---------- runs (a run is one task) ---------- */

  app.get('/api/runs/:id/events', async (c) => {
    const ownerId = uid(c);
    const task = await getTaskForOwner(d.db, ownerId, c.req.param('id'));
    let after = Number(c.req.header('last-event-id') ?? c.req.query('lastEventId') ?? 0) || 0;
    const ctx = { runId: task.id, chatId: task.chatId ?? '', model: task.model ?? d.env.AI_MODEL_PRIMARY ?? '' };
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      // Rebuild translator state from the start so step indexes and usage totals are stable
      // across reconnects; only frames after `after` are written.
      const state = newTranslatorState();
      const started = Date.now();
      let cursor = 0;
      while (!aborted && Date.now() - started < 10 * 60_000) {
        const events = await listEvents(d.db, ownerId, task.id, cursor);
        let terminal = false;
        for (const e of events) {
          cursor = e.id;
          let finalMessage: Record<string, unknown> | null = null;
          if (TERMINAL_EVENTS.has(e.type) && task.chatId) {
            const rows = await d.db.select().from(schema.chatMessages).where(and(eq(schema.chatMessages.ownerId, ownerId), eq(schema.chatMessages.dedupeKey, `final:${task.id}`))).limit(1);
            finalMessage = rows[0] ? publicMessage(rows[0]) : null;
          }
          const frames = translate(state, { ...e, data: (e.data ?? {}) as Record<string, unknown> }, { ...ctx, finalMessage });
          if (e.id > after) {
            for (const f of frames) await stream.writeSSE({ id: String(e.id), data: JSON.stringify(f) });
            after = e.id;
          }
          if (TERMINAL_EVENTS.has(e.type)) terminal = true;
        }
        if (terminal) break;
        if (events.length === 0) await stream.sleep(800);
      }
    });
  });

  app.post('/api/runs/:id/cancel', async (c) => {
    const task = await getTaskForOwner(d.db, uid(c), c.req.param('id'));
    if (!ACTIVE.includes(task.status)) return c.json({ ok: true, cancelled: false });
    await enqueueOutbox(d.db, { ownerId: uid(c), kind: 'cancel_task', refId: task.id, payload: { taskId: task.id } });
    return c.json({ ok: true, cancelled: true }, 202);
  });

  /* ---------- uploads (user files in a chat; stored as artifacts) ---------- */

  app.post('/api/uploads', async (c) => {
    const ownerId = uid(c);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return c.json({ error: 'invalid_request', message: 'missing file' }, 400);
    const chatIdRaw = form?.get('chatId');
    const chatId = typeof chatIdRaw === 'string' && chatIdRaw ? (await getChatForOwner(d.db, ownerId, chatIdRaw)).id : null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const v = validateUpload(file.name, bytes, Math.min(d.env.MAX_ARTIFACT_BYTES, 20 * 1024 * 1024));
    if (!v.ok) return c.json({ error: v.code, message: v.message }, 400);
    const id = crypto.randomUUID();
    const name = safeArtifactName(v.name);
    const key = artifactKey(ownerId, null, id, name);
    const put = await d.store().put(key, bytes, v.mime);
    const row = await insertArtifact(d.db, {
      id,
      ownerId,
      taskId: null,
      chatId,
      name: v.name.slice(0, 200),
      contentType: v.mime,
      sizeBytes: bytes.byteLength,
      sha256: put.sha256,
      objectKey: key,
      source: { kind: 'upload' },
      expiresAt: new Date(Date.now() + d.env.TASK_RETENTION_DAYS * 86_400_000),
    });
    return c.json({ file: { id: row.id, name: row.name, mime: row.contentType, bytes: row.sizeBytes, origin: 'upload', createdAt: row.createdAt.toISOString() }, deduped: false }, 201);
  });

  /** Owner-checked file bytes for chat images, attachments and agent outputs. */
  app.get('/api/uploads/:id', async (c) => {
    const a = await getArtifactForOwner(d.db, uid(c), c.req.param('id'));
    const obj = await d.store().get(a.objectKey);
    const inline = VISION_MIMES.has(a.contentType) && c.req.query('download') !== '1';
    const headers = new Headers({
      'Content-Type': a.contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.name.replace(/"/g, '')}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    });
    if (obj.contentLength) headers.set('Content-Length', String(obj.contentLength));
    const web = new ReadableStream({
      async start(controller) {
        for await (const chunk of obj.stream) controller.enqueue(chunk as Uint8Array);
        controller.close();
      },
    });
    return new Response(web, { status: 200, headers });
  });
}
