import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErrorBoundary } from '../components/common';
import './app.css';

const PlanDash = lazy(() => import('./PlanDash'));
const Replay = lazy(() => import('./Replay'));
const MapPage = lazy(() => import('../pages/MapPage'));
const WatchlistPage = lazy(() => import('../pages/Watchlist'));
const KaribaPage = lazy(() => import('../pages/Kariba'));
const ProofPage = lazy(() => import('../pages/Proof'));

/** Small "i" popover for assumptions and sources (no paragraphs on the page). */
export function Info({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', off);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', off); };
  }, [open]);
  return (
    <span className="info" ref={ref}>
      <button type="button" className="info-btn" aria-expanded={open} aria-controls={id} aria-label={`About: ${label}`} onClick={() => setOpen(!open)}>i</button>
      {open && <span className="info-pop" id={id} role="dialog" aria-label={label}>{children}</span>}
    </span>
  );
}

const NAV: [string, string][] = [
  ['plan', 'Plan'], ['replay', 'Replay'], ['map', 'Map'], ['watchlist', 'Watchlist'], ['kariba', 'Kariba'], ['proof', 'Proof'],
];

export default function AppShell({ view }: { view: string }) {
  const v = NAV.some(([k]) => k === view) ? view : 'plan';
  useEffect(() => { document.title = `Patronus · ${NAV.find(([k]) => k === v)?.[1]}`; }, [v]);
  let body: ReactNode;
  switch (v) {
    case 'replay': body = <Replay />; break;
    case 'map': body = <div className="app-page"><MapPage /></div>; break;
    case 'watchlist': body = <div className="app-page"><WatchlistPage /></div>; break;
    case 'kariba': body = <div className="app-page"><KaribaPage /></div>; break;
    case 'proof': body = <div className="app-page"><ProofPage /></div>; break;
    default: body = <PlanDash />;
  }
  return (
    <div className="app">
      <header className="app-top">
        <a className="app-brand" href="#/app/plan">Patronus</a>
        <label className="app-region"><span className="sr-only">Region</span>
          <select value="kariba" onChange={(e) => { if (e.target.value === 'replay') window.location.hash = '#/app/replay'; }}>
            <option value="kariba">Lake Kariba · Zambia / Zimbabwe</option>
            <option value="replay">Other reservoirs (replay)…</option>
          </select>
        </label>
        <span className="app-flex" />
        <a className="app-back" href="#/">Back to site</a>
      </header>
      <nav className="app-nav" aria-label="Dashboard">
        {NAV.map(([k, label]) => <a key={k} href={`#/app/${k}`} className={v === k ? 'on' : ''} aria-current={v === k ? 'page' : undefined}>{label}</a>)}
      </nav>
      <main className="app-main" id="main" tabIndex={-1}>
        <ErrorBoundary label="dashboard">
          <Suspense fallback={<div className="dash-msg">Loading…</div>}>{body}</Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
