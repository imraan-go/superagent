/**
 * Path rules for the agent computer's ~/persist browser. Shared by the server
 * (authoritative) and the UI (to disable the download button). Protected
 * entries are listed but never downloadable or readable (docs/MANAGE_TAB.md §3).
 */

/** Returns a normalised relative path ("" = root) or null if it is unsafe. */
export function normalizePersistPath(input: string): string | null {
  if (input.includes("\0") || input.includes("\\")) return null;
  const raw = input.trim().replace(/^~\/persist\/?/, "");
  if (raw.startsWith("/")) return null;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.join("/");
}

const PROTECTED_NAMES = new Set(["rdp_pass", ".sync-stamp", "chrome-cdp"]);

/** True for secrets and browser state: rdp_pass, .sync-stamp, anything under chrome-cdp. */
export function isProtectedPath(input: string): boolean {
  const normalized = normalizePersistPath(input);
  // An unsafe path is never allowed through.
  if (normalized === null) return true;
  return normalized.split("/").some((p) => PROTECTED_NAMES.has(p.toLowerCase()));
}

export interface LsEntry {
  name: string;
  type: "dir" | "file" | "link";
  size: number;
  modified: string;
  protected: boolean;
}

const LS_LINE =
  /^([dl-])\S{9}[.+@]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4}))\s+(.+)$/;

/** Parses `ls -la` text (what LHOS list_files returns) into entries under `dir`. */
export function parseLs(text: string, dir: string): LsEntry[] {
  const entries: LsEntry[] = [];
  for (const line of text.split("\n")) {
    const m = LS_LINE.exec(line.trimEnd());
    if (!m) continue;
    const kind = m[1]!;
    let name = m[4]!;
    if (kind === "l") name = name.split(" -> ")[0]!;
    if (name === "." || name === "..") continue;
    entries.push({
      name,
      type: kind === "d" ? "dir" : kind === "l" ? "link" : "file",
      size: Number(m[2]),
      modified: m[3]!,
      protected: isProtectedPath(dir ? `${dir}/${name}` : name),
    });
  }
  return entries.sort(
    (a, b) =>
      (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name),
  );
}
