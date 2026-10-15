#!/usr/bin/env node
/**
 * Parity harness: runs a fixed list of SAFE scenario prompts through the
 * panel API of a running dev server and prints what the agent did.
 *
 *   node scripts/parity-check.mjs [--base http://127.0.0.1:3116] [--budget 1.5] [--only a,c]
 *
 * Safety: every scenario is read-only or self-contained. The prompts say so
 * explicitly, RDP is status/profile listing only (never connect: the owner's
 * Windows PC is real), nothing is posted, sent or deleted, and every chat the
 * harness creates is deleted at the end. A run that pauses for approval or a
 * question is cancelled, not answered.
 *
 * Auth: an owner cookie is minted in-process (iron-session `sealData` with the
 * single users row, password = PANEL_SECRET_KEY, cookie `fd_session`), so no
 * password is typed anywhere.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { sealData } from "iron-session";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? "1" : (all[i + 1] ?? "1")]);
    return acc;
  }, []),
);
const BASE = args.base ?? "http://127.0.0.1:3116";
const BUDGET = Number(args.budget ?? 1.5);
const ONLY = args.only ? new Set(String(args.only).split(",")) : null;
const SCENARIO_TIMEOUT_MS = 240_000;

const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const SAFE =
  " This is a read-only check: do not post, send, delete, type passwords, or connect to RDP. Keep it short.";

/** id, prompt, model, mode, tools that must appear for a pass (any of). */
const SCENARIOS = [
  { id: "a", prompt: "Describe what's on the agent computer's screen.", model: SONNET, mode: "debug", expect: ["observe", "desktop_screenshot", "screen_text"] },
  { id: "b", prompt: "List files in ~/persist and tell me the 3 newest.", model: HAIKU, mode: "default", expect: ["list_files", "run_command"] },
  { id: "c", prompt: "Open https://example.com in the Linux browser and read the heading.", model: HAIKU, mode: "verbose", expect: ["browser_goto", "browser_text", "browser_snapshot", "open_browser"] },
  { id: "d", prompt: "Check RDP status and list RDP profiles. Do NOT connect.", model: HAIKU, mode: "default", expect: ["rdp_status", "rdp_profiles"], forbid: ["rdp_connect"] },
  { id: "e", prompt: "List saved workflows and schedules.", model: HAIKU, mode: "default", expect: ["workflow_list", "schedule_list"] },
  { id: "f", prompt: "Run `uname -a` and summarise.", model: SONNET, mode: "thinking", expect: ["run_command"] },
];

function loadEnv() {
  const env = {};
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function mintCookie(env) {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("select id, email from users order by created_at limit 2");
    if (rows.length !== 1) throw new Error(`expected exactly one users row, found ${rows.length}`);
    const sealed = await sealData(
      { userId: rows[0].id, email: rows[0].email, loggedInAt: Math.floor(Date.now() / 1000) },
      { password: env.PANEL_SECRET_KEY, ttl: 60 * 60 },
    );
    return `fd_session=${sealed}`;
  } finally {
    await client.end();
  }
}

function client(cookie) {
  return async function call(path, init = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { cookie, origin: BASE, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  };
}

/** Follows a run's SSE stream until a terminal frame or the timeout. */
async function follow(cookie, runId) {
  const out = { tools: [], ok: [], status: "timeout", cost: 0, tokensIn: 0, tokensOut: 0, cached: 0, text: "", thinking: "", debug: [], caps: null, error: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCENARIO_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/runs/${runId}/events`, { headers: { cookie }, signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
        if (!data) continue;
        let ev;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        switch (ev.type) {
          case "step_done":
            if (ev.step.type === "tool") {
              out.tools.push(ev.step.toolName);
              out.ok.push(ev.step.ok);
            }
            break;
          case "usage":
            Object.assign(out, { cost: ev.costUsd, tokensIn: ev.tokensIn, tokensOut: ev.tokensOut, cached: ev.cached });
            break;
          case "token":
            out.text += ev.text;
            break;
          case "thinking":
            out.thinking += ev.text;
            break;
          case "debug":
            out.debug.push(ev);
            break;
          case "capabilities":
            out.caps = ev;
            break;
          case "approval_required":
            out.status = "paused_approval";
            return out;
          case "done":
            out.status = ev.status;
            return out;
          case "error":
            out.status = "error";
            out.error = `${ev.code}: ${ev.message}`;
            return out;
        }
      }
    }
    return out;
  } catch (err) {
    if (!ctrl.signal.aborted) out.error = String(err);
    return out;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

async function main() {
  const env = loadEnv();
  const cookie = await mintCookie(env);
  const call = client(cookie);
  const rows = [];
  const created = [];
  let spent = 0;

  try {
    for (const s of SCENARIOS) {
      if (ONLY && !ONLY.has(s.id)) continue;
      if (spent >= BUDGET) {
        rows.push({ id: s.id, result: "SKIP (budget)" });
        continue;
      }
      const { chat } = await call("/api/chats", { method: "POST", body: "{}" });
      created.push(chat.id);
      const started = Date.now();
      const sent = await call(`/api/chats/${chat.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: s.prompt + SAFE, model: s.model, mode: s.mode, capabilitiesAuto: true }),
      });
      const r = await follow(cookie, sent.runId);
      if (r.status !== "done" && r.status !== "error" && r.status !== "cancelled") {
        await call(`/api/runs/${sent.runId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
      }
      spent += r.cost;
      const used = new Set(r.tools);
      const forbidden = (s.forbid ?? []).filter((t) => used.has(t));
      const pass = r.status === "done" && s.expect.some((t) => used.has(t)) && forbidden.length === 0;
      const ctx = r.debug.find((d) => d.kind === "context")?.data;
      rows.push({
        id: s.id,
        result: pass ? "PASS" : "FAIL",
        model: s.model.split("/")[1],
        mode: s.mode,
        status: r.status,
        steps: r.tools.length,
        failed: r.ok.filter((o) => o === false).length,
        tools: [...used].join(" "),
        auto: r.caps ? (r.caps.chosen.join("+") || "all") : "-",
        tokIn: r.tokensIn,
        cached: r.cached,
        tokOut: r.tokensOut,
        cost: r.cost.toFixed(4),
        secs: Math.round((Date.now() - started) / 1000),
        notes: [
          r.error,
          forbidden.length ? `forbidden: ${forbidden.join(",")}` : null,
          s.mode === "thinking" ? `reasoning ${r.thinking.length} chars` : null,
          ctx ? `debug: ${ctx.toolCount} tools, ~${ctx.schemaTokens} schema tok, guide=${ctx.guideSource}, ${r.debug.length} frames` : null,
        ].filter(Boolean).join("; "),
        answer: r.text.replace(/\s+/g, " ").slice(0, 160),
      });
    }
  } finally {
    for (const id of created) {
      await call(`/api/chats/${id}`, { method: "DELETE" }).catch((e) => console.error("cleanup failed", id, String(e)));
    }
  }

  console.table(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "answer"))));
  for (const r of rows) if (r.answer) console.log(`(${r.id}) ${r.answer}`);
  console.log(`total spend $${spent.toFixed(4)} of $${BUDGET} budget; ${created.length} chats created and deleted`);
  process.exitCode = rows.every((r) => r.result !== "FAIL") ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});
