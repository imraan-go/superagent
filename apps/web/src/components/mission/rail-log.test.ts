import { describe, expect, it } from 'vitest';
import { compactNumber, eventMs, filterLog, groupStale, mergeLog } from './rail-log';

describe('mergeLog', () => {
  const steps = [
    {
      idx: 0,
      toolName: 'browser_goto',
      label: 'Open page',
      ok: true,
      ms: 120,
      seenAt: 1_000,
    },
    {
      idx: 1,
      toolName: 'read_text',
      label: 'Read',
      ok: null,
      ms: null,
      seenAt: 5_000,
    },
  ];
  const events = [
    { ts: 3, tool: 'desktop_click', ok: true, ms: 40 }, // seconds → 3000 ms
    {
      ts: 0,
      iso: '1970-01-01T00:00:06.000Z',
      tool: 'observe',
      ok: false,
      err: 'boom',
    },
  ];

  it('merges both sources newest first', () => {
    const log = mergeLog(steps, events, 'r1');
    expect(log.map((e) => e.tool)).toEqual(['observe', 'read_text', 'desktop_click', 'browser_goto']);
    expect(log[0]?.source).toBe('computer');
    expect(log[0]?.label).toBe('boom');
    expect(log[1]?.key).toBe('chat:r1:1');
  });

  it('puts chat steps above computer events on equal timestamps', () => {
    const log = mergeLog([{ ...steps[0]!, seenAt: 3_000 }], [events[0]!], null);
    expect(log.map((e) => e.source)).toEqual(['chat', 'computer']);
  });

  it('caps the list', () => {
    expect(mergeLog(steps, events, null, 2)).toHaveLength(2);
  });

  it('filters', () => {
    const log = mergeLog(steps, events, null);
    expect(filterLog(log, 'chat')).toHaveLength(2);
    expect(filterLog(log, 'computer')).toHaveLength(2);
    expect(filterLog(log, 'errors').map((e) => e.tool)).toEqual(['observe']);
    expect(filterLog(log, 'all')).toHaveLength(4);
  });
});

describe('eventMs', () => {
  it('accepts seconds, ms and iso', () => {
    expect(eventMs({ ts: 1_700_000_000 })).toBe(1_700_000_000_000);
    expect(eventMs({ ts: 1_700_000_000_123 })).toBe(1_700_000_000_123);
    expect(eventMs({ ts: 0, iso: '2026-10-13T00:00:00.000Z' })).toBe(Date.parse('2026-10-13T00:00:00.000Z'));
  });
});

describe('groupStale', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  it('splits items older than 24 h', () => {
    const items = [
      { id: 'a', createdAt: '2026-10-15T11:00:00Z' },
      { id: 'b', createdAt: '2026-10-13T09:00:00Z' },
      { id: 'c', createdAt: '2026-10-14T11:59:00Z' },
      { id: 'd', createdAt: 'not a date' },
    ];
    const { fresh, stale } = groupStale(items, now);
    expect(fresh.map((i) => i.id)).toEqual(['a', 'd']);
    expect(stale.map((i) => i.id)).toEqual(['b', 'c']);
  });
});

describe('compactNumber', () => {
  it('compacts', () => {
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1234)).toBe('1.2k');
    expect(compactNumber(45_600)).toBe('46k');
    expect(compactNumber(2_500_000)).toBe('2.5M');
  });
});
