import type { ChatMode, ChatPrefs } from './chat-mode';
import type { ChatMessage, QuestionPart } from './messages';
import type { FileInfo } from './uploads';
import { readApiError } from './api-error';

/**
 * Typed client for the panel's own API.
 *
 * Every mutating call sends JSON from the same origin, which satisfies the
 * proxy's same-site CSRF guard; no token plumbing is needed in the client.
 */
export interface ApiErrorBody {
  error: { code: string; message: string; retryable?: boolean };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = readApiError(body, response.status);
    throw new ApiError(err.code, err.message, response.status, err.retryable);
  }

  return body as T;
}

export interface ChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  status: string | null;
  statusLine: string | null;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
  /** Composer prefs: mode + Auto/manual chips (src/lib/chat-mode.ts). */
  prefs?: ChatPrefs;
  /** The run still in progress in this chat (queued, running or waiting on the user). */
  activeRunId?: string | null;
  /** A question the agent is waiting on; typing in the composer answers it. */
  pendingQuestion?: QuestionPart | null;
}

export interface ModelOption {
  id: string;
  label: string;
  vendor: string;
  tier: string | null;
  vision: boolean;
  context: number;
  ready: boolean;
}

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export const api = {
  listChats: () => request<{ chats: ChatSummary[] }>('/api/chats'),

  createChat: () =>
    request<{ chat: ChatSummary }>('/api/chats', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getChat: (id: string) => request<{ chat: ChatDetail }>(`/api/chats/${id}`),

  updateChat: (id: string, patch: Partial<Pick<ChatSummary, 'title' | 'pinned' | 'archived'>> & Partial<ChatPrefs>) =>
    request<{ chat: ChatSummary }>(`/api/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteChat: (id: string) => request<{ ok: true }>(`/api/chats/${id}`, { method: 'DELETE' }),

  /**
   * `capabilities` is an advisory hint from the composer chips (computer,
   * browser, rdp, connectors, mcp, memory); the server may use it to narrow the
   * tool allowlist. Omitted when empty.
   */
  sendMessage: (
    chatId: string,
    text: string,
    model?: string,
    fileIds?: string[],
    capabilities?: string[],
    mode?: ChatMode,
    capabilitiesAuto?: boolean,
  ) =>
    request<{ message: ChatMessage | null; runId: string; model: string; mode: ChatMode; answered?: string }>(
      `/api/chats/${chatId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          text,
          timezone: browserTimezone(),
          ...(model ? { model } : {}),
          ...(fileIds && fileIds.length > 0 ? { fileIds } : {}),
          ...(capabilities && capabilities.length > 0 ? { capabilities } : {}),
          ...(mode ? { mode } : {}),
          ...(capabilitiesAuto !== undefined ? { capabilitiesAuto } : {}),
        }),
      },
    ),

  /** Answers the agent's question (option ids, or typed text). The run continues server-side. */
  answerQuestion: (chatId: string, questionId: string, choices: string[], text?: string) =>
    request<{ ok: true; runId: string; question: QuestionPart }>(`/api/chats/${chatId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ questionId, choices, ...(text ? { text } : {}) }),
    }),

  /** Multipart upload; the browser sets the boundary, so no content-type here. */
  uploadFile: (file: File, chatId?: string | null) => {
    const form = new FormData();
    form.set('file', file);
    if (chatId) form.set('chatId', chatId);
    return request<{ file: FileInfo; deduped: boolean }>('/api/uploads', {
      method: 'POST',
      body: form,
    });
  },

  listChatFiles: (chatId: string) => request<{ files: FileInfo[] }>(`/api/chats/${chatId}/files`),

  cancelRun: (runId: string) =>
    request<{ ok: true; cancelled: boolean }>(`/api/runs/${runId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  listModels: () => request<{ models: ModelOption[]; defaultModel: string; anyVendorReady: boolean }>('/api/models'),
};
