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
  The right rail is **tabbed** (`Mission | Library | Computer`) — see §Reference
  reading; 360px cannot hold those three stacked.
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
- **Activity line**: the live summary in the transcript — LiveGlyph at 16px plus a
  present-participle verb derived from the running tool ("Clicking around",
  "Reading the screen"). One line, always the last thing before the prompt bar.
- **Step chips** in chat: tool icon + name + ms + status dot; expand to args/result;
  screenshots as thumbnails → lightbox. **Collapsed behind the activity line by
  default** — the line is the summary, the chips are the audit trail.
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

## Reference reading — Grok Bot (`docs/reference/grok-0*.png`, owner-supplied 2026-10-15)

Not a style to copy; a set of structural answers worth adopting. Flight Deck keeps
its own cockpit identity (dark ink, mono readouts, Agent/Manage, edge-light).

**Adopt:**
- **Right rail is tabbed, not stacked.** Grok: `Details | Library | Computer`.
  Ours: **`Mission | Library | Computer`** — Mission = run state, steps, usage
  readouts; Library = files and artifacts this chat produced; Computer = the VNC
  card. One rail, three tabs, identity block above them. Replaces the earlier
  "stack every panel vertically" sketch, which would have overflowed at 360px.
- **Sidebar rows carry a live status line.** Title on top, current activity
  underneath ("Semrush is running on rdp2", "Sent 1 PDF"). The owner can see what
  every chat is doing without opening it. Requires the chat-list endpoint to
  return each chat's latest run status — designed in from the start.
- **The transcript's activity indicator is understated.** A small glyph plus a
  present-participle verb ("Clicking around") on one line, not a stack of chips.
  Step chips stay, but collapsed by default: the live line is the summary, chips
  are the audit trail. LiveGlyph at 16px is exactly this.
- **Prompt bar is a pill with a `+` menu** (Attach files · Teach a task). Ours:
  Attach files · Save as skill · Schedule. Model picker and pace move to the
  bar's right edge rather than a separate toolbar row.
- **Settings use a `SettingRow` primitive**: label, muted description beneath,
  control right-aligned, grouped into section cards under a left tab list. Every
  Phase 3 tab is then just rows — no bespoke layout per tab.
- **A sleeping computer is a first-class state**, with its own card and a single
  `Wake` button. Matches LHOS `desktop_*` sleep/wake exactly.
- **Connect-apps surface**: searchable grid of connector cards with category
  chips, a connected count, and explicit `Add` / `Connect` / `Added ✓` states.
  Phase 4 connectors follow this rather than a plain list.

**Reject:**
- Right-aligned filled user bubbles. Flight Deck keeps both roles left-aligned on
  the 760px column with a role gutter — long technical turns read better, and the
  transcript stays scannable.
- Per-bot avatars and labels. Single-owner, single agent; the identity block
  shows the *computer*, not a persona.
