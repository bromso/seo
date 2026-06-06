# Product

## Register

product

## Users

Solo operators and small in-house teams who run SEO audits on their own properties (and a few competitors). They open this dashboard 2-5 times a week, usually right after a deploy or a content change. They're technical enough to read a Lighthouse score and prefer keyboard-first tools. Daily use, not occasional. They will not tolerate a tool that feels slow or noisy.

## Product Purpose

Continuously monitor SEO/performance/accessibility/PWA/on-page scores across multiple sites + competitors. Audits queue from the dashboard, run in the daemon, results stream back via realtime. Success looks like: open the dashboard, see at a glance which sites moved which way since yesterday, drill into the regression in one click, queue a re-audit in one keystroke.

## Brand Personality

Calm. Expert. Restrained. Three-word personality: **quiet, technical, decisive.** The product is a daily monitoring instrument, not a marketing dashboard. Think Linear's posture: it assumes you know what you're doing. It does not explain itself with onboarding tooltips on the home screen. It rewards repeat use with information density and keyboard shortcuts.

The product earns trust by being honest about state (offline, queued, running, partial, failed) and by being fast.

## Anti-references

- **shadcn default admin** (h1 + tab strip + identical card grid + muted-foreground gray on white). This is the current state and the single biggest thing to abandon.
- **Vercel marketing landing** patterns leaking into the app shell (gradient backgrounds, large hero copy, "Welcome back, Jonas!" lockups).
- **Glass / blur / oversized rounded corners** anywhere in the app shell. Cards top out at 8px radius. No backdrop-filter as decoration.
- **B2B-SaaS over-explanation** — no "Get started in 3 easy steps" cards on the home screen, no onboarding checklist hijacking the dashboard.
- **Generic Lighthouse-score circle visualizations** (the green/yellow/red dial). Use actual numeric type as the primary affordance; reserve color for delta-from-yesterday.

## Design Principles

1. **Information density without noise.** Linear-grade tight grid. Every pixel earns its place. If something doesn't change state, it doesn't deserve color.
2. **Honest about state.** Offline, queued, running, partial, failed each have a distinct, restrained visual treatment. Status is never optional.
3. **Keyboard-first.** Every primary action has a shortcut. Visible cmd-K hint. Lists are arrow-keyable.
4. **Delta over absolute.** Yesterday-vs-today is the user's actual question. Show the delta in bold, the absolute in dim.
5. **No mode-switching tax.** Dark mode is a first-class citizen, not an afterthought. Tokens are paired from day one.

## Accessibility & Inclusion

- Target WCAG 2.1 AA.
- All interactive elements keyboard-reachable; focus rings always visible (no `outline: none` without a replacement).
- Color is never the *only* channel for state (pair color with text label or icon).
- Respect `prefers-reduced-motion`: all motion has an instant or crossfade alternative.
- Type minimum 14px for body, 13px monospace for IDs/timestamps. Line-height 1.5 for prose, 1.4 for dense data.
