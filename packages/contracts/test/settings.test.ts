import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, isSection, mergeSection, parseStored, sectionDefaults, validateSection } from '../src/settings';

describe('settings sections', () => {
  it('lists every section and recognises only those names', () => {
    expect(SETTINGS_SECTIONS).toEqual(['agent', 'appearance', 'sound', 'notifications', 'usage', 'manage']);
    expect(isSection('sound')).toBe(true);
    expect(isSection('toString')).toBe(false);
    expect(isSection('budget')).toBe(false);
  });

  it('produces complete defaults for every section', () => {
    expect(sectionDefaults('agent')).toEqual({ systemPrompt: '', browsingDomains: [] });
    expect(sectionDefaults('sound')).toEqual({ master: true, volume: 0.3, events: { send: true, done: true, approval: true, error: true, takeover: true } });
    expect(sectionDefaults('notifications')).toEqual({ chrome: false, events: ['approval', 'runDone', 'question'] });
    for (const s of SETTINGS_SECTIONS) expect(() => sectionDefaults(s)).not.toThrow();
  });
});

describe('parseStored', () => {
  it('returns defaults for missing or non-object values', () => {
    expect(parseStored('usage', undefined)).toEqual({ warnAtPct: 80 });
    expect(parseStored('usage', null)).toEqual({ warnAtPct: 80 });
    expect(parseStored('usage', 'garbage')).toEqual({ warnAtPct: 80 });
    expect(parseStored('usage', [1, 2])).toEqual({ warnAtPct: 80 });
  });

  it('keeps valid fields and drops invalid ones from an older row', () => {
    expect(parseStored('appearance', { theme: 'light', density: 'tiny', legacy: 1 })).toEqual({ theme: 'light', reducedMotion: 'system', density: 'comfortable' });
  });

  it('salvages a nested object only when it is valid as a whole', () => {
    expect(parseStored('sound', { volume: 2, events: { send: false } })).toEqual({
      master: true,
      volume: 0.3,
      events: { send: false, done: true, approval: true, error: true, takeover: true },
    });
  });
});

describe('mergeSection', () => {
  it('merges plain objects one level deep, replaces arrays and scalars, and clears nulls', () => {
    const current = { master: true, volume: 0.3, events: { send: true, done: true } };
    expect(mergeSection(current, { volume: 0.5, events: { send: false }, master: null })).toEqual({ volume: 0.5, events: { send: false, done: true } });
    expect(mergeSection({ events: ['approval', 'runDone'] }, { events: ['question'] })).toEqual({ events: ['question'] });
  });

  it('does not mutate the current value and ignores non-object patches', () => {
    const current = { events: { send: true } };
    mergeSection(current, { events: { send: false } });
    expect(current).toEqual({ events: { send: true } });
    expect(mergeSection(current, 'x')).toEqual(current);
    expect(mergeSection(null, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('validateSection', () => {
  it('fills defaults for a valid patch result', () => {
    expect(validateSection('manage', { statsPollSeconds: 5 })).toEqual({ statsPollSeconds: 5, confirmHoldMs: 600 });
  });

  it.each([
    ['manage', { statsPollSeconds: 1 }],
    ['usage', { warnAtPct: 101 }],
    ['agent', { browsingDomains: ['not a host'] }],
    ['agent', { systemPrompt: 'x'.repeat(4001) }],
    ['notifications', { events: ['email'] }],
  ] as const)('rejects invalid %s values', (section, value) => {
    expect(() => validateSection(section, value)).toThrow();
  });
});
