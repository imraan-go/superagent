/**
 * Upload rules shared by the browser (fast feedback) and the server (the real
 * gate). The server never trusts the client's MIME type: the type is derived
 * from the extension and the leading bytes must agree with it.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;

export interface UploadKind {
  mime: string;
  category: "image" | "document" | "text";
}

export const ALLOWED_EXTENSIONS: Record<string, UploadKind> = {
  png: { mime: "image/png", category: "image" },
  jpg: { mime: "image/jpeg", category: "image" },
  jpeg: { mime: "image/jpeg", category: "image" },
  gif: { mime: "image/gif", category: "image" },
  webp: { mime: "image/webp", category: "image" },
  pdf: { mime: "application/pdf", category: "document" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    category: "document",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "document",
  },
  txt: { mime: "text/plain", category: "text" },
  md: { mime: "text/markdown", category: "text" },
  csv: { mime: "text/csv", category: "text" },
  json: { mime: "application/json", category: "text" },
};

/** For the `<input accept>` attribute. */
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_EXTENSIONS)
  .map((e) => `.${e}`)
  .join(",");

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Strips any path and control characters; keeps the name human-readable. */
export function sanitizeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    // Strips C0 control characters, DEL and quotes (intentional control-char class).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim();
  const dot = base.lastIndexOf(".");
  const cut = base.length > 120 && dot > 0 ? `${base.slice(0, 100)}${base.slice(dot)}` : base;
  return cut || "file";
}

export type ValidationResult =
  | { ok: true; kind: UploadKind; ext: string; name: string }
  | {
      ok: false;
      code: "empty" | "too_large" | "type_not_allowed" | "content_mismatch";
      message: string;
    };

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** True when the leading bytes are consistent with the claimed extension. */
export function sniffMatches(ext: string, head: Uint8Array): boolean {
  switch (ext) {
    case "png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(head, [0x47, 0x49, 0x46, 0x38]);
    case "webp":
      return (
        startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case "pdf":
      return startsWith(head, [0x25, 0x50, 0x44, 0x46]);
    case "docx":
    case "xlsx":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    default:
      // Text formats: no NUL bytes in the first 4 KB.
      return !head.subarray(0, 4096).includes(0);
  }
}

export function validateUpload(input: {
  name: string;
  bytes: number;
  head: Uint8Array;
}): ValidationResult {
  const name = sanitizeFileName(input.name);
  if (input.bytes <= 0) return { ok: false, code: "empty", message: "That file is empty." };
  if (input.bytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "too_large",
      message: `Files are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
    };
  }
  const ext = extensionOf(name);
  const kind = ALLOWED_EXTENSIONS[ext];
  if (!kind) {
    return {
      ok: false,
      code: "type_not_allowed",
      message: `.${ext || "?"} files are not accepted. Allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(", ")}.`,
    };
  }
  if (!sniffMatches(ext, input.head)) {
    return {
      ok: false,
      code: "content_mismatch",
      message: "The file contents do not match its extension.",
    };
  }
  return { ok: true, kind, ext, name };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The slice of a `files` row the client needs. */
export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  origin: "upload" | "tool";
  createdAt?: string;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Image types the vision models accept. */
export function isVisionMime(mime: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime);
}

/**
 * Response headers for `GET /api/uploads/[id]`. Bytes are served with the
 * stored (server-derived) MIME, `nosniff`, a no-script CSP + sandbox and
 * private caching. Only raster images render inline; everything else is a
 * download, so an uploaded text file can never execute in the panel origin.
 */
export function servingHeaders(file: { mime: string; name: string; bytes: number }): Record<string, string> {
  const inline = isVisionMime(file.mime);
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "content-type": file.mime,
    "content-length": String(file.bytes),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "private, max-age=86400, immutable",
  };
}
