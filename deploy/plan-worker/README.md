# patronus-plan worker (copy for review)

Deployed from `C:\dev\MXB\claude-work\patronus-plan-cfg` as the Cloudflare worker `patronus-plan`
(static `web/dist` + `/api/plan-chat`). This folder is a copy for review; it is not built by Vite.

Assistant order: Claude `claude-sonnet-5-5` if the secret `ANTHROPIC_API_KEY` is set, then Workers AI
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, binding `AI`), then the browser's rule-based parser.
Cost guards: rate limits of 10 req/min per IP and 60 req/min in total, a 600-char message cap, body-size caps, max_tokens 700/500, effort low.

Set the key (a human does this; never commit it):

    npx wrangler secret put ANTHROPIC_API_KEY -c C:\dev\MXB\claude-work\patronus-plan-cfg\wrangler.jsonc

## Data chat: `POST /api/chat` (team arvin)

The floating "Ask the data" chat on the data pages calls `/api/chat`. It lives in `chat.js`. `index.js` is a small entry wrapper: it routes `/api/chat` (with CORS for `*.aui-svi.workers.dev`) and passes every other request to `worker.js` unchanged. Interface, tools and tests: [`docs/CHAT-INTERFACE.md`](../../docs/CHAT-INTERFACE.md).

**What to deploy** (from the `patronus-plan-cfg` folder):

1. Copy `index.js`, `chat.js` and `worker.js` from this folder.
2. In `wrangler.jsonc`, set `"main": "index.js"`. Keep the existing `ASSETS`, `AI`, `CHAT_IP_LIMIT` and `CHAT_GLOBAL_LIMIT` bindings; `/api/chat` reuses the rate limits.
3. Build the site with `cd web && npm run build` and deploy as before (`npx wrangler deploy -c ...\wrangler.jsonc`).

**Secret** (the same one `/api/plan-chat` uses; a person sets it, and it is never committed):

    npx wrangler secret put ANTHROPIC_API_KEY -c C:\dev\MXB\claude-work\patronus-plan-cfg\wrangler.jsonc

Without the key, `/api/chat` returns `503 {"error":"offline"}` and the chat still works with rule-based answers built from the same data files.

**How the main site reaches it:**

- Same origin (recommended): the site served by this worker calls `/api/chat` directly. No configuration is needed.
- Another worker (for example `patronus-blackout-watch`, which serves static files only): build that site with `VITE_CHAT_API=https://patronus-plan.aui-svi.workers.dev/api/chat npm run build`. The CORS allowlist in `index.js` already accepts any `https://*.aui-svi.workers.dev` origin. Without that variable the site's own `/api/chat` returns 404 and the chat falls back to offline answers.

Check after deploying: `curl https://<worker>/api/health` should show `"claude": true`. Then open `#/kariba`, click "Ask the data" and ask "How low could Kariba get by end of 2027?". The answer should be labelled `Claude (claude-sonnet-5-5) · numbers checked against the data`.
