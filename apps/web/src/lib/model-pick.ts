/**
 * Which model the prompt bar preselects. Order: what the owner picked in this
 * session, then the model this chat last ran on (so reopening a chat does not
 * silently switch it to the global default — possibly a paid vendor), then the
 * default. A stored model that is no longer ready falls through.
 */
export function pickModel(input: {
  chosen: string | null;
  chatModel: string | null;
  defaultModel: string | null;
  ready: readonly string[];
}): string {
  if (input.chosen) return input.chosen;
  if (input.chatModel && input.ready.includes(input.chatModel)) return input.chatModel;
  return input.defaultModel ?? "";
}
