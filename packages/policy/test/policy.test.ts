import { describe, expect, it } from 'vitest';
import { APP_TOOLS, canonicalJson, checkBrowserUrl, checkWorkspacePath, evaluateTool, hostMatches, intentHash, isPrivateAddress, safeArtifactName, verifiedConnectorTools, type IntentBinding } from '../src';

describe('browser URL policy (SSRF)', () => {
  const allowed = ['example.com', '*.wikipedia.org'];
  it.each([
    ['https://example.com/a', true],
    ['https://www.example.com/a', true],
    ['https://en.wikipedia.org/wiki/X', true],
    ['https://wikipedia.org.evil.com/', false],
    ['https://evilexample.com/', false],
    ['http://example.com:8080/', false],
    ['https://user:pass@example.com/', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['http://127.0.0.1/', false],
    ['http://169.254.169.254/latest/meta-data', false],
    ['http://[::1]/', false],
    ['http://0x7f000001/', false],
    ['http://localhost/', false],
    ['http://metadata.google.internal/', false],
  ])('%s -> %s', (url, ok) => {
    expect(checkBrowserUrl(url, allowed).ok).toBe(ok);
  });
  it('requires a non-empty allowlist', () => {
    expect(checkBrowserUrl('https://example.com', []).ok).toBe(false);
  });
  it('classifies private addresses', () => {
    for (const a of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPrivateAddress(a), a).toBe(false);
  });
  it('wildcards do not match the apex unless listed', () => {
    expect(hostMatches('wikipedia.org', '*.wikipedia.org')).toBe(false);
    expect(hostMatches('en.wikipedia.org', '*.wikipedia.org')).toBe(true);
  });
});

describe('workspace path policy (traversal)', () => {
  it.each(['../etc/passwd', '/etc/passwd', 'a/../../b.txt', '.ssh/id_rsa', 'a/.env', 'x\u0000.txt', 'a\\..\\b.txt', 'report.exe', ''])('rejects %j', (p) => {
    expect(checkWorkspacePath(p).ok).toBe(false);
  });
  it('accepts normal relative files and maps content types', () => {
    const r = checkWorkspacePath('reports/summary.md');
    expect(r.ok && r.absolute).toBe('/home/user/workspace/reports/summary.md');
    expect(r.ok && r.contentType).toBe('text/markdown');
  });
  it('sanitizes artifact names', () => {
    expect(safeArtifactName('../../evil name<script>.png')).not.toMatch(/[/<> ]/);
  });
});

describe('canonical intent hashing', () => {
  const base: IntentBinding = {
    ownerId: 'u1',
    taskId: 't1',
    toolSlug: 'GMAIL_SEND_EMAIL',
    toolVersion: '1',
    connectedAccountId: 'c1',
    args: { b: 1, a: 'x' },
    destination: { to: 'bob@example.com' },
    attachments: [],
    nonce: 'n'.repeat(32),
    expiresAtMs: 1_000,
  };
  it('is key-order independent and Unicode-normalized', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(canonicalJson('é')).toBe(canonicalJson('e\u0301'));
    expect(intentHash(base)).toBe(intentHash({ ...base, args: { a: 'x', b: 1 } }));
  });
  it.each([
    ['owner', { ownerId: 'u2' }],
    ['account', { connectedAccountId: 'c2' }],
    ['tool version', { toolVersion: '2' }],
    ['destination', { destination: { to: 'eve@example.com' } }],
    ['content', { args: { a: 'y', b: 1 } }],
    ['attachments', { attachments: [{ sha256: 'f'.repeat(64), name: 'x.pdf' }] }],
    ['expiry', { expiresAtMs: 2_000 }],
    ['nonce', { nonce: 'm'.repeat(32) }],
  ])('changes when %s changes', (_n, patch) => {
    expect(intentHash({ ...base, ...(patch as Partial<IntentBinding>) })).not.toBe(intentHash(base));
  });
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe('tool policy', () => {
  const ctx = { readOnly: false, configured: new Set(['e2b_code', 'storage', 'composio']), connectorActive: (t: string) => t === 'gmail' };
  it('denies tools whose capability is not configured', () => {
    expect(evaluateTool(APP_TOOLS.browser_navigate, ctx)).toMatchObject({ verdict: 'deny' });
    expect(evaluateTool(APP_TOOLS.workspace_run_python, ctx)).toEqual({ verdict: 'allow' });
  });
  it('external writes need approval, and are denied in read-only mode or without an owned connection', () => {
    const lock = { GMAIL_SEND_EMAIL: { toolkit: 'gmail', version: 'v1', verifiedAt: 'x', params: ['recipient_email', 'subject', 'body'] } };
    const send = verifiedConnectorTools(lock).find((t) => t.composioSlug === 'GMAIL_SEND_EMAIL')!;
    expect(evaluateTool(send, ctx)).toEqual({ verdict: 'needs_approval' });
    expect(evaluateTool(send, { ...ctx, readOnly: true })).toMatchObject({ verdict: 'deny' });
    expect(evaluateTool(send, { ...ctx, connectorActive: () => false })).toMatchObject({ verdict: 'deny' });
  });
  it('connector tools are only enabled when discovery verified every curated param', () => {
    expect(verifiedConnectorTools({})).toHaveLength(0);
    expect(verifiedConnectorTools({ GMAIL_SEND_EMAIL: { toolkit: 'gmail', version: 'v1', verifiedAt: 'x', params: ['recipient_email'] } })).toHaveLength(0);
    expect(verifiedConnectorTools({ GMAIL_SEND_EMAIL: { toolkit: 'github', version: 'v1', verifiedAt: 'x', params: ['recipient_email', 'subject', 'body'] } })).toHaveLength(0);
  });
  it('app tool schemas are strict (no smuggled extra fields)', () => {
    expect(APP_TOOLS.workspace_write_file.schema.safeParse({ path: 'a.txt', content: 'x', overwrite: true }).success).toBe(false);
  });
});
