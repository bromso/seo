# Design

## Theme & Register

**Register:** product. **Reference:** Linear. **Mode:** light is primary; dark mode is a first-class twin (paired tokens, no fallback gray).

Calm operator aesthetic. Information density without noise. Every pixel either communicates state or stays out of the way.

## Color Strategy

**Restrained.** One brand accent at ≤10% surface area. Everything else is a tuned neutral ramp. Status uses color, content does not. No gradients anywhere in the app shell.

### Brand

| Role | Light | Dark |
|---|---|---|
| Primary (accent) | `oklch(0.56 0.18 270)` | `oklch(0.72 0.16 270)` |
| Primary on dark surface | `oklch(0.72 0.16 270)` | — |

Less saturated than the current shadcn indigo (`0.5854 0.2041 277`). Linear-grade restraint.

### Neutrals (paired light/dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surface-base` | `oklch(0.992 0 0)` | `oklch(0.155 0 0)` | App background |
| `--surface-raised` | `oklch(0.985 0 0)` | `oklch(0.195 0 0)` | Sidebar, headers |
| `--surface-overlay` | `oklch(1 0 0)` | `oklch(0.225 0 0)` | Popovers, command palette |
| `--border-subtle` | `oklch(0.925 0 0)` | `oklch(0.275 0 0)` | Hairline dividers |
| `--border-strong` | `oklch(0.85 0 0)` | `oklch(0.375 0 0)` | Input borders, focused boundaries |
| `--ink-primary` | `oklch(0.16 0 0)` | `oklch(0.965 0 0)` | Body text, scores |
| `--ink-secondary` | `oklch(0.42 0 0)` | `oklch(0.72 0 0)` | Labels, metadata |
| `--ink-tertiary` | `oklch(0.58 0 0)` | `oklch(0.55 0 0)` | Disabled, deltas at rest |

Pure neutrals, chroma 0. No warm tint. No cream.

### Status (desaturated, paired)

| State | Light | Dark |
|---|---|---|
| Success / score ≥90 | `oklch(0.65 0.11 145)` | `oklch(0.72 0.12 145)` |
| Caution / score 50-89 | `oklch(0.72 0.10 75)` | `oklch(0.78 0.11 75)` |
| Failure / score <50 | `oklch(0.60 0.13 25)` | `oklch(0.70 0.14 25)` |
| Queued / running | `oklch(0.62 0.06 240)` | `oklch(0.70 0.07 240)` |

Lower-chroma than typical "traffic light" semantic colors. Reserves vibrant color for the accent and for transient states only.

## Typography

**Inter** for everything visible. **JetBrains Mono** for IDs, timestamps, run hashes, scores. Two families total. No serif anywhere.

| Use | Family | Size | Weight | Tracking | Line height |
|---|---|---|---|---|---|
| Display (page title) | Inter | 28-30px (1.875rem) | 600 | -0.02em | 1.15 |
| H2 (section) | Inter | 18px | 600 | -0.015em | 1.2 |
| H3 (subsection) | Inter | 15px | 600 | -0.01em | 1.3 |
| Body | Inter | 14px | 400 | 0 | 1.45 |
| Small / labels | Inter | 13px | 500 | 0.005em | 1.4 |
| Eyebrow / table heading | Inter | 11px | 600 | 0.08em uppercase | 1.4 |
| Score / numeric | JetBrains Mono | 18px display, 13px inline | 500 | 0 | 1 |
| Timestamp / ID | JetBrains Mono | 12px | 400 | 0 | 1.4 |

