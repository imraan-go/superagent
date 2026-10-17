"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SegmentedSwitch, SettingRow, SettingSection, SkeletonText } from "@/components/ui";
import { settingsFetch, useSettingsSection } from "@/hooks/use-settings";
import { formatCost, formatTokens } from "@/lib/format";
import { cn } from "@/lib/cn";
import { InlineError, NumberField } from "../controls";
import styles from "../settings-tabs.module.css";

type Group = "day" | "model" | "kind" | "task";
type SortKey = "label" | "events" | "tokensIn" | "tokensOut" | "tokensCached" | "costUsd";

interface UsageRow {
  key: string;
  label: string;
  events: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
}

interface UsageReport {
  groupBy: Group;
  from: string;
  to: string;
  rows: UsageRow[];
  totals: Omit<UsageRow, "key" | "label">;
  todayUsd: number;
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "label", label: "", numeric: false },
  { key: "events", label: "Calls", numeric: true },
  { key: "tokensIn", label: "In", numeric: true },
  { key: "tokensOut", label: "Out", numeric: true },
  { key: "tokensCached", label: "Cached", numeric: true },
  { key: "costUsd", label: "Cost", numeric: true },
];

const GROUP_LABEL: Record<Group, string> = { day: "Day", model: "Model", kind: "Kind", task: "Run" };

interface BudgetView {
  maxCostPerRunUsd: string | null;
  monthlyLimitUsd: string | null;
}

interface UsageSummaryView {
  totalUsd?: string;
  limits: { perRunUsd: string | null; monthlyUsd: string | null };
}

