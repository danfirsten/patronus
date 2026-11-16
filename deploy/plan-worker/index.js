// SI-assisted: written with AI coding tools (Claude Code / Codex), reviewed by the team
// Worker entry for patronus-plan: adds POST /api/chat (the data chat, chat.js) in front of the
// existing worker (worker.js: static site + /api/plan-chat), without editing worker.js.
// Deploy with `main` pointing at this file; see README.md.
//
// CORS: same-origin needs nothing. Other Patronus sites (e.g. patronus-blackout-watch) may call
// /api/chat cross-origin if their origin matches ALLOWED_ORIGIN (*.aui-svi.workers.dev, localhost).
import planWorker from './worker.js';
import { handleChat } from './chat.js';

export const ALLOWED_ORIGIN = /^https:\/\/[a-z0-9-]+\.aui-svi\.workers\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function cors(origin) {
  if (!origin || !ALLOWED_ORIGIN.test(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      const h = cors(request.headers.get('origin'));
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
      let res;
      try {
        res = await handleChat(request, env);
      } catch {
        res = new Response(JSON.stringify({ error: 'ai_failed' }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
      return out;
    }
    return planWorker.fetch(request, env, ctx);
  },
};
