import type { ChatMessage } from "./messages";
import type { FileInfo } from "./uploads";

/**
 * Typed client for the panel's own API.
 *
 * Every mutating call sends JSON from the same origin, which satisfies the
 * middleware's same-site CSRF guard; no token plumbing is needed in the client.
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
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(typeof init?.body === "string" ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      err?.code ?? "internal",
      err?.message ?? `Request failed (${response.status}).`,
      response.status,
      err?.retryable ?? false,
    );
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

export interface BridgeJobView {
  id: string;
  action: string;
  started: number;
  ended: number | null;
  ok: boolean | null;
  output: string;
}

export const api = {
  listChats: () => request<{ chats: ChatSummary[] }>("/api/chats"),

  createChat: () =>
    request<{ chat: ChatSummary }>("/api/chats", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getChat: (id: string) => request<{ chat: ChatDetail }>(`/api/chats/${id}`),

  updateChat: (id: string, patch: Partial<Pick<ChatSummary, "title" | "pinned" | "archived">>) =>
    request<{ chat: ChatSummary }>(`/api/chats/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteChat: (id: string) =>
    request<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" }),

  sendMessage: (chatId: string, text: string, model?: string, fileIds?: string[]) =>
    request<{ message: ChatMessage; runId: string; model: string }>(
      `/api/chats/${chatId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          text,
          ...(model ? { model } : {}),
          ...(fileIds && fileIds.length > 0 ? { fileIds } : {}),
        }),
      },
    ),

  /** Multipart upload; the browser sets the boundary, so no content-type here. */
  uploadFile: (file: File, chatId?: string | null) => {
    const form = new FormData();
    form.set("file", file);
    if (chatId) form.set("chatId", chatId);
    return request<{ file: FileInfo; deduped: boolean }>("/api/uploads", {
      method: "POST",
      body: form,
    });
  },

  listChatFiles: (chatId: string) => request<{ files: FileInfo[] }>(`/api/chats/${chatId}/files`),

  computerViewer: () =>
    request<{ url: string; embeddable: boolean; reason: string | null }>("/api/computer/viewer"),

  wakeComputer: () => request<{ job: BridgeJobView }>("/api/computer/wake", { method: "POST", body: JSON.stringify({}) }),

  computerJob: (id: string) => request<{ job: BridgeJobView }>(`/api/computer/jobs/${encodeURIComponent(id)}`),

  logTakeover: (phase: "start" | "end", seconds?: number) =>
    request<{ ok: true }>("/api/computer/takeover", {
      method: "POST",
      body: JSON.stringify({ phase, ...(seconds !== undefined ? { seconds } : {}) }),
    }),

  cancelRun: (runId: string) =>
    request<{ ok: true; cancelled: boolean }>(`/api/runs/${runId}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  listModels: () =>
    request<{ models: ModelOption[]; defaultModel: string; anyVendorReady: boolean }>(
      "/api/models",
    ),
};
