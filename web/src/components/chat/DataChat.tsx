import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { ask, resetChat, setOpen, useChat } from './store';
import { getPlanBridge, subscribePlanBridge } from './planBridge';
import './chat.css';

/** Pages that show data. The chat never appears on the pitch landing ('') or the story page. */
export const CHAT_ROUTES = ['app', 'plan', 'kariba', 'map', 'watchlist', 'scoreboard', 'proof', 'explore', 'country'];

function suggestions(page: string, plan: boolean): string[] {
  const [p, arg] = page.split('/');
  if (plan) return ["We can import power and rent diesel, but mines won't curtail. What should we do?", 'We only have $100 million. What is the best plan?', 'What does the current plan cost?'];
  if (p === 'kariba') return ['How low could Kariba get by end of 2027?', 'How did the 2024 crisis unfold?', 'What did Zambia do in 2024?'];
  if (p === 'country' && arg) return [`What's the risk for ${arg.toUpperCase()}?`, 'How is everything looking?', `Is ${arg.toUpperCase()} hurt by El Niño?`];
  if (p === 'proof' || p === 'scoreboard') return ['What did Patronus catch and miss?', 'How early was Kariba 2024 flagged?', 'Which data sources do you use?'];
  if (p === 'explore') return ['Which hydro basins are drying fastest?', 'How much hydropower sits in drying basins?', 'How is everything looking?'];
  return ['How is everything looking?', "What's the risk for Zambia?", 'Which countries are on alarm?'];
}

/** Minimal rendering of the model's text: paragraphs, "- " bullets and **bold**. No HTML is injected. */
function Rich({ text }: { text: string }) {
  const inline = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const blocks: JSX.Element[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) blocks.push(<ul key={blocks.length} className="chat-list">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length} className="chat-text">{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

let docks = 0;
const dockSubs = new Set<() => void>();
const useDockCount = () => useSyncExternalStore((f) => { dockSubs.add(f); return () => { dockSubs.delete(f); }; }, () => docks);
const usePlanOpen = () => useSyncExternalStore(subscribePlanBridge, () => !!getPlanBridge());

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 9.5h8M8 12.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export interface DataChatProps {
  /** 'floating': bubble bottom-right that opens a panel. 'dock': the panel only, fills its container. */
  mode?: 'floating' | 'dock';
  /** Route context sent to the model, e.g. 'plan' or 'country/ECU'. */
  page: string;
}

/** The Patronus data chat. One conversation is shared by every mounted instance. */
export default function DataChat({ mode = 'floating', page }: DataChatProps) {
  const s = useChat();
  const plan = usePlanOpen();
  const dockCount = useDockCount();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(s.open);

  useEffect(() => {
    if (mode !== 'dock') return;
    docks++; dockSubs.forEach((f) => f());
    return () => { docks--; dockSubs.forEach((f) => f()); };
  }, [mode]);

  const open = mode === 'dock' || s.open;
  useEffect(() => {
    if (mode !== 'floating') return;
    if (s.open && !wasOpen.current) inputRef.current?.focus();
    if (!s.open && wasOpen.current) fabRef.current?.focus();
    wasOpen.current = s.open;
  }, [s.open, mode]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [s.ui.length, s.busy, open]);

  if (mode === 'floating' && dockCount > 0) return null;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || s.busy) return;
    setText('');
    void ask(t, page);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  if (!open) {
    return (
      <button ref={fabRef} type="button" className="chat-fab" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="data-chat">
        <ChatIcon /><span>Ask the data</span>
      </button>
    );
  }

  return (
    <section id="data-chat" className={`chat-panel chat-${mode}`} role={mode === 'floating' ? 'dialog' : 'region'} aria-labelledby="chat-title"
      onKeyDown={(e) => { if (e.key === 'Escape' && mode === 'floating') setOpen(false); }}>
      <header className="chat-head">
        <div>
          <h2 id="chat-title" className="chat-title">Ask the data <span className="si-label">AI assistant (SI)</span></h2>
          <p className="chat-sub">{plan ? 'Connected to the plan simulator' : 'Answers use only Patronus data files'}</p>
        </div>
        <div className="chat-head-actions">
          {s.ui.length > 0 && <button type="button" className="chat-ghost" onClick={resetChat} disabled={s.busy}>New chat</button>}
          {mode === 'floating' && (
            <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
      </header>

      <div className="chat-log" ref={logRef} aria-live="polite" aria-busy={s.busy}>
        {s.ui.length === 0 && (
          <div className="chat-empty">
            <p>{plan ? 'Tell me what you can and cannot do. I change the simulator, re-run it, and explain the result.' : 'Ask about Lake Kariba, a country, El Niño, drying basins or our track record. Every number comes from the data, with its source.'}</p>
            <ul className="chat-chips">
              {suggestions(page, plan).map((q) => <li key={q}><button type="button" onClick={() => void ask(q, page)} disabled={s.busy}>{q}</button></li>)}
            </ul>
          </div>
        )}
        {s.ui.map((m) => (
          <div key={m.id} className={`chat-msg chat-${m.role}`}>
            <span className="sr-only">{m.role === 'user' ? 'You said:' : 'Assistant:'}</span>
            {m.changes && m.changes.length > 0 && <ul className="chat-changes" aria-label="Simulator changes">{m.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            {m.role === 'assistant' ? <Rich text={m.text} /> : <p className="chat-text">{m.text}</p>}
            {m.warn && <p className="chat-warn">{m.warn}</p>}
            {m.sources && m.sources.length > 0 && !/\bSource:/.test(m.text) && <p className="chat-meta">Data: {m.sources.join(', ')}</p>}
            {m.via && <p className="chat-meta">{m.via}</p>}
          </div>
        ))}
        {s.busy && <div className="chat-msg chat-assistant chat-pending"><p className="chat-text">{s.status ?? 'Thinking…'}</p></div>}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">Your question</label>
        <textarea id="chat-input" ref={inputRef} rows={1} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={plan ? "e.g. We can't import power. What now?" : "e.g. What's the risk for Zambia?"} autoComplete="off" />
        <button type="submit" className="chat-send" disabled={s.busy || !text.trim()} aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </form>
    </section>
  );
}
