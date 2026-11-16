# Use of SI (AI tools) in Patronus

NASA Space Apps 2026 asks teams to state clearly where and how SI (AI) tools were used. This file is that statement. We do not give percentages, because we did not measure them.

## Where SI tools were used

| Part | Tools | How |
|---|---|---|
| Data pipeline (`pipeline/`) | Claude Code (Anthropic), OpenAI Codex | Most code was written by the AI coding tools from the team's instructions, then run, checked and corrected by the team. |
| Web app and dashboard (`web/`) | Claude Code, OpenAI Codex | Most components, pages, charts and the 3-D globe were written with these tools under the team's direction. |
| Worker (`deploy/plan-worker/`) | Claude Code | Written with AI assistance; serves the site and the assistant endpoints. |
| Research and method critique | Claude | Finding sources, checking claims against them, critiquing methods. Facts were then checked against the original sources (see `patronus-pitch/FACTS.md` in the team workspace and `DESIGN.md` section 8). |
| Written text (README, docs, briefs, project page) | Claude | Drafted with AI help, edited by the team. |
| Slides and pitch video | Claude / Claude Code | AI-assisted layout, text and assembly. The rules require a visible SI watermark on images and video. |

## SI running inside the app

- **Planning assistant** (dashboard `#/app`, plan page) and **"Ask the data" chat**: these call an AI model at runtime. Order: Claude (Anthropic API, when the team's key is set) then Cloudflare Workers AI (Llama 3.3 70B) then a simple phrase parser with no AI.
- Both panels show the label **"AI assistant (SI)"**.
- The assistants may only use Patronus data files and simulator outputs. They do not produce the forecasts; the forecasts come from the pipeline.

## What the team did

- The idea and the problem framing (hydropower shortfalls, Lake Kariba as the showpiece).
- The choice of NASA and partner data, and of the methods (Mann-Kendall, Sen's slope, FDR control, El Niño composites, the water-balance ensemble).
- The validation rules: back-tests on past data only, beating persistence and climatology, and publishing misses and false alarms.
- Review of results, decisions on what to keep or drop, and the pitch.

## What SI did not do

- No number in the app or pitch was made up by an AI model. All numbers come from the pipeline output (`web/public/data/*.json`) or a cited source.
- No AI-generated images are used as data. The globe textures are NASA Blue Marble / Black Marble derived maps (via the three.js examples); night-light frames come from NASA GIBS.

## Metadata markers

- `web/package.json`: `"si_assisted": true` and a note in `description`.
- `web/public/data/meta.json` (written by `pipeline/meta.py`): `si_assisted`, `si_note`, `ai_disclosure`.
- One-line `SI-assisted` header in `web/src/App.tsx`, `pipeline/run_all.py` and `deploy/plan-worker/index.js`.
- Site footer: "Built with SI tools (Claude, Codex); data from NASA and partners."
