/**
 * Conversation store for the data chat, shared by every mounted DataChat (floating or dock), kept
 * in sessionStorage so it survives page changes and reloads within the browser session.
 *
 * Loop: POST the conversation to /api/chat -> if Claude asks for tools, run them here (tools.ts)
 * and post again with the results -> show the answer. When the endpoint is offline (no key, local
 * dev, network error) the question is answered by offline.ts instead.
 */
import { useSyncExternalStore } from 'react';
import { getPlanBridge } from './planBridge';
import { runTool, sourceLabel, type Loader } from './tools';
import { offlineAnswer } from './offline';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ApiMsg = { role: 'user' | 'assistant'; content: string | any[] };
export interface UiMsg { id: number; role: 'user' | 'assistant'; text: string; sources?: string[]; changes?: string[]; via?: string; warn?: string }
export interface ChatState { ui: UiMsg[]; api: ApiMsg[]; busy: boolean; status: string | null; open: boolean }

export const ENDPOINT: string = (import.meta.env?.VITE_CHAT_API as string | undefined) || '/api/chat';
export const MAX_API_MESSAGES = 36;
export const MAX_API_BYTES = 40_000;
export const MAX_ROUNDS = 7;
const KEY = 'patronus-chat-v1';

function restore(): ChatState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.ui) && Array.isArray(s.api)) return { ui: s.ui, api: s.api, busy: false, status: null, open: !!s.open };
    }
  } catch { /* storage blocked: start fresh */ }
  return { ui: [], api: [], busy: false, status: null, open: false };
}

let state: ChatState = typeof window === 'undefined' ? { ui: [], api: [], busy: false, status: null, open: false } : restore();
const subs = new Set<() => void>();
function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  try { sessionStorage.setItem(KEY, JSON.stringify({ ui: state.ui, api: state.api, open: state.open })); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export const getChatState = () => state;
export function useChat(): ChatState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);
}
export const setOpen = (open: boolean) => set({ open });
export const resetChat = () => set({ ui: [], api: [], busy: false, status: null });

let nextId = Date.now();
const isQuestion = (m: ApiMsg) => m.role === 'user' && (typeof m.content === 'string' || m.content.some((b: any) => b.type === 'text'));

/** Drop the oldest whole turns until the history fits; always starts at a user question. */
export function trimHistory(api: ApiMsg[], maxMsgs = MAX_API_MESSAGES, maxBytes = MAX_API_BYTES): ApiMsg[] {
  let out = api;
  const size = (a: ApiMsg[]) => JSON.stringify(a).length;
  while (out.length > 1 && (out.length > maxMsgs || size(out) > maxBytes)) {
    const next = out.findIndex((m, i) => i > 0 && isQuestion(m));
    if (next < 0) break;
    out = out.slice(next);
  }
  return out;
}

export interface Transport { (body: unknown): Promise<{ status: number; json: any }> }
const httpTransport: Transport = async (body) => {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let json: any = null;
  try { json = await res.json(); } catch { /* HTML 404 from a static host */ }
  return { status: res.status, json };
};

const modelLabel = (m?: string) => (m ? `Claude (${m.split('/').pop()})` : 'Claude');

/** Ask one question. `deps` lets tests swap the network and the data loader. */
export async function ask(text: string, page: string, deps: { transport?: Transport; load?: Loader } = {}) {
  const q = text.trim().slice(0, 600);
  if (!q || state.busy) return;
  const transport = deps.transport ?? httpTransport;
  // history before this question: restored if the turn has to be abandoned, so a tool_use is never
  // left without its tool_result (F-2)
  const prior = state.api;
  let api: ApiMsg[] = trimHistory([...state.api, { role: 'user', content: q }]);
  set({ ui: [...state.ui, { id: nextId++, role: 'user', text: q }], api, busy: true, status: 'Thinking…' });
  const sources = new Set<string>();
  const changes: string[] = [];
  const samples = new Set<string>();
  const finish = (msg: Omit<UiMsg, 'id' | 'role'>, apiOut: ApiMsg[]) =>
    set({ ui: [...state.ui, { id: nextId++, role: 'assistant', ...msg }], api: apiOut, busy: false, status: null });

  const offline = async (why: string) => {
    const a = await offlineAnswer(q, { page, load: deps.load });
    finish({ text: a.text, sources: a.sources, changes: a.changes, warn: a.sample, via: `Offline answer from the data files (${why})` }, [...api, { role: 'assistant', content: a.text }]);
  };

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let r;
      try {
        r = await transport({ messages: api, page, plan: !!getPlanBridge() });
      } catch {
        return await offline('assistant unreachable');
      }
      if (r.status === 413 && round === 0) { api = trimHistory(api, 12, 16_000); continue; }
      if (r.status === 429) return finish({ text: 'Too many questions right now. Please try again in a minute.', via: 'Rate limit' }, prior);
      if (r.status === 503 || r.status === 404 || r.status === 405 || !r.json) return await offline(r.status === 503 ? 'AI assistant not configured' : 'AI assistant not available on this host');
      if (r.status >= 400 || r.json.error) return await offline(`assistant error: ${r.json?.error ?? r.status}`);
      const j = r.json;
      if (j.type === 'tool_use') {
        api = [...api, { role: 'assistant', content: j.content }];
        const results = [];
        for (const b of j.content.filter((x: any) => x.type === 'tool_use')) {
          set({ status: b.name.startsWith('get_') ? `Reading ${b.name.slice(4).replace(/_/g, ' ')}…` : 'Re-running the simulator…' });
          const out = await runTool(b.name, b.input ?? {}, deps.load);
          const s = sourceLabel(out);
          if (s) s.split(', ').forEach((x) => sources.add(x));
          if (Array.isArray(out.changes)) changes.push(...(out.changes as string[]));
          if (typeof out.sample_data_warning === 'string') samples.add(out.sample_data_warning);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out), ...(out.error ? { is_error: true } : {}) });
        }
        api = [...api, { role: 'user', content: results }];
        set({ api, status: 'Writing the answer…' });
        continue;
      }
      const content = Array.isArray(j.content) && j.content.length ? j.content : [{ type: 'text', text: j.text }];
      return finish({
        text: j.text || 'No answer came back.',
        sources: [...sources], changes,
        via: `${modelLabel(j.model)}${j.verified ? ' · numbers checked against the data' : ''}`,
        warn: [...samples, ...(j.verified ? [] : [`Could not match these numbers to the data: ${(j.unverified ?? []).join(', ')}. Treat them with care.`])].join(' ') || undefined,
      }, [...api, { role: 'assistant', content }]);
    }
    return finish({ text: 'That took too many steps. Try a narrower question.', sources: [...sources], changes }, [...api, { role: 'assistant', content: 'That took too many steps.' }]);
  } catch (e) {
    return finish({ text: `Something went wrong: ${String(e).slice(0, 100)}`, via: 'Error' }, prior);
  }
}
