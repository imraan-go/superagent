"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { CUES } from "@/lib/sound-cues";
import { soundEnabled } from "@/lib/prefs";
import type { SoundEvent } from "@/lib/prefs";
import { useSoundPrefs } from "./use-prefs";

/**
 * WebAudio cue player. One shared AudioContext, created lazily — browsers
 * keep it suspended until a user gesture, so the first cue after a click
 * (e.g. "send") also unlocks the later ones (done, approval…).
 */
let shared: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!shared) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    shared = new Ctor();
  }
  if (shared.state === "suspended") void shared.resume().catch(() => {});
  return shared;
}

function play(event: SoundEvent, volume: number): void {
  const ctx = context();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;

  for (const tone of CUES[event]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + tone.at;
    const end = start + tone.dur;
    const peak = Math.max(0.0001, volume * tone.level);

    osc.type = tone.wave;
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, end);

    // Short attack and exponential release: no clicks at either edge.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.01, tone.dur / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

export function useSound(): (event: SoundEvent) => void {
  const prefs = useSoundPrefs();
  const pathname = usePathname();
  const manage = pathname?.startsWith("/manage") ?? false;

  return useCallback(
    (event: SoundEvent) => {
      if (!soundEnabled(prefs, event, manage)) return;
      try {
        play(event, prefs.volume);
      } catch {
        // Audio is a nicety; never let it break the action that triggered it.
      }
    },
    [prefs, manage],
  );
}
