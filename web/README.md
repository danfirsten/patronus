# Patronus web

Static front end for Patronus (NASA Space Apps 2026). Vite + React + TypeScript, d3-geo maps from bundled `world-atlas` (no tile server; works offline), hash routing so `dist/` runs from any static host or sub-path.

## Run

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # -> web/dist (open with any static server, e.g. `npx vite preview`)
```

Pages: `#/` story · `#/map` · `#/watchlist` · `#/country/ECU` · `#/kariba` · `#/scoreboard` · `#/proof`.

## Data

The app reads `data/*.json` relative to the page, i.e. `web/public/data/` (written by the pipeline; see `docs/CONTRACTS.md`). Night-light images and ledger `.ots` files are read from paths relative to the site root (`web/public/img/...`, `web/public/ledger/...`).

If a file is missing, is not JSON, or fails a basic shape check, the app loads an **illustrative fixture** from `src/fixtures/` instead and shows a yellow **"Sample data: pipeline output not loaded"** banner naming the files, plus a SAMPLE tag on every affected chart source line. Fixture numbers are round and labelled "Sample"; never cite them.

Regenerate fixtures: `npm run fixtures` (`scripts/make-fixtures.mjs`).

Optional AI briefs are shown if `data/briefs/<ISO3>.md` or `data/briefs/kariba.md` exist (labelled as AI-written).

## Theme

All colours, fonts and radii live in `src/theme.css` as CSS custom properties. Swap the identity there; components only use `var(--...)`. Data palettes are Okabe-Ito (colour-blind safe): drying = warm, wetting = cool. Motion is disabled under `prefers-reduced-motion`.

## Layout

```
src/
  App.tsx            nav, routing, per-page sample banner
  theme.css          design tokens (only place with colours)
  app.css            layout and components
  data/load.ts       fetch + fixture fallback + reporting
  data/types.ts      types mirroring docs/CONTRACTS.md
  components/        TimeChart, WorldMap, Gauge, ProbStrip, Sparkline, common UI
  pages/             Home, MapPage, Watchlist, Country, Kariba, Scoreboard, Proof
  fixtures/          illustrative sample JSON (generated)
scripts/make-fixtures.mjs
```
