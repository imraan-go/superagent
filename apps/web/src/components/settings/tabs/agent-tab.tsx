"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "@phosphor-icons/react/dist/ssr";
import { Button, SettingRow, SettingSection, SkeletonText } from "@/components/ui";
import { settingsFetch, useSettingsSection } from "@/hooks/use-settings";
import { cn } from "@/lib/cn";
import { InlineError } from "../controls";
import styles from "../settings-tabs.module.css";

export interface ToolInfo {
  name: string;
  description: string;
  classification: string;
  executor: "local" | "workspace" | "browser" | "connector";
  toolkit: string | null;
  needsApproval: boolean;
  confirms: boolean;
  available: boolean;
  missing: string[];
}

export interface ToolsView {
  tools: ToolInfo[];
  capabilities: Record<string, { configured: boolean; missing: string[] }>;
}

export const TOOLS_KEY = ["tools"] as const;

const GROUPS: Array<{ executor: ToolInfo["executor"]; label: string; hint: string }> = [
  { executor: "local", label: "Built in", hint: "Questions, memory and routines" },
  { executor: "workspace", label: "Cloud workspace", hint: "Python and files in your private E2B sandbox" },
  { executor: "browser", label: "Cloud browser", hint: "Google Chrome in E2B, limited to approved sites" },
  { executor: "connector", label: "Connected apps", hint: "Your Composio connections" },
];

const HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Settings → Agent: standing instructions, browsing sites, and what the agent can do. */
export function AgentTab() {
  const agent = useSettingsSection("agent");
  const tools = useQuery({ queryKey: TOOLS_KEY, queryFn: () => settingsFetch<ToolsView>("/api/tools") });
  const [prompt, setPrompt] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const domains = agent.value.browsingDomains;
  const candidate = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const validDomain = HOST.test(candidate) && !domains.includes(candidate);

  return (
    <div className={styles.stack}>
      <SettingSection title="Your instructions">
        <div className={styles.pad}>
          <p className={cn(styles.muted, styles.flush)}>
            Added to every run as your preferences (tone, format, things to remember). They never grant permissions or
            override the safety rules.
          </p>
          <textarea
            className={styles.textarea}
            rows={5}
            maxLength={4000}
            placeholder="e.g. Answer briefly. Use metric units. I live in Toronto."
            value={prompt ?? agent.value.systemPrompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => {
              if (prompt !== null && prompt !== agent.value.systemPrompt) void agent.save({ systemPrompt: prompt });
              setPrompt(null);
            }}
            aria-label="Standing instructions"
          />
        </div>
      </SettingSection>

      <SettingSection title="Browsing">
        <div className={styles.pad}>
          <p className={cn(styles.muted, styles.flush)}>
            The cloud browser only opens approved sites. Each run may use the sites below plus any site you name in your
            message; text the agent reads on the web can never add more.
          </p>
          {domains.length > 0 && (
            <ul className={styles.chips} aria-label="Approved sites">
              {domains.map((d) => (
                <li key={d} className={styles.chip}>
                  <span className={styles.mono}>{d}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Remove ${d}`}
                    onClick={() => void agent.save({ browsingDomains: domains.filter((x) => x !== d) })}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className={styles.row}
            onSubmit={(e) => {
              e.preventDefault();
              if (!validDomain) return;
              void agent.save({ browsingDomains: [...domains, candidate] });
              setDomain("");
            }}
          >
            <input
              className={cn(styles.input, styles.wideInput)}
              placeholder="example.com or *.wikipedia.org"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              aria-label="Add an approved site"
            />
            <Button size="sm" variant="primary" type="submit" disabled={!validDomain || domains.length >= 20}>
              Add site
            </Button>
          </form>
          <InlineError error={agent.error} />
        </div>
      </SettingSection>

      <SettingSection title="What the agent can do">
        <p className={cn(styles.muted, styles.pad)}>
          Set by the application, not by settings. Anything that changes something outside the app (sending email,
          editing a calendar) stops for your exact approval; creating or changing a routine asks you first.
        </p>
        {tools.isPending && <div className={styles.pad}><SkeletonText lines={4} /></div>}
        <InlineError error={tools.error} />
        {tools.data &&
          GROUPS.map((g) => {
            const list = tools.data.tools.filter((t) => t.executor === g.executor);
            if (!list.length) return null;
            return (
              <div key={g.executor} className={styles.toolGroup}>
                <SettingRow label={g.label} description={g.hint}>
                  <span className={styles.muted}>
                    {list.filter((t) => t.available).length}/{list.length} available
                  </span>
                </SettingRow>
                <ul className={cn(styles.toolList, styles.pad)}>
                  {list.map((t) => (
                    <li key={t.name} className={styles.toolItem} title={t.description}>
                      <span className={cn(styles.toolName, styles.mono, !t.available && styles.muted)}>{t.name}</span>
                      {t.needsApproval && <span className={cn(styles.badge, styles.badgeWarn)}>needs approval</span>}
                      {t.confirms && <span className={styles.badge}>asks first</span>}
                      {!t.available && (
                        <span className={cn(styles.badge, styles.badgeLock)}>
                          {t.executor === "connector" ? "connect the app" : `needs ${t.missing.join(", ") || "setup"}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </SettingSection>
    </div>
  );
}
