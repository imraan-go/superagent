/**
 * Composer vocabulary: the capability hints the owner can pin to one message,
 * the slash-command templates, and the prefill event the landing uses.
 * Pure module.
 */

/**
 * Sent as `capabilities` on POST /api/chats/{id}/messages. Empty = no hint
 * (the agent chooses freely). The server may later narrow the tool allowlist
 * from it; today it is advisory.
 */
export const CAPABILITIES = [
  { id: "computer", label: "Computer", hint: "Linux desktop: screen, mouse, keyboard, shell" },
  { id: "browser", label: "Browser", hint: "Automated Chrome on the agent computer" },
  { id: "rdp", label: "RDP", hint: "Your Windows PC over remote desktop" },
  { id: "connectors", label: "Connectors", hint: "Composio, Pipedream and custom REST" },
  { id: "mcp", label: "MCP", hint: "Remote MCP servers" },
  { id: "memory", label: "Memory", hint: "What the agent remembers about you" },
] as const;

export type CapabilityId = (typeof CAPABILITIES)[number]["id"];

export interface SlashCommand {
  cmd: string;
  label: string;
  template: string;
  capability?: CapabilityId;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    cmd: "/computer",
    label: "Operate the Linux computer",
    template: "On the agent computer, ",
    capability: "computer",
  },
  {
    cmd: "/rdp",
    label: "Work on my Windows PC",
    template: "Connect to my Windows PC over RDP and ",
    capability: "rdp",
  },
  {
    cmd: "/schedule",
    label: "Create a recurring task",
    template: "Create a schedule that runs every weekday at 08:00 and ",
  },
  {
    cmd: "/memory",
    label: "Remember something",
    template: "Remember this about me: ",
    capability: "memory",
  },
];

/** Matching commands while the draft is a bare `/word`; empty otherwise. */
export function matchSlash(text: string): SlashCommand[] {
  if (!/^\/\w*$/.test(text)) return [];
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(text.toLowerCase()));
}

/** Window event: put text (and optional capability hints) into the composer. */
export const PROMPT_PREFILL_EVENT = "fd:prompt-prefill";

export interface PromptPrefillDetail {
  text: string;
  capabilities?: CapabilityId[];
}

export function prefillPrompt(detail: PromptPrefillDetail): void {
  window.dispatchEvent(new CustomEvent<PromptPrefillDetail>(PROMPT_PREFILL_EVENT, { detail }));
}
