/**
 * Groups a flat transcript into exchanges: one owner turn plus everything the
 * agent did in reply (narration, tool calls, results, the final answer).
 * Pure module so the grouping is unit-tested.
 */
import type { ChatMessage, MessagePart, QuestionPart, ToolResultPart, ToolUsePart } from '@/lib/messages';
import type { RunStepView } from '@/lib/run-events';

export interface TraceItem {
  key: string;
  kind: 'thought' | 'tool' | 'approval';
  toolName: string | null;
  args: Record<string, unknown> | null;
  /** null while running. */
  ok: boolean | null;
  ms: number | null;
  /** Result text (already redacted server-side) or the narration. */
  detail: string | null;
  images: string[];
}

export interface Exchange {
  key: string;
  user: ChatMessage | null;
  runId: string | null;
  model: string | null;
  trace: TraceItem[];
  /** The agent's answer text (last text-only assistant turn). */
  answer: string;
  /** Summarised reasoning from Thinking mode, joined across the run's turns. */
  reasoning: string;
  /** Timestamp of the first and last agent turns, for a latency readout. */
  startedAt: string | null;
  endedAt: string | null;
  /** Questions the agent asked during this run, in order. */
  questions: QuestionPart[];
  /** A system note (e.g. "Routine … is running") shown as its own line. */
  note?: string;
}

function textOf(parts: MessagePart[]): string {
  return parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n')
    .trim();
}

export function groupExchanges(messages: readonly ChatMessage[]): Exchange[] {
  const out: Exchange[] = [];
  let cur: Exchange | null = null;
  const pending = new Map<string, TraceItem>();

  const open = (user: ChatMessage | null, key: string): Exchange => {
    const ex: Exchange = {
      key,
      user,
      // The owner's turn already names its run, so a run waiting on approval is placeable.
      runId: user?.runId ?? null,
      model: null,
      trace: [],
      answer: '',
      reasoning: '',
      startedAt: null,
      endedAt: null,
      questions: [],
    };
    out.push(ex);
    return ex;
  };

  for (const m of messages) {
    if (m.role === 'system') {
      const note = textOf(m.content);
      if (note) {
        const ex = open(null, `note-${m.id}`);
        ex.note = note;
        ex.runId = m.runId;
        // A routine's run follows its note, so the next agent turn opens its own exchange.
        cur = null;
      }
      continue;
    }
    if (m.role === 'user') {
      cur = open(m, m.id);
      continue;
    }
    cur ??= open(null, `lead-${m.id}`);
    cur.runId ??= m.runId;
    if (m.model) cur.model = m.model;
    cur.startedAt ??= m.createdAt;
    cur.endedAt = m.createdAt;

    if (m.role === 'assistant' && m.content.some((p) => p.type === 'tool_result' || p.type === 'question')) {
      // One persisted turn for a whole run: trace (calls, results, questions) in order, then the answer.
      for (const p of m.content) {
        if (p.type === 'question') cur.questions.push(p);
        else if (p.type === 'tool_use') {
          const item: TraceItem = {
            key: p.id,
            kind: 'tool',
            toolName: p.name,
            args: p.args,
            ok: null,
            ms: null,
            detail: null,
            images: [],
          };
          pending.set(p.id, item);
          cur.trace.push(item);
        } else if (p.type === 'tool_result') {
          const item = pending.get(p.toolUseId);
          if (item) {
            item.ok = p.ok;
            item.ms = p.ms ?? null;
            item.detail = p.text || null;
            item.images = p.images;
          }
        } else if (p.type === 'thinking' && p.text.trim()) {
          cur.reasoning = cur.reasoning ? `${cur.reasoning}\n\n${p.text.trim()}` : p.text.trim();
        }
      }
      const text = textOf(m.content);
      if (text) cur.answer = text;
      continue;
    }

    if (m.role === 'assistant') {
      const thought = m.content
        .flatMap((p) => (p.type === 'thinking' ? [p.text.trim()] : []))
        .filter(Boolean)
        .join('\n\n');
      if (thought) cur.reasoning = cur.reasoning ? `${cur.reasoning}\n\n${thought}` : thought;
      const uses = m.content.filter((p): p is ToolUsePart => p.type === 'tool_use');
      const text = textOf(m.content);
      if (uses.length > 0) {
        // Narration before a tool call is part of the trace, not the answer.
        if (text) {
          cur.trace.push({
            key: `${m.id}-t`,
            kind: 'thought',
            toolName: null,
            args: null,
            ok: true,
            ms: null,
            detail: text,
            images: [],
          });
        }
        for (const u of uses) {
          const item: TraceItem = {
            key: u.id,
            kind: 'tool',
            toolName: u.name,
            args: u.args,
            ok: null,
            ms: null,
            detail: null,
            images: [],
          };
          pending.set(u.id, item);
          cur.trace.push(item);
        }
      } else if (text) {
        // A text-only turn after earlier text: keep the earlier one as narration.
        if (cur.answer) {
          cur.trace.push({
            key: `${m.id}-p`,
            kind: 'thought',
            toolName: null,
            args: null,
            ok: true,
            ms: null,
            detail: cur.answer,
            images: [],
          });
        }
        cur.answer = text;
      }
    } else if (m.role === 'tool') {
      for (const r of m.content.filter((p): p is ToolResultPart => p.type === 'tool_result')) {
        const item = pending.get(r.toolUseId);
        if (item) {
          item.ok = r.ok;
          item.ms = r.ms ?? null;
          item.detail = r.text || null;
          item.images = r.images;
        } else {
          cur.trace.push({
            key: r.toolUseId,
            kind: 'tool',
            toolName: r.name,
            args: null,
            ok: r.ok,
            ms: r.ms ?? null,
            detail: r.text || null,
            images: r.images,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Overlays the live run's steps on the persisted trace. Persisted rows carry
 * narration and arguments; the stream carries steps that have not been
 * persisted yet (the one running now). Steps are joined to persisted calls by
 * the n-th call of the same tool name; unmatched steps are appended.
 */
export function liveTrace(steps: readonly RunStepView[], persisted: readonly TraceItem[]): TraceItem[] {
  const out = persisted.map((t) => ({ ...t }));
  const byName = new Map<string, TraceItem[]>();
  for (const t of out) {
    if (t.kind !== 'tool' || !t.toolName) continue;
    const list = byName.get(t.toolName) ?? [];
    list.push(t);
    byName.set(t.toolName, list);
  }
  const seen = new Map<string, number>();
  for (const s of steps) {
    if (s.type !== 'tool' && s.type !== 'approval') continue;
    const name = s.toolName ?? '';
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    const match = s.type === 'tool' ? byName.get(name)?.[n] : undefined;
    if (match) {
      match.ok ??= s.ok;
      match.ms ??= s.ms;
      if (match.images.length === 0 && s.images?.length) match.images = s.images;
      match.detail ??= s.preview ?? null;
      continue;
    }
    out.push({
      key: `live-${s.idx}`,
      kind: s.type === 'approval' ? 'approval' : 'tool',
      toolName: s.toolName,
      args: null,
      ok: s.ok,
      ms: s.ms,
      detail: s.preview ?? null,
      images: s.images ?? [],
    });
  }
  return out;
}
