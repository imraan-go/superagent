/**
 * Server-side gate for chat uploads (the web app runs the same checks for fast feedback). The MIME
 * type comes from the extension, never the client, and the leading bytes must agree with it.
 */
const ALLOWED: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

export const VISION_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const starts = (b: Uint8Array, sig: number[], off = 0) => sig.every((x, i) => b[off + i] === x);

function sniff(ext: string, b: Uint8Array): boolean {
  switch (ext) {
    case 'png':
      return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return starts(b, [0xff, 0xd8, 0xff]);
    case 'gif':
      return starts(b, [0x47, 0x49, 0x46, 0x38]);
    case 'webp':
      return starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8);
    case 'pdf':
      return starts(b, [0x25, 0x50, 0x44, 0x46]);
    case 'docx':
    case 'xlsx':
      return starts(b, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return !b.subarray(0, 4096).includes(0);
  }
}

export function sanitizeFileName(name: string): string {
  // Strips C0 control characters, DEL and quotes from the name (intentional control-char class).
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  const dot = base.lastIndexOf('.');
  const cut = base.length > 120 && dot > 0 ? `${base.slice(0, 100)}${base.slice(dot)}` : base;
  return cut || 'file';
}

export type UploadCheck = { ok: true; name: string; mime: string } | { ok: false; code: 'empty' | 'too_large' | 'type_not_allowed' | 'content_mismatch'; message: string };

export function validateUpload(rawName: string, bytes: Uint8Array, maxBytes: number): UploadCheck {
  const name = sanitizeFileName(rawName);
  if (bytes.byteLength === 0) return { ok: false, code: 'empty', message: 'That file is empty.' };
  if (bytes.byteLength > maxBytes) return { ok: false, code: 'too_large', message: `Files are limited to ${Math.floor(maxBytes / (1024 * 1024))} MB.` };
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  const mime = ALLOWED[ext];
  if (!mime) return { ok: false, code: 'type_not_allowed', message: `.${ext || '?'} files are not accepted. Allowed: ${Object.keys(ALLOWED).join(', ')}.` };
  if (!sniff(ext, bytes)) return { ok: false, code: 'content_mismatch', message: 'The file contents do not match its extension.' };
  return { ok: true, name, mime };
}
