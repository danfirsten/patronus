# Data chat: interface

Owner: team arvin. Ask team arvin before editing `web/src/components/chat/**` or `deploy/plan-worker/chat.js`.

The data chat is one assistant for every page that shows data. It answers questions such as "how is everything looking?" or "what's the risk for Zambia?" from the pipeline's JSON files, and on the Plan page it changes the Kariba 2027 simulator ("we can do A and B but not C, what now?"), re-runs it or the optimizer, and explains the result.

**Rule it keeps:** the model never makes up numbers. Every number in an answer comes from a tool result (the data files or the simulator). Only successful tool results count as evidence: numbers the user typed, failed tool results and list numbering ("1.", "2)") do not. The server checks this before it returns an answer. An answer with numbers that can't be matched gets one automatic rewrite. If numbers still can't be matched, the answer is shown with a warning that names them.

## Where it appears

`<ChatMount />` is mounted once, next to `<App />` in `web/src/main.tsx`. It shows the floating bubble (bottom right) only on the routes in `CHAT_ROUTES`:

`app`, `plan`, `kariba`, `map`, `watchlist`, `scoreboard`, `proof`, `explore`, `country`

It never appears on the pitch landing (`#/`) or the story page. To add or remove a page, edit `CHAT_ROUTES` in `web/src/components/chat/DataChat.tsx`.

The conversation is shared by every mounted chat and kept in `sessionStorage`, so it survives page changes and reloads in the same browser tab.

## Mount API (for the #/app dashboard dock)

```tsx
import { DataChat, usePlanBridge } from '../components/chat';

// 1. In the component that owns the simulator state, register it as the plan bridge:
usePlanBridge({ inp, plan, setPlan, limits, setLimits, setOpt });
//    inp: SimInput | null (kariba_sim.json); plan: Plan; limits: Constraints; setOpt optional

// 2. Put the panel in the dock. It fills its container (give the container a height):
<div style={{ height: 420 }}><DataChat mode="dock" page="app/plan" /></div>
```

- `mode="dock"` renders the panel only, with no bubble and no close button. While a dock is mounted the floating bubble hides itself, so there is never more than one chat on screen.
- `page` is a short route context the model sees, for example `plan` or `country/ECU`.
- While a plan bridge is registered, the chat says "Connected to the plan simulator" and offers the plan tools. When the chat changes the plan, the page's own controls update too, because the bridge calls your `setPlan` / `setLimits` / `setOpt`.
- Other exports from `web/src/components/chat/index.ts`: `ask(text, page)`, `resetChat()`, `setOpen(bool)`, `useChat()` (state), and `registerPlanBridge` / `makePlanBridge` for hosts that don't use React state.

## Tools

Tool names and schemas are defined on the server (`deploy/plan-worker/chat.js`) and run in the browser (`web/src/components/chat/tools.ts`). A test checks that the two lists match.

| Tool | Reads | Notes |
|---|---|---|
| `get_overview` | kariba, enso, watchlist, trends, scoreboard, reservoirs | for "how is everything looking?" |
| `get_kariba_forecast` | kariba.json | latest level, monthly p10/p50/p90 to Dec 2027, ZRA projection, 2024 facts, cost of waiting (illustrative) |
| `get_country(country)` | countries, watchlist, enso, trends (+ kariba for ZMB/ZWE) | takes an ISO3 code or a name |
| `get_watchlist` | watchlist.json | the country model is labelled experimental |
| `get_enso_exposure(country?)` | enso.json | |
| `get_drying_trends(country?)` | trends.json | GRACE/GRACE-FO, Mann-Kendall + Sen slope, FDR |
| `get_scoreboard` | scoreboard.json, reservoirs.json | hits and misses |
| `get_crisis_actions(crisis_id?)` | crisis_actions.json | built from `data/reference/remediation/crisis_actions.csv` by `node web/scripts/make-chat-data.mjs` |
| `get_sources` | meta.json | |
| `get_plan`, `set_action`, `disable_action`, `enable_action`, `set_limit`, `set_budget`, `run_optimizer` | plan bridge | only when a bridge is registered; uses `applyTools` from `lib/plan/chat.ts` and `optimize` from `lib/plan/sim.ts` |

Results are compact summaries (each under 9 KB). Probabilities are given as percentages in fields ending `_pct`. If a file fell back to sample fixtures, the result says so, the model is told to say so, and the chat shows a sample-data warning under the answer (online and offline).

## Server endpoint

`POST /api/chat` with body `{ messages, page, plan }`:

- `messages` is the conversation in Anthropic message format, kept by the browser.
- `page` is the route context.
- `plan` is `true` when a plan bridge is registered.

Responses:

- `{type:"tool_use", content, model}`: the browser runs the tools and posts again with `tool_result` blocks appended.
- `{type:"answer", text, content, model, verified, unverified}`: the final answer and its number check.
- `503 {error:"offline"}`: no key is set. The browser answers with rule-based templates (`offline.ts`) over the same data, and on the Plan page with the existing phrase parser (`ruleParse`). Those answers are labelled "Offline answer from the data files".
- `429` when rate-limited, `413` when the conversation is too large (the browser trims it and retries once), `400` when the request is invalid.

The model is Claude `claude-sonnet-5-5` (the same as `/api/plan-chat`), with effort `low`, `max_tokens` 900, server-side refusal fallback, and at most 6 tool rounds per question. Limits: 600 characters per user message, 40 messages, 48 KB per request, and the existing `CHAT_IP_LIMIT` / `CHAT_GLOBAL_LIMIT` rate-limit bindings.

The browser calls `/api/chat` on the same origin. To call another worker instead, build with `VITE_CHAT_API=https://patronus-plan.<acct>.workers.dev/api/chat`. CORS allows `https://*.aui-svi.workers.dev` and localhost. See `deploy/plan-worker/README.md` for deployment.

## Tests

```bash
node --test deploy/plan-worker/chat.test.mjs        # server: validation, caps, number check, retry, offline 503
cd web && npx -y vitest@2.1.9 run tests/chat         # client: tools on real data, plan bridge, offline, loop
```

Vitest is not in `package.json` (Sean's dashboard work is also changing that file), so run it with `npx`.
