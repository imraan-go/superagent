# Design System — "Flight Deck"

Identity: a **precision instrument for commanding an agent fleet** — cockpit/mission-
control DNA, calm surfaces, luminous signal accents, numeric readouts everywhere.
Grok screenshots = layout reference only. We deliberately avoid: generic shadcn
default look, purple-gradient AI clichés, glassmorphism-everywhere, Inter-only typography.

## Color tokens (`src/styles/tokens.css`)
Dark (default):
```
--ink-0:#0B0D10; --ink-1:#111419; --ink-2:#171B22; --ink-3:#1F242E;  /* surfaces */
--line:#2A313D; --line-strong:#3A4452;
--text-1:#E8ECF1; --text-2:#9AA4B2; --text-3:#5F6B7A;
--signal:#2DE2C5;        /* agent activity, focus, primary actions */
--signal-dim:#17816F;
--amber:#FFB224;         /* approvals, attention, paused */
--danger:#FF5D5D; --ok:#5DE28A; --info:#6CA8FF;
--halo: 0 0 24px rgba(45,226,197,.18);   /* glow for live elements */
```
Light theme: same token names remapped (`--ink-0:#F6F8FA` … `--text-1:#10151C`,
signal darkened `#0FA88F`). Components use tokens ONLY.

## Typography
- Display/headings: **Space Grotesk** (600/500) — tracking -1%.
- UI/body: **Instrument Sans** (400/500) — 14px base, 1.55 line-height.
- Data/readouts/code: **JetBrains Mono** — `font-variant-numeric: tabular-nums`;
  token & cost counters always mono. Self-host via `next/font` (no CDN).

## Layout
- App grid: `64px topbar / [288px left | 1fr chat | 360px right]`; sidebars collapse
  (left → icon rail 56px, right → floating status pill). Chat column max 760px.
- Radii: panels 14px, controls 10px, pills 999. Borders 1px `--line`; elevation via
  border+subtle glow, not heavy shadows.
- Topbar center: **Agent / Manage** segmented switch — sliding "hangar door" thumb
  with `--signal`/`--amber` tint per mode; mode swap animates a 240ms crossfade +
  2px scanline sweep.

## Signature elements
- **LiveGlyph** (the reactive loader): a small orbital glyph of 3 arcs that idles
  slowly, spins+glows while the agent thinks, pulses amber when approval is needed,
  and ticks green on completion. Rendered sizes: prompt-bar 20px, right-panel 28px,
  splash 96px. One component, state-driven (`idle|thinking|tool|approval|done|error`).
  Edge-light: left/right sidebar inner edges carry a 1px animated gradient while a
  run is active (the whole frame feels "alive", Grok-like but ours).
- **Readout**: mono value + tiny label, used for tokens in/out, cost today, latency,
  CPU/RAM in Manage. Count-up animation on change (280ms, no easing bounce).
- **Step chips** in chat: tool icon + name + ms + status dot; expand to args/result;
  screenshots as thumbnails → lightbox.
- **Computer panel**: right-sidebar card with live VNC thumbnail (iframe, pointer-
  events none in Watch), status dot, buttons `Watch` / `Take control` (amber,
  requires hold-to-confirm 600ms) / `Expand`. Expanded = full-height sheet over chat.

## Motion
- Durations: micro 120ms, standard 200ms, panels 280ms spring (stiffness 320/d 32).
- Splash/boot after login: ink screen → LiveGlyph draws in → readouts "self-test"
  count up → grid slides in staggered 60ms. Total ≤ 1.6 s, skippable, once per session.
- Streaming text: no per-char fade (perf); cursor block in `--signal`.
- `prefers-reduced-motion`: all nonessential motion off, LiveGlyph static states.

## Sound (WebAudio, synthesized — no audio files)
send: 2 short rising sines (660→880Hz, 60ms) · done: soft triad (120ms) ·
approval: double amber ping (440Hz×2) · error: low thud (160Hz, 90ms) ·
takeover: sonar ping. Master volume + per-event toggles in Settings; default 0.3;
never sounds in Manage mode except service failure.

## Notifications
Toast stack bottom-right (max 3, queue). Chrome Notifications (if granted & tab
blurred): approval needed, run finished, takeover requested, service down (Manage).
Click focuses tab + deep-links to the item.

## Accessibility
WCAG AA contrast on both themes; full keyboard map (`?` opens shortcut sheet:
⌘K command palette, ⌘J new chat, ⌘/ focus prompt, A approve, Esc close); focus
rings always visible; SR announcements for run state changes.
