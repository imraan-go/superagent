import { describe, expect, it } from 'vitest';
import { formatCombo, fuzzyScore, isTypingTarget, matchCombo, parseCombo, resolveBinding } from './hotkeys';
import type { Binding, KeyLike, MatchState } from './hotkeys';

const ev = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...o,
});
const noop = () => {};
const input = { tagName: 'INPUT', getAttribute: () => null };
const body = { tagName: 'BODY', getAttribute: () => null };

describe('matchCombo', () => {
  it('treats mod as meta or ctrl', () => {
    expect(matchCombo(ev('k', { metaKey: true }), 'mod+k')).toBe(true);
    expect(matchCombo(ev('K', { ctrlKey: true }), 'mod+k')).toBe(true);
    expect(matchCombo(ev('k'), 'mod+k')).toBe(false);
  });
  it('rejects extra modifiers', () => {
    expect(matchCombo(ev('k', { metaKey: true, altKey: true }), 'mod+k')).toBe(false);
    expect(matchCombo(ev('k', { metaKey: true, ctrlKey: true }), 'mod+k')).toBe(false);
    expect(matchCombo(ev('a', { ctrlKey: true }), 'a')).toBe(false);
  });
  it('ignores shift for punctuation but not letters', () => {
    expect(matchCombo(ev('?', { shiftKey: true }), '?')).toBe(true);
    expect(matchCombo(ev('g', { shiftKey: true }), 'g')).toBe(false);
  });
  it('parses combos', () => {
    expect(parseCombo('mod+/')).toEqual({ key: '/', mod: true, alt: false, shift: false });
  });
});

describe('isTypingTarget', () => {
  it('flags text fields', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
  it('lets buttons and checkboxes through', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', getAttribute: () => 'checkbox' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('resolveBinding', () => {
  const bindings: Binding[] = [
    { keys: 'mod+k', allowInInput: true, handler: noop },
    { keys: 'mod+j', handler: noop },
    { keys: '?', handler: noop },
    { keys: 'g m', handler: noop },
  ];
  const fresh = (): MatchState => ({ pending: null });

  it('fires modifier combos in inputs only when allowed', () => {
    expect(resolveBinding(bindings, ev('k', { metaKey: true }), input, fresh(), 0)?.keys).toBe('mod+k');
    expect(resolveBinding(bindings, ev('j', { metaKey: true }), input, fresh(), 0)).toBeNull();
    expect(resolveBinding(bindings, ev('j', { metaKey: true }), body, fresh(), 0)?.keys).toBe('mod+j');
  });
  it('ignores bare keys while typing', () => {
    expect(resolveBinding(bindings, ev('?', { shiftKey: true }), input, fresh(), 0)).toBeNull();
    expect(resolveBinding(bindings, ev('?', { shiftKey: true }), body, fresh(), 0)?.keys).toBe('?');
  });
  it('resolves sequences within the timeout', () => {
    const s = fresh();
    expect(resolveBinding(bindings, ev('g'), body, s, 0)).toBeNull();
    expect(resolveBinding(bindings, ev('m'), body, s, 500)?.keys).toBe('g m');
  });
  it('drops stale or typed sequences', () => {
    const s = fresh();
    resolveBinding(bindings, ev('g'), body, s, 0);
    expect(resolveBinding(bindings, ev('m'), body, s, 5000)).toBeNull();
    const t = fresh();
    resolveBinding(bindings, ev('g'), input, t, 0);
    expect(t.pending).toBeNull();
  });
  it('skips defaultPrevented events and repeats', () => {
    expect(
      resolveBinding(bindings, { ...ev('k', { metaKey: true }), defaultPrevented: true }, body, fresh(), 0),
    ).toBeNull();
    expect(resolveBinding(bindings, { ...ev('j', { metaKey: true }), repeat: true }, body, fresh(), 0)).toBeNull();
  });
});

describe('fuzzyScore', () => {
  it('matches subsequences and rejects misses', () => {
    expect(fuzzyScore('stg', 'Open Settings')).toBeGreaterThan(0);
    expect(fuzzyScore('zzz', 'Open Settings')).toBe(0);
    expect(fuzzyScore('', 'anything')).toBeGreaterThan(0);
  });
  it('ranks prefix above scattered', () => {
    expect(fuzzyScore('new', 'New chat')).toBeGreaterThan(fuzzyScore('new', 'Open window'));
  });
});

describe('formatCombo', () => {
  it('renders per platform', () => {
    expect(formatCombo('mod+k', true)).toBe('⌘K');
    expect(formatCombo('mod+k', false)).toBe('Ctrl+K');
    expect(formatCombo('g m', true)).toBe('G then M');
  });
});
