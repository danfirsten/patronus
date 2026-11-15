# Plan chat interface (handover to Arvin's agents)

Status (2026-11-14, pat-dash): the chat was frozen as it stood on the `fd/plan-simulator` branch (PR #6). The dashboard (`#/app/plan`) only moved it into the right-hand dock. Keep this interface stable: the dashboard, the globe and the bottom dock all go through the same tool dispatcher.

## Files

| What | Path |
|---|---|
| Worker (endpoint, prompts, tool schema sent to the model, number check) | `deploy/plan-worker/worker.js` (deployed copy: `C:\dev\MXB\claude-work\patronus-plan-cfg\worker.js`, worker `patronus-plan`) |
| Client calls + rule parser + base tool application | `web/src/lib/plan/chat.ts` (`askPlan`, `askExplain`, `ruleParse`, `applyTools`) |
| Chat component (UI) | `web/src/pages/Plan.tsx`: `export function Chat`, `Msg`, `EXAMPLES` |
| Dashboard chat flow (`ask`) | `web/src/app/PlanDash.tsx`: `ask()` |
| Full tool dispatcher (map tools, geo split) | `web/src/app/geo.ts`: `applySimTools`, `geoParse`, `getResults` |
| Simulator | `web/src/lib/plan/sim.ts` (`simulatePlan`, `optimize`, `digest`, `planDigest`) |

## Endpoint

`POST /api/plan-chat`, `content-type: application/json`. Guards: 10 req/min per IP and 60 req/min in total (Workers rate-limit bindings `CHAT_IP_LIMIT`, `CHAT_GLOBAL_LIMIT`); `message` is cut to 600 chars; `max_tokens` is 700 (plan) and 500 (explain). Model order: Claude `claude-sonnet-5-5` if the secret `ANTHROPIC_API_KEY` is set, then Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, then `llama-4-scout`), then the browser's `ruleParse` when the endpoint fails. `GET /api/health` returns `{ ok, workers_ai, claude }`.

### Phase `plan` (sentence to tool calls)

Request:
```json
{ "phase": "plan", "message": "I can't import from South Africa", "plan": <planDigest(plan)>, "limits": { "budgetMusd": null, "maxShedH": null, "voll": "central" } }
```
`plan` + `limits` together must be under 3,000 chars of JSON (else 413).

Response 200: `{ "tool_calls": [{ "name": "disable_action", "arguments": { "action": "imports" } }], "model": "<model id>" }`.
Errors: `429 {error:"rate_limited"}`, `400 bad_json`, `413 too_large`, `502 ai_failed`, `503 no_model`. On any error the client falls back to `ruleParse(message)`.

### Phase `explain` (2 to 5 sentences, simulator numbers only)

Request:
```json
{ "phase": "explain", "message": "...", "plan": <planDigest>, "limits": {...}, "results": <digest(result)>, "before": <digest(previous result)>, "optimizer": { "why": ["..."], "plans_tried": 6240 } | null }
```
The whole facts object must be under 8,000 chars. Response: `{ "text": "..." | null, "rejected": [<numbers not found in the facts>] | null, "model": "..." }`. `text` is null when the explanation used a number that is not in the facts; the client then uses `templateExplain`.

## Tool schema

The worker currently sends the model `set_action`, `disable_action`, `enable_action`, `set_limit`, `set_budget` and `run_optimizer`. **`set_import_source`, `set_region_cut`, `set_shedding_cap` and `get_results` are implemented on the client** (`applySimTools`); for now `geoParse` in the dashboard emits them. Adding them to the worker's `TOOLS` array means the model can emit them too, with no client change needed.

| Tool | Arguments | Effect |
|---|---|---|
| `set_action` | `action`: `hold`\|`imports`\|`rental`\|`demand`\|`solar`\|`schedule`; `on?`: bool; `amount?`: number (`%` for hold/demand, MW otherwise); `start_month?`: `YYYY-MM` from 2026-12 to 2027-12 | Switch on/off, size, decision month. Lead times are applied by the simulator. |
| `disable_action` | `action` | Mark "not possible"; the optimizer will not use it. |
| `enable_action` | `action` | Possible again. |
| `set_limit` | `action`, `max`: number | Optimizer upper bound for that action. |
| `set_import_source` | `source`: `zaf`\|`moz`\|`cod`\|`nam`\|`bwa`\|`tza`\|`mwi` (an ISO3 or a country name also works); `mw?`: number; `available?`: bool | Per-neighbour imports. The `imports` action amount is the sum over available sources, capped at each source's indicative cap and at 650 MW in total. `available:false` = "can't import from X". |
| `set_region_cut` | `region`: Zambian province name (Copperbelt, Lusaka, North-Western, Central, Southern, Eastern, Northern, Luapula, Muchinga, Western); `pct`: 0 to 30 | Demand cut in that province. National `demand` % = Σ share × cut, using an **illustrative** province split (`PROVINCE_SHARE`, not sourced). |
| `set_budget` | `musd`: number | Budget for actions, USD millions. |
| `set_shedding_cap` | `h`: number \| null | Optimizer constraint: max extra load-shedding h/day (null removes it). |
| `run_optimizer` | none | Grid search for the cheapest plan within the limits. The dashboard keeps explicit map choices unless the user asked for the best plan. |
| `get_results` | none | Read-only: `getResults(result, geo)` = `digest(result)` + `imports_by_source_mw` + `demand_cut_pct_by_province`. |

`applySimTools(state, calls)` returns `{ plan, limits, geo, runOptimizer, changes[], wantResults }`; `changes` are the human-readable lines shown above the reply.

### Dashboard-only pre-processing (in `PlanDash.tsx`, not in the chat code)

`geoParse(text)` turns source-specific or province-specific phrases into `set_import_source`, `set_region_cut` or `set_shedding_cap` calls. When a specific neighbour is named, it removes the model's or rule parser's blanket `disable_action imports`. The same applies to `set_action demand` when a province is named.
