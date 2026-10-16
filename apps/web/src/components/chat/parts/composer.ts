/**
 * Composer vocabulary: the capability hints the owner can pin to one message,
 * the slash-command templates, and the prefill event the landing uses.
 * Pure module.
 */

/**
 * Sent as `capabilities` on POST /api/chats/{id}/messages. Manual chips NARROW the tools the run
 * is offered (server-enforced); Auto or no chips = everything this installation allows.
 */
export const CAPABILITIES = [
  { id: "computer", label: "Workspace", hint: "Python and files in your private cloud sandbox (E2B)" },
  { id: "browser", label: "Browser", hint: "Cloud Chrome, limited to approved sites" },
  { id: "connectors", label: "Apps", hint: "Your connected apps (Composio)" },
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
    cmd: "/python",
    label: "Run code in the cloud workspace",
    template: "In my cloud workspace, write and run Python that ",
    capability: "computer",
  },
  {
    cmd: "/browse",
    label: "Read a website",
    template: "Open https:// and ",
    capability: "browser",
  },
  {
    cmd: "/schedule",
    label: "Create a routine",
    template: "Create a routine that runs every weekday at 08:00 and ",
  },
  {
    cmd: "/routines",
    label: "List or change my routines",
    template: "Show my routines. ",
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
