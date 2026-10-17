import { CommandExitError, type Sandbox } from 'e2b';
import { randomUUID } from 'node:crypto';
import { WORKSPACE_ROOT, checkWorkspacePath } from '@superagent/policy';

export class WorkspacePathError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'WorkspacePathError';
  }
}

function resolve(path: string) {
  const c = checkWorkspacePath(path);
  if (!c.ok) throw new WorkspacePathError(c.reason);
  return c;
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…[truncated ${s.length - n} chars]` : s;
}

export async function ensureWorkspaceRoot(sbx: Sandbox) {
  await sbx.files.makeDir(WORKSPACE_ROOT);
}

/** Creates a new file; refuses to overwrite (overwrites are destructive and need their own control). */
export async function writeNewFile(sbx: Sandbox, path: string, content: string) {
  const p = resolve(path);
  await ensureWorkspaceRoot(sbx);
  if (await sbx.files.exists(p.absolute))
    throw new WorkspacePathError(`${p.relative} already exists; choose a new file name`);
  const info = await sbx.files.write(p.absolute, content);
  return { path: p.relative, bytes: Buffer.byteLength(content), sandboxPath: info.path };
}

export async function readTextFile(sbx: Sandbox, path: string, maxChars = 20_000) {
  const p = resolve(path);
  const text = await sbx.files.read(p.absolute, { format: 'text' });
  return { path: p.relative, text: clip(text, maxChars) };
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export async function runPython(
  sbx: Sandbox,
  code: string,
  opts: { timeoutMs: number; onOutput?: () => void },
): Promise<RunResult> {
  await ensureWorkspaceRoot(sbx);
  const script = `/tmp/superagent_${randomUUID()}.py`;
  await sbx.files.write(script, code);
  const started = Date.now();
  try {
    const r = await sbx.commands.run(`python3 ${script}`, {
      cwd: WORKSPACE_ROOT,
      timeoutMs: opts.timeoutMs,
      onStdout: () => opts.onOutput?.(),
      onStderr: () => opts.onOutput?.(),
    });
    return {
      exitCode: r.exitCode,
      stdout: clip(r.stdout, 8000),
      stderr: clip(r.stderr, 4000),
      durationMs: Date.now() - started,
      timedOut: false,
    };
  } catch (err) {
    if (err instanceof CommandExitError) {
      return {
        exitCode: err.exitCode,
        stdout: clip(err.stdout, 8000),
        stderr: clip(err.stderr, 4000),
        durationMs: Date.now() - started,
        timedOut: false,
      };
    }
    const timedOut = err instanceof Error && /timeout|deadline/i.test(`${err.name} ${err.message}`);
    if (timedOut)
      return {
        exitCode: -1,
        stdout: '',
        stderr: 'execution timed out',
        durationMs: Date.now() - started,
        timedOut: true,
      };
    throw err;
  } finally {
    await sbx.files.remove(script).catch(() => undefined);
  }
}

export async function readBytesForExport(sbx: Sandbox, path: string, maxBytes: number) {
  const p = resolve(path);
  const info = await sbx.files.getInfo(p.absolute);
  if (info.type !== 'file') throw new WorkspacePathError(`${p.relative} is not a regular file`);
  if (info.size > maxBytes) throw new WorkspacePathError(`${p.relative} is ${info.size} bytes; limit is ${maxBytes}`);
  const bytes = await sbx.files.read(p.absolute, { format: 'bytes' });
  if (bytes.byteLength > maxBytes) throw new WorkspacePathError('file grew beyond the export limit');
  return { path: p.relative, contentType: p.contentType, bytes };
}
