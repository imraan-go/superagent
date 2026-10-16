"use client";

import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { CaretRight, ChatCenteredDots, Monitor, ShieldWarning } from "@phosphor-icons/react/dist/ssr";
import { CategoryTile, Dot, LiveGlyph } from "@/components/ui";
import { AppLogo } from "@/components/apps/app-logo";
import { openApps } from "@/lib/app-events";
import { composioToolkitOf, titleCase } from "@/lib/apps";
import type { LiveGlyphState } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { TraceItem } from "./exchanges";
import { formatMs, toolCategory, toolTitle, traceSummary } from "./tool-meta";
import type { ToolCategory } from "./tool-meta";
import styles from "./run-trace.module.css";

/** The rail listens for this and brings its "Waiting on you" card into view. */
export const FOCUS_WAITING_EVENT = "fd:focus-waiting";

/** Backtick spans in a title become inline code. */
function renderTitle(title: string): ReactNode {
  return title.split(/(`[^`]+`)/g).map((chunk, i) =>
    chunk.startsWith("`") && chunk.endsWith("`") && chunk.length > 1 ? (
      <code key={i}>{chunk.slice(1, -1)}</code>
    ) : (
      <Fragment key={i}>{chunk}</Fragment>
    ),
  );
}

export interface RunTraceProps {
  items: TraceItem[];
  /** True while this trace belongs to the run that is still going. */
  live: boolean;
  /** Present-participle line from the run stream ("Clicking around"). */
  activity?: string | null;
  phase?: string;
  approval?: { tool: string; reason: string } | null;
  /** Verbose/Debug modes: stay expanded after the run settles. */
  keepOpen?: boolean;
  /** Verbose/Debug modes: show each step's arguments and result inline. */
  expandSteps?: boolean;
}

/**
 * The run timeline inside an assistant turn. Open while the agent works; folds
 * to a one-line summary once the answer lands. The header doubles as the
 * activity line (DESIGN_SYSTEM §Signature elements) — the polite live region
 * in ChatView already announces transitions, so nothing here is aria-live.
 */
export function RunTrace({ items, live, activity, phase, approval, keepOpen = false, expandSteps = false }: RunTraceProps) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? (live || Boolean(approval) || keepOpen);
  const tools = items.filter((i) => i.kind !== "thought");
  if (!live && items.length === 0) return null;

  const glyph: LiveGlyphState = approval
    ? "approval"
    : !live
      ? tools.some((t) => t.ok === false)
        ? "error"
        : "done"
      : phase === "tool" || phase === "waiting"
        ? "tool"
        : "thinking";

  const totalMs = tools.reduce((n, t) => n + (t.ms ?? 0), 0);
  const headline = live
    ? (activity ?? "Working")
    : traceSummary(tools.map((t) => ({ toolName: t.toolName, ms: t.ms })));
  const expandable = items.length > 0 || Boolean(approval);
  // Distinct categories in first-use order — the folded summary shows them as a tile stack.
  const cats: ToolCategory[] = [];
  for (const t of tools) {
    const c = toolCategory(t.toolName);
    if (!cats.includes(c)) cats.push(c);
  }

  return (
    <section
      className={cn(styles.trace, live && styles.live, open && styles.open)}
      data-phase={glyph}
      aria-label="Run trace"
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOverride(!open)}
      >
        <LiveGlyph state={glyph} size={16} label="" />
        {!live && cats.length > 0 && (
          <span className={styles.stack} aria-hidden>
            {cats.slice(0, 4).map((c) => (
              <CategoryTile key={c} cat={c} size="xs" />
            ))}
          </span>
        )}
        <span className={styles.headline}>{headline}</span>
        {live && <span className={styles.dots} aria-hidden><i /><i /><i /></span>}
        <span className={styles.meta}>
          {live && tools.length > 0 && <span>{tools.length} step{tools.length === 1 ? "" : "s"}</span>}
          {live && totalMs > 0 && <span>{formatMs(totalMs)}</span>}
        </span>
        {expandable && <CaretRight size={11} weight="bold" className={styles.caret} aria-hidden />}
      </button>

      {open && expandable && (
        <ol className={styles.steps}>
          {items.map((item, i) => (
            <Step key={item.key} item={item} index={i} defaultOpen={expandSteps} />
          ))}
          {approval && <ApprovalCard tool={approval.tool} reason={approval.reason} />}
        </ol>
      )}
    </section>
  );
}

function Step({
  item,
  index,
  defaultOpen = false,
}: {
  item: TraceItem;
  index: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (item.kind === "thought") {
    return (
      <li className={cn(styles.step, styles.thought)} style={{ "--i": index } as React.CSSProperties}>
        <span className={styles.rail} aria-hidden>
          <CategoryTile cat="think" size="sm" icon={ChatCenteredDots} />
        </span>
        <p className={styles.thoughtText}>{renderTitle(item.detail ?? "")}</p>
      </li>
    );
  }

  if (item.kind === "approval") {
    return <ApprovalCard tool={item.toolName ?? "a tool"} reason={item.detail ?? "needs your approval"} />;
  }

  const cat = toolCategory(item.toolName);
  const hasArgs = item.args && Object.keys(item.args).length > 0;
  const expandable = Boolean(hasArgs || item.detail?.trim());
  const status = item.ok === null ? "pending" : item.ok ? "ok" : "error";
  const app = composioToolkitOf(item.toolName);

  return (
    <li
      className={styles.step}
      data-cat={cat}
      data-status={status}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span className={styles.rail} aria-hidden={app ? undefined : true}>
        {app ? (
          <button type="button" className={styles.appLogoBtn} onClick={() => openApps({ app })} aria-label={`Open ${titleCase(app)} in Connect apps`} title={`Open ${titleCase(app)}`}>
            <AppLogo slug={app} name={titleCase(app)} size={28} />
          </button>
        ) : (
          <CategoryTile cat={status === "error" ? "error" : cat} size="sm" active={item.ok === null} />
        )}
      </span>
      <div className={styles.card}>
        <button
          type="button"
          className={styles.cardHead}
          onClick={() => expandable && setOpen((v) => !v)}
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
        >
          <span className={styles.title}>{renderTitle(toolTitle(item.toolName, item.args))}</span>
          <span className={styles.cardMeta}>
            {item.ms !== null && <span className={styles.ms}>{formatMs(item.ms)}</span>}
            <Dot status={status} size="sm" pulse={item.ok === null} label={status === "pending" ? "Running" : status === "ok" ? "Succeeded" : "Failed"} />
            {expandable && <CaretRight size={10} weight="bold" className={styles.caret} aria-hidden />}
          </span>
        </button>

        {item.images.length > 0 && (
          <div className={styles.shots}>
            {item.images.map((id) => (
              <Shot key={id} id={id} alt={`${toolTitle(item.toolName, item.args)} — screenshot`} />
            ))}
          </div>
        )}

        {open && (
          <div className={styles.detail}>
            <p className={styles.toolName}>{item.toolName}</p>
            {hasArgs && (
              <>
                <p className={styles.detailLabel}>Arguments</p>
                <pre>{JSON.stringify(item.args, null, 2)}</pre>
              </>
            )}
            {item.detail && (
              <>
                <p className={styles.detailLabel}>Result</p>
                <pre>{item.detail}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Screenshot thumbnail; degrades to a labelled tile if the file is gone. */
function Shot({ id, alt }: { id: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <a href={`/api/uploads/${id}`} target="_blank" rel="noreferrer" className={styles.shot}>
      {failed ? (
        <span className={styles.shotMissing}>
          <Monitor size={14} aria-hidden />
          screenshot
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/uploads/${id}`} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      )}
    </a>
  );
}

function ApprovalCard({ tool, reason }: { tool: string; reason: string }) {
  return (
    <li className={cn(styles.step, styles.approval)}>
      <span className={styles.rail} aria-hidden>
        <CategoryTile cat="human" size="sm" icon={ShieldWarning} active />
      </span>
      <div className={styles.approvalCard}>
        <p className={styles.approvalTitle}>Approval needed</p>
        <p className={styles.approvalBody}>
          Wants to run <code>{tool}</code> — {reason}. Nothing has run yet.
        </p>
        <button
          type="button"
          className={styles.approvalLink}
          onClick={() => window.dispatchEvent(new CustomEvent(FOCUS_WAITING_EVENT, { detail: { tool } }))}
        >
          Review in Waiting on you
          <CaretRight size={10} weight="bold" aria-hidden />
        </button>
      </div>
    </li>
  );
}