export function UsageTab() {
  const qc = useQueryClient();
  const prefs = useSettingsSection("usage");
  const [now] = useState(() => Date.now());
  const monthStart = isoDay(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));

  const [groupBy, setGroupBy] = useState<Group>("day");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => isoDay(now + DAY_MS));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "label", dir: -1 });
  const effectiveFrom = from;

  const qs = new URLSearchParams({ groupBy, from: effectiveFrom, to }).toString();
  const report = useQuery({
    queryKey: ["usage", "report", qs],
    queryFn: () => settingsFetch<UsageReport>(`/api/usage/report?${qs}`),
  });
  const month = useQuery({
    queryKey: ["usage", "month", monthStart],
    queryFn: () => settingsFetch<UsageReport>(`/api/usage/report?${new URLSearchParams({ groupBy: "kind", from: monthStart })}`),
  });
  const limits = useQuery({ queryKey: ["usage", "limits"], queryFn: () => settingsFetch<UsageSummaryView>("/api/usage") });
  const mine = useQuery({ queryKey: ["settings", "budget"], queryFn: () => settingsFetch<BudgetView>("/api/settings") });
  const saveBudget = useMutation({
    mutationFn: (b: { maxCostPerRunUsd: string; monthlyLimitUsd: string }) =>
      settingsFetch("/api/settings/budget", { method: "PUT", body: JSON.stringify(b) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["usage", "limits"] });
      void qc.invalidateQueries({ queryKey: ["settings", "budget"] });
    },
  });

  const rows = useMemo(() => {
    const list = [...(report.data?.rows ?? [])];
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      return (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv))) * sort.dir;
    });
    return list;
  }, [report.data, sort]);

  const spent = month.data?.totals.costUsd ?? 0;
  const limit = Number(limits.data?.limits.monthlyUsd ?? 0);
  const perRun = limits.data?.limits.perRunUsd ?? null;
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  const over = limit > 0 && spent >= limit;
  const warn = limit > 0 && pct >= prefs.value.warnAtPct;
  const current = {
    maxCostPerRunUsd: mine.data?.maxCostPerRunUsd ?? perRun ?? "0",
    monthlyLimitUsd: mine.data?.monthlyLimitUsd ?? limits.data?.limits.monthlyUsd ?? "0",
  };

  return (
    <div className={styles.stack}>
      {warn && (
        <div role="status" className={cn(styles.banner, over && styles.bannerDanger)}>
          {over
            ? `This month's spend (${formatCost(spent)}) has reached the ${formatCost(limit)} limit; new runs are blocked.`
            : `This month's spend is at ${Math.round(pct)}% of the ${formatCost(limit)} limit.`}
        </div>
      )}

      <SettingSection title="Budget">
        <SettingRow label="This month" description={limit > 0 ? `${formatCost(spent)} of ${formatCost(limit)}` : `${formatCost(spent)} — no monthly limit`}>
          <div className={styles.meter} style={{ width: 160 }} aria-hidden>
            <div
              className={cn(styles.meterFill, warn && styles.meterWarn, over && styles.meterOver)}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </SettingRow>
        <SettingRow label="Limit per run" description="A run stops before a model call would pass this. Can only be lower than the server's cap.">
          <NumberField
            label="Limit per run in USD"
            prefix="$"
            value={Number(current.maxCostPerRunUsd)}
            min={0}
            step={0.05}
            onCommit={(v) => saveBudget.mutate({ ...current, maxCostPerRunUsd: v.toFixed(2) })}
          />
        </SettingRow>
        <SettingRow label="Limit per month" description="Runs are refused once this month's spend reaches it. Can only be lower than the server's cap.">
          <NumberField
            label="Limit per month in USD"
            prefix="$"
            value={Number(current.monthlyLimitUsd)}
            min={0}
            step={1}
            onCommit={(v) => saveBudget.mutate({ ...current, monthlyLimitUsd: v.toFixed(2) })}
          />
        </SettingRow>
        <SettingRow label="Warn at" description="Show a warning once this month's spend passes this share.">
          <NumberField
            label="Warn at percent"
            suffix="%"
            value={prefs.value.warnAtPct}
            min={1}
            max={100}
            onCommit={(warnAtPct) => void prefs.save({ warnAtPct })}
          />
        </SettingRow>
        <InlineError error={saveBudget.error ?? limits.error} />
      </SettingSection>

      <section>
        <div className={styles.row} style={{ justifyContent: "space-between", marginBottom: "var(--sp-3)" }}>
          <SegmentedSwitch<Group>
            label="Group usage by"
            size="sm"
            value={groupBy}
            onChange={(g) => {
              setGroupBy(g);
              setSort({ key: g === "day" ? "label" : "costUsd", dir: -1 });
            }}
            options={(Object.keys(GROUP_LABEL) as Group[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
          />
          <span className={styles.row}>
            <input
              type="date"
              aria-label="From date"
              className={styles.input}
              value={effectiveFrom}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
            <span className={styles.muted}>→</span>
            <input
              type="date"
              aria-label="To date"
              className={styles.input}
              value={to}
              min={effectiveFrom}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
            <a className={styles.chip} href={`/api/usage/export?${qs}`} download>
              CSV
            </a>
          </span>
        </div>

        {report.error && <InlineError error={report.error} />}
        {report.isPending ? (
          <SkeletonText lines={5} />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const active = sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        className={cn(styles.th, c.numeric && styles.num)}
                        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))
                          }
                        >
                          {c.label || GROUP_LABEL[groupBy]}
                          {active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className={styles.muted}>
                      No usage in this range.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.key || "none"}>
                    <td className={styles.labelCell} title={r.label}>
                      {r.label || "—"}
                    </td>
                    <td className={styles.num}>{r.events}</td>
                    <td className={styles.num}>{formatTokens(r.tokensIn)}</td>
                    <td className={styles.num}>{formatTokens(r.tokensOut)}</td>
                    <td className={styles.num}>{formatTokens(r.tokensCached)}</td>
                    <td className={styles.num}>{formatCost(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
              {report.data && rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className={styles.num}>{report.data.totals.events}</td>
                    <td className={styles.num}>{formatTokens(report.data.totals.tokensIn)}</td>
                    <td className={styles.num}>{formatTokens(report.data.totals.tokensOut)}</td>
                    <td className={styles.num}>{formatTokens(report.data.totals.tokensCached)}</td>
                    <td className={styles.num}>{formatCost(report.data.totals.costUsd)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