**Eyebrows in tables only.** Not above every section (that's the AI tell). Reserved for column headings in dense data lists.

## Spacing & Geometry

- **Base unit:** 4px (matches Linear). Use multiples: 4, 8, 12, 16, 20, 24, 32, 40, 56.
- **Section rhythm:** vertical spacing varies by section weight. Top header → content uses 24px; row-to-row in a dense list uses 8px; content block to next block uses 32-40px.
- **Border radius:** 6px for inputs/buttons/badges, 8px for cards/popovers, 4px for chips. **No 16px+ radii anywhere.** Pills (status badges) use 9999px.
- **Borders > shadows.** App shell uses 1px hairline borders, not shadow. Shadow is reserved for ephemeral overlays (popover, command palette, toast) — and even there it's tight: `0 1px 3px rgba(0,0,0,0.08), 0 8px 24px -8px rgba(0,0,0,0.12)`.

## Layout patterns

### App shell

```
┌──────────────────────────────────────────────────────────────┐
│ ◇ workspace      [⌘K  Search sites, runs, settings…]   ◑ J │  ← top bar 48px
├────────┬─────────────────────────────────────────────────────┤
│        │                                                     │
│ ●Sites │   Sites                              ⊕ Add site  ⌘K │  ← page header
│  Runs  │   12 sites · last audit 4m ago                      │
│  Comp. │                                                     │
│  Cfg.  │   ╭──────────────────────────────────────────────╮  │
│        │   │ rss.example.com    Perf 92 +3  SEO 88 −1 …  │  │  ← dense rows
│        │   │ blog.example.com   Perf 78 ±0  SEO 91 +2 …  │  │
│ ⌘K     │   │ docs.example.com   Perf 64 −5  SEO 86 ±0 …  │  │
│        │   │ …                                            │  │
│        │   ╰──────────────────────────────────────────────╯  │
└────────┴─────────────────────────────────────────────────────┘
```

**Top bar:** 48px height. Workspace name on the left (subtle, no logo treatment). Center: full-width-feeling command-K search trigger. Right: notifications icon, user avatar.

**Left rail:** 56px collapsed (icons only). Expand on hover/focus to 200px. Linear pattern. Items: Sites, Runs, Competitors, Settings. Current section highlighted with a 2px left-side accent strip AND a subtle bg tint (paired channels — not color alone).

**Main area:** 24px outer padding. No max-width on the content; let the table expand to use available space.

### Dashboard (sites list)

Replace the current `SiteScoreCard` grid with a **dense table-row layout**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Site               Perf   SEO    BP     PWA    OP    Δ    Last │  eyebrow row
├─────────────────────────────────────────────────────────────────┤
│ ● rss.example.com   92↑3   88↓1   95↑0   80↑0   91↑2   +4   4m │  ← row, hover bg
│ ● blog.example       78    91↑2   89     65↓3   88     −2   12m│
│ ◐ docs.example       64↓5  86     92↓1   71     85↑1   −5   1h │  ← running (◐)
│ …                                                              │
└─────────────────────────────────────────────────────────────────┘
```

- Row height: 44px. Click anywhere → opens latest run.
- Column 1: status dot + site URL (URL in mono small).
- Score columns: large mono number; small delta to the right in success/failure color.
- Trailing Δ column: aggregate delta (sum or worst single regression).
- Trailing Last: relative time.
- Right-click or hover-revealed action menu: "Run audit", "Open run", "Settings".
- Press `R` with row focused → trigger audit.
- Selection state: 1px primary border on left, very subtle bg tint.

### Run-detail

Single column, max 920px content width. Sticky meta header showing `run id (mono) · site URL · started 12m ago · status pill`. Below: 5 category sections as horizontal bars (score 0-100), each expandable to issue list. No big radial dial.

### Auth + Onboarding

Single-column centered, max 360px wide. Workspace mark (text only, no logo treatment) + tagline. Form: 12px label spacing, 40px input height, 1 primary button (full-width). Sign-up has a faint right-side panel with a single quote-shaped "what this product does" line — calm, not marketing.

### Offline banner

Inline within main, 1px border (no fill), small dot + text: `● Offline · last data 4m ago`. Auto-clears, no animation.

## Components — committed deltas from current state

| Element | Current | New |
|---|---|---|
| Page title | `h1 text-2xl font-semibold` | Display 30px / 600 / -0.02em with subtitle below |
| Tabs (Overview/Trends) | shadcn `Tabs` | Inline segmented control (12px, no underline) OR drop and use sidenav |
| Site display | `Card` with score grid | `<tr>` in dense table |
| Run audit button | `Button outline mt-3 w-full` | Hover-revealed icon button + `R` shortcut |
| Score number | text-base font-semibold | Mono 18px on dashboard, mono 32px on run-detail |
| Status | text color string | Dot + label, 1px border pill |
| OfflineBanner | amber 50 + border-amber-300 | Hairline border, dot indicator, no fill |
| Card shadow | shadow-sm | Removed everywhere except popovers/dialogs |
| Border radius | 0.5rem (8px) | 6px buttons/inputs, 8px overlays, full pill chips |

## Motion

Minimal and exponential. Listed in priority of where to spend effort:

1. **Sticky top progress bar** (2px high, accent color) when any audit is running — Linear-style. Position: under the top bar. Auto-shows when `audit_runs.status === "running"`, fades out on completion.
2. **Row hover:** 80ms bg-color transition, ease-out-quart.
3. **Command palette open:** 120ms fade + 4px translateY. No scale.
4. **Realtime score delta arrival:** 240ms transition on the score number with a subtle background flash (50ms in, 200ms out) to call attention without nagging.
5. **Reduced motion:** all of the above become instant or pure opacity. No motion is required for state communication.

No micro-bounces. No spring physics. No hover lifts. No skeleton shimmer (use a 1px progress bar at the top instead).

## Token migration plan

The current `packages/ui/src/styles/globals.css` ships shadcn defaults plus a lot of unused tokens (kanban colors, animation keyframes, color-1..5 brand rainbow). Approach:

1. **Don't touch `packages/ui` tokens** — that file feeds the marketing site (`@repo/www`) and Storybook. Changing it would affect surfaces out of scope.
2. **Layer new tokens** in `apps/app/src/app/globals.css` (or new file imported once at app root): override the shadcn color tokens AND add new `--surface-*`, `--ink-*` tokens listed above. Light AND dark together.
3. **App-only components** (in `apps/app/src/components/`) consume the new tokens via Tailwind utilities. shadcn components imported from `@repo/ui` continue to use the original tokens — that's OK because the overrides cascade.
4. New components are built fresh: `SiteRow`, `ScoreCell`, `StatusDot`, `AppShell`, `LeftRail`, `TopBar`, `CommandK`, `RunningProgressBar`.

## Accessibility commitments

- Contrast: body 4.5:1 minimum verified against `--surface-base` for every ink token.
- Focus rings: 2px accent ring at 2px offset; always visible.
- Keyboard: tab order top-bar → left-rail → main; arrow keys navigate the site list; `R` runs an audit; `⌘K` opens search.
- State channels: every status uses dot + text, not color alone.
- Reduced motion: all motion has an instant alternative.
- Test: every new component gets at least one a11y assertion in its test (role queries, focus, no `tabindex` >0).
