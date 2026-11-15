# patronus-plan worker (copy for review)

Deployed from `C:\dev\MXB\claude-work\patronus-plan-cfg` as the Cloudflare worker `patronus-plan`
(static `web/dist` + `/api/plan-chat`). This folder is a copy for review; it is not built by Vite.

Assistant order: Claude `claude-sonnet-5-5` if the secret `ANTHROPIC_API_KEY` is set, then Workers AI
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, binding `AI`), then the browser's rule-based parser.
Cost guards: rate limits of 10 req/min per IP and 60 req/min in total, a 600-char message cap, body-size caps, max_tokens 700/500, effort low.

Set the key (a human does this; never commit it):

    npx wrangler secret put ANTHROPIC_API_KEY -c C:\dev\MXB\claude-work\patronus-plan-cfg\wrangler.jsonc
