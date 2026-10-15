# Design System — LHOS

> Product name: **LHOS** (wordmark: tracked caps, teal→violet gradient, LiveGlyph as
> the mark). "Flight Deck" was the design-system codename until 2026-10-15.

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

### Meaning palette (2026-10-15)
Colour maps to MEANING, never decoration. `--hue-*` are raw per-theme values
(dark vivid / light AA-darkened, all ≥4.5:1 on ink surfaces); components use the
semantic roles:

| role | hue | meaning |
|---|---|---|
| `--c-agent` | teal | agent activity, focus, primary |
| `--c-think` | violet | model / AI thinking, memory |
| `--c-approval` | amber | approvals, attention, waiting on you |
| `--c-web` | sky | browser / web |
| `--c-connect` | magenta | connectors (MCP is fuchsia) |
| `--c-money` | lime | success, done, cost/tokens |
| `--c-error` | coral | errors |

Tool categories (`ToolCategory` in `chat/parts/tool-meta.ts`) have `--cat-*` tokens:
screen teal, browser sky, rdp indigo, shell lime, files peach, connector magenta,
mcp fuchsia, memory violet, schedule gold, human amber. Any element with
`data-cat="<category>"` exposes its hue as `--cat`. **`<CategoryTile cat>`**
(`components/ui/category-tile.tsx`) is the one way to show a category: a rounded-
square Phosphor-duotone tile tinted by `--cat`, with an `active` sheen while
running. Used by trace cards, the rail activity log + stats, the sidebar chat rows,
composer capability chips, landing suggestions and the minimised dock.

Surfaces: `--glass`, `--glass-strong`, `--glass-line`, `--glass-hi` give translucent
panels with a fine top highlight (rails, topbar, panels, composer). The shell carries
a static **aurora mesh** (`--aurora-1..3`, three faint radial glows) — painted once,
never animated.

## Typography
- Display/headings: **Space Grotesk** (600/500) — tracking -1%.
- UI/body: **Instrument Sans** (400/500) — 14px base, 1.55 line-height.
- Data/readouts/code: **JetBrains Mono** — `font-variant-numeric: tabular-nums`;
  token & cost counters always mono. Self-host via `next/font` (no CDN).

## Layout
- App grid (2026-10-15): `[left rail, full height] [64px glass topbar / centre]
  [right rail, full height]`. `.body` is `display: contents`, so each route's
  `<main>` and `<aside>` land straight in the grid; the topbar spans the centre only.
- **Left rail** (288px, fixed): brand + prominent New chat (⌘J), search, then the
  ONLY scroller — Pinned / Today / Yesterday / Previous 7 days / Older with sticky
  frosted headers; each row = category tile + status dot + title + status/relative
  time, hover actions pin / rename / delete. Fixed bottom dock: agent-computer
  mini-card, Settings, owner avatar + sign out. Collapses to a 56px icon rail
  (toggle or ⌘B; `fd.layout.leftCollapsed` in localStorage). 820–1100px is always
  the icon rail; <820px it is the history drawer.
- **Right rail** (360px, fixed): sticky header (computer identity + sliding-underline
  tabs) and independent scroll body. **Minimise** (button or ⌘.) folds it to a 56px
  dock of live indicators — run-state LiveGlyph, waiting badge, cost-today count-up,
  computer dot — each click expands; persisted as `fd.layout.rightMinimized`.
  The content stays mounted (inert) so the live view keeps its connection.
  <1100px it remains the drawer (minimise does not apply).
- Chat column max 760px.
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
- **Computer panel**: right-sidebar card with the live viewer iframe, which always
  receives input directly — the viewer is view-only by default and has its own
  Take control pill. The panel toolbar is only status + Reload / Expand / Open in
  new tab. Expanded = full-height sheet over chat.

## Motion
- Durations: micro 120ms, standard 200ms, panels 280ms; `--dur-spring` 420ms with
  `--ease-spring` (a CSS `linear()` spring — compositor-only, no JS).
- Vocabulary: spring lift on hover / scale-press on buttons, cards and chips;
  staggered `rise-in` entrances (`--i` × `--stagger` 28ms, capped) for sidebar rows,
  log rows, trace steps, suggestions; `CountUp` on every meter; shimmer across
  running trace cards and tiles; two-tone progress sweep on the composer while a
  run is live; sliding thumb (mode switch) and sliding underline (rail tabs);
  rails slide/resize on the spring; toasts and badges pop.
- LiveGlyph phase colours: thinking violet (teal inner arc) → tool teal (sky arc)
  → approval amber → done lime → error coral. Run-trace borders follow the phase.
- Transform/opacity only for anything that loops. The rail width change is the one
  layout animation (280ms, once per toggle).
- Reduced motion: one global guard in `globals.css` honours the OS setting (unless
  Settings forces motion on) and `data-motion="reduce"`; `useReducedMotion()` reads
  both, so count-ups and Motion springs stop too.
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

Not a style to copy; a set of structural answers worth adopting. LHOS keeps
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
- Right-aligned filled user bubbles. LHOS keeps both roles left-aligned on
  the 760px column with a role gutter — long technical turns read better, and the
  transcript stays scannable.
- Per-bot avatars and labels. Single-owner, single agent; the identity block
  shows the *computer*, not a persona.
