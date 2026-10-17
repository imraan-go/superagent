import { z } from 'zod';

/**
 * The on-the-wire shape of a message turn. Isomorphic on purpose: the chat
 * column renders these parts and the model adapters translate them, so one
 * definition keeps the database, the API and the UI from drifting.
 *
 * `messages.content` is an array of parts, so a single row holds a complete
 * multimodal turn (ARCHITECTURE.md §Database).
 */

export const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

/**
 * Images are referenced by `fileId`, never inlined as base64 (ADR-07). Chat
 * state and SSE frames stay small, and the bytes are served once through the
 * authenticated files route.
 */
export const imagePartSchema = z.object({
  type: z.literal('image'),
  fileId: z.uuid(),
  mime: z.string(),
  alt: z.string().optional(),
});

/** A non-image attachment (pdf, docx, csv, …), referenced by `fileId`. */
export const filePartSchema = z.object({
  type: z.literal('file'),
  fileId: z.uuid(),
  name: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
});

export const toolUsePartSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export const toolResultPartSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  ms: z.number().optional(),
  /** Trimmed for display; the untruncated payload lives in `run_steps`. */
  text: z.string(),
  images: z.array(z.uuid()).default([]),
});

/**
 * Summarised model reasoning (Thinking mode). Display only: it is never sent
 * back to a model (src/server/agent/context.ts skips it).
 */
export const thinkingPartSchema = z.object({
  type: z.literal('thinking'),
  text: z.string(),
});

/**
 * A question the agent asked in chat (ask_user, or the Yes/No gate before a routine change).
 * Stored with the run's turn, so the transcript shows what was asked and what the owner chose.
 */
export const questionPartSchema = z.object({
  type: z.literal('question'),
  questionId: z.string(),
  kind: z.enum(['single', 'multi', 'text', 'confirm']),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  status: z.enum(['pending', 'answered', 'expired', 'cancelled']),
  answer: z
    .object({ choices: z.array(z.string()), text: z.string().optional() })
    .nullable()
    .default(null),
  expiresAt: z.string().optional(),
});

export const messagePartSchema = z.discriminatedUnion('type', [
  questionPartSchema,
  thinkingPartSchema,
  textPartSchema,
  imagePartSchema,
  filePartSchema,
  toolUsePartSchema,
  toolResultPartSchema,
]);

export const messageContentSchema = z.array(messagePartSchema);

export type TextPart = z.infer<typeof textPartSchema>;
export type ImagePart = z.infer<typeof imagePartSchema>;
export type FilePart = z.infer<typeof filePartSchema>;
export type ToolUsePart = z.infer<typeof toolUsePartSchema>;
export type ToolResultPart = z.infer<typeof toolResultPartSchema>;
export type MessagePart = z.infer<typeof messagePartSchema>;
export type ThinkingPart = z.infer<typeof thinkingPartSchema>;
export type QuestionPart = z.infer<typeof questionPartSchema>;

export const messageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: MessagePart[];
  model: string | null;
  runId: string | null;
  createdAt: string;
}

/** Plain text of a turn — used for titles, memory extraction and search. */
export function partsToText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

export const MAX_TITLE_LENGTH = 60;

/**
 * Immediate fallback title from the first user turn, so the sidebar never shows
 * "New chat" while a model-written title is still pending. Collapses whitespace
 * and cuts on a word boundary.
 */
export function deriveTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 'New chat';
  if (flat.length <= MAX_TITLE_LENGTH) return flat;

  const cut = flat.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
