import { describe, expect, it } from 'vitest';
import { nanosToUsd, priceTimes, redact, redactString, usdToNanos } from '../src';

describe('redaction', () => {
  it.each([
    'Authorization: Bearer abc.def.ghi',
    'key=sk-proj-0123456789abcdefghij',
    'vck_0123456789abcdefghijklmnop',
    'e2b_0123456789abcdef0123456789',
    'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    'xoxb-1234-5678-abcdefgh',
    'https://x.example/cb?token=supersecretvalue123',
    'ws://127.0.0.1:9222/devtools/browser/0b1c2d3e',
    '-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----',
  ])('redacts %s', (s) => {
    const out = redactString(s);
    expect(out).toContain('[REDACTED');
    expect(out).not.toMatch(/abc\.def\.ghi|0123456789abcdefghij|supersecretvalue123|0b1c2d3e|MIIEv/);
  });
  it('redacts by key name, deeply', () => {
    const r = redact({ a: { apiKey: 'value-1', nested: [{ password: 'p', ok: 'keep' }] }, cookie: 'c', accessToken: 't' }) as Record<string, unknown>;
    expect(JSON.stringify(r)).not.toMatch(/value-1|"p"|"c"|"t"/);
    expect(JSON.stringify(r)).toContain('keep');
  });
});

describe('money (integer nano-USD)', () => {
  it('round-trips decimal strings without float error', () => {
    expect(usdToNanos('0.25')).toBe(250_000_000n);
    expect(nanosToUsd(usdToNanos('10'))).toBe('10');
    expect(nanosToUsd(1n)).toBe('0.000000001');
    expect(usdToNanos('0.1') + usdToNanos('0.2')).toBe(usdToNanos('0.3'));
  });
  it('multiplies per-token prices and rounds up', () => {
    expect(priceTimes('0.0000001', 1000)).toBe(100_000n);
    expect(priceTimes('0.0000000001', 1)).toBe(1n);
  });
  it('rejects malformed amounts', () => {
    expect(() => usdToNanos('-1')).toThrow();
    expect(() => usdToNanos('1e3')).toThrow();
  });
});
