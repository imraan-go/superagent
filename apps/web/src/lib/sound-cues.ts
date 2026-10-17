import type { SoundEvent } from './prefs';

/**
 * Synthesized cues (DESIGN_SYSTEM §Sound) — no audio files. Each cue is a list
 * of short tones scheduled relative to "now"; kept as data so the shapes are
 * reviewable and testable without an AudioContext.
 */
export interface Tone {
  /** Start offset, seconds. */
  at: number;
  /** Duration, seconds. */
  dur: number;
  freq: number;
  /** Glide target, Hz. */
  to?: number;
  wave: OscillatorType;
  /** Relative level, multiplied by the master volume. */
  level: number;
}

export const CUES: Record<SoundEvent, Tone[]> = {
  // Two short rising sines, 660 → 880 Hz, 60 ms each.
  send: [
    { at: 0, dur: 0.06, freq: 660, wave: 'sine', level: 0.6 },
    { at: 0.07, dur: 0.06, freq: 880, wave: 'sine', level: 0.6 },
  ],
  // Soft major triad, 120 ms.
  done: [
    { at: 0, dur: 0.12, freq: 523.25, wave: 'sine', level: 0.4 },
    { at: 0, dur: 0.12, freq: 659.25, wave: 'sine', level: 0.3 },
    { at: 0, dur: 0.12, freq: 783.99, wave: 'sine', level: 0.3 },
  ],
  // Double amber ping, 440 Hz × 2.
  approval: [
    { at: 0, dur: 0.09, freq: 440, wave: 'triangle', level: 0.8 },
    { at: 0.16, dur: 0.09, freq: 440, wave: 'triangle', level: 0.8 },
  ],
  // Low thud, 160 Hz, 90 ms, falling.
  error: [{ at: 0, dur: 0.09, freq: 160, to: 90, wave: 'sine', level: 1 }],
  // Sonar ping: a clean tone with a long tail and a quieter echo.
  takeover: [
    { at: 0, dur: 0.5, freq: 1046.5, to: 980, wave: 'sine', level: 0.7 },
    { at: 0.35, dur: 0.4, freq: 1046.5, to: 980, wave: 'sine', level: 0.25 },
  ],
};
