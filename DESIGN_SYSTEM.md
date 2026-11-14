# Patronus design system: "Drawdown"

**Idea:** a reservoir. Water below the line, the bleached "bathtub ring" where water used to be, bare rock when it's gone. The logo's waterline is real data: on the Kariba page it sits at Kariba's live usable storage.

Code lives in `web/src/theme.css` (every token), `web/src/app.css` (components and motion rules) and `web/src/lib/motion.tsx` (motion hooks and the wordmark). Components only use `var(--...)`.

## Rules

- "Patronus" is used only as a word. No Harry Potter references, no NASA logo or insignia; credit NASA data in text ("Data: NASA GRACE-FO").
- Keep clear of Patronus AI: no shields, glows or purple.
- Every number has a source and a date. Sample data is always labelled.
- No gradients, no left-border cards, no emoji.

## Logo

| Use | How |
|---|---|
| Wordmark | `<Wordmark level={pct} />`. Three stacked copies of "patronus" in Schibsted Grotesk 800: sky (`--sky`), ring (`--ring`, clipped at 34%) and water (`--water`, clipped at the waterline). |
| Waterline | `null` = brand default at 58% (cuts the x-height). A page sets a live level with `useWaterline(pct)`; the line moves there over 1.4s. |
| On dark | `<Wordmark className="on-deep" />` (footer, video, slides). |
| Mark | Rounded square: sky, a ring band, water below. Used as the favicon. |
| Clear space | One x-height on every side. Below 20px tall, drop the ring. |

## Colour

| Token | Hex | Role | Contrast on white |
|---|---|---|---|
| `--ink` / `--text` | `#0B1F2A` | Text | 16.9 : 1 |
| `--text-muted` | `#4E616B` | Secondary text, labels | 6.5 : 1 |
| `--text-faint` | `#5F717A` | Source notes | 5.1 : 1 |
| `--water` / `--accent` | `#0B4F6C` | Brand, links, buttons, active nav, observed data | 8.9 : 1 |
| `--deep` | `#0B2A3C` | Dark sections, footer, night-light frames | — |
| `--shallow` | `#8DC3D6` | Water on dark | — |
| `--ring` | `#D9C9A3` | Lost storage; fills only, never text | — |
| `--rock` | `#6E4B1B` | Danger / "Act", drying, misses | 7.8 : 1 |
| `--fog` / `--bg` | `#EEF2F3` | Page ground | — |
| `--bg-elev` | `#FFFFFF` | Cards, figures, tables | — |

### Data scales (all colour-blind safe: blue vs ochre/brown, stepping in lightness)

- **Storage trend:** `--wetting-strong #0B4F6C` · `--wetting-mild #6FAEC6` · `--neutral-data #C2CCD0` · `--drying-mild #C4A266` · `--drying-strong #6E4B1B`.
- **Risk levels:** low `#E6E9E8` · watch `#D9C29A` · warning `#B08945` · danger `#6E4B1B` (white text only on danger).
- **ENSO exposure:** El Niño `#B08945` · La Niña `#2C7FA0` · both `#0B1F2A` · neutral `#C2CCD0`.
- **Series:** 1 observed `#0B4F6C` · 2 forecast `#B08945` · 3 `#6E4B1B` · 4 `#5F8FA3` (draw dashed).
- **Outcomes:** hit = water, miss = rock, false alarm = watch ochre, quiet = pale grey.

## Type

| Role | Style |
|---|---|
| Display (h1) | Schibsted Grotesk 800, −0.045em, line-height 0.95, `clamp(44px, 6.4vw, 88px)` |
| Section head (h2) | 700, −0.03em, `clamp(24px, 2.6vw, 36px)` |
| Body | 400, 16px, line-height 1.55; lede 18–22px |
| Labels, eyebrows, table heads, source notes, ticks | Martian Mono 11px (10px in charts), uppercase, +0.08em |
| Numbers | Grotesk 800 for headline numbers; tabular figures in tables and while counting |

Fonts are self-hosted through `@fontsource-variable/schibsted-grotesk` and `@fontsource/martian-mono` (no network calls at runtime).

## Shape and layout

- Radii: 6 (cells), 10 (rows, tooltips), 16 (cards, figures), 24 (large tiles), 999 (buttons, nav, pills).
- Cards are white on fog with no border. Tables sit in a white card.
- Max width 1280px; side gutter 16px on phones, `clamp(24px, 4vw, 56px)` above 720px.
- Touch targets at least 44px. Phones: tables become stacked cards; no horizontal page scroll.

## Motion

**Principle:** motion only ever explains data or confirms an action, and it should feel like water settling. Only `transform`, `opacity` and `clip-path` animate, so every animation runs on the compositor at 60fps. `will-change` is set only while something is about to move, then removed.

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.23,1,.32,1)` | Hovers, colour, fades, tooltips |
| `--ease-expo` | `cubic-bezier(.16,1,.3,1)` | Entrances: page, headline, reveals |
| `--ease-inout` | `cubic-bezier(.77,0,.175,1)` | The waterline, chart lines drawing |
| `--ease-spring` | `cubic-bezier(.34,1.36,.64,1)` | The gauge needle's overshoot |
| `--dur-1…5` | 160 / 280 / 700 / 1000 / 1400 ms | Press · hover · reveal · headline · waterline and draw |
| `--stagger` | 60ms | Between siblings, capped at 8 |

| Moment | What happens | Where |
|---|---|---|
| Route change | Page fades up 12px (1s, expo); the h1 wipes up through a mask; the lede follows 100ms later. | `.route-enter` in `App.tsx` |
| Scroll | Cards, figures, stats, table rows and timeline items fade up 18px as they enter, staggered by sibling. One shared observer; content that loads later is picked up. | `useAutoReveal` |
| Waterline | The logo's water level glides to the page's reservoir level and back. | `useWaterline`, `Wordmark` |
| Numbers | Stats and the gauge count up from zero when they come into view (expo out, about 1.4s). | `CountUp` |
| Gauge | The needle sweeps from 0 and settles with a small overshoot. | `Gauge` |
| Charts | Solid lines draw left to right (1.4s, in-out); bands and dashed lines fade in; points appear last. | `TimeChart` |
| Map and tooltips | Map fades in; tooltips rise 4px and scale from 0.98. | `app.css` |
| Press and hover | Clickables scale to 0.97 on press; colours change over 280ms. | `app.css` |

**Reduced motion:** with `prefers-reduced-motion`, every duration token is 0, nothing is hidden for a reveal, numbers show their final value, and charts render fully drawn.
