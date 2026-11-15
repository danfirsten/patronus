import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRoute } from './lib/router';
import { ReportContext, type DataSource } from './data/load';
import { SampleBanner, SampleContext } from './components/sample';
import { ErrorBoundary } from './components/common';
import { useAutoReveal, Wordmark, WaterlineContext } from './lib/motion';
import Pitch from './pages/Pitch';
import Home from './pages/Home';
import MapPage from './pages/MapPage';
import CountryPage from './pages/Country';
import KaribaPage from './pages/Kariba';
import ProofPage from './pages/Proof';
import Explore from './pages/Explore';
import PlanPage from './pages/Plan';
const AppShell = lazy(() => import('./app/Shell'));

/** Four top-level destinations. Old routes stay reachable (see ALIAS). */
const NAV = [
  ['', 'Overview'],
  ['kariba', 'Kariba 2027'],
  ['map', 'Map'],
  ['app/plan', 'Plan'],
  ['explore', 'Trend Detective'],
  ['proof', 'Proof'],
] as const;

/** Retired top-level routes -> [page, section]. Old links and shared URLs keep working. */
const ALIAS: Record<string, [string, string]> = {
  scoreboard: ['proof', 'backtest'],
  watchlist: ['map', 'watchlist'],
};
/** Which nav item a page belongs to. */
const SECTION_OF: Record<string, string> = { story: '', country: 'map', plan: 'app/plan' };

/** Scroll to an in-page section once it has rendered (data loads async, so retry briefly). */
function useScrollToSection(id: string | undefined, key: string) {
  useEffect(() => {
    if (!id) return;
    let n = 0;
    let t: number;
    const go = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: 'start' });
      if (n++ < 6) t = window.setTimeout(go, n < 3 ? 120 : 400);
    };
    t = window.setTimeout(go, 0);
    const stop = () => { n = 99; };
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    return () => { window.clearTimeout(t); window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); };
  }, [id, key]);
}

function PageShell({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState(new Map<string, { source: DataSource; reason?: string }>());
  const report = useCallback((file: string, source: DataSource, reason?: string) => {
    setFiles((prev) => {
      const cur = prev.get(file);
      if (cur && cur.source === source) return prev;
      const next = new Map(prev);
      next.set(file, { source, reason });
      return next;
    });
  }, []);
  const sample = useMemo(() => new Set([...files].filter(([, v]) => v.source === 'fixture').map(([k]) => k)), [files]);
  return (
    <ReportContext.Provider value={report}>
      <SampleContext.Provider value={sample}>
        <SampleBanner files={files} />
        <div className="route-enter">
          <ErrorBoundary label="page">{children}</ErrorBoundary>
        </div>
      </SampleContext.Provider>
    </ReportContext.Provider>
  );
}

export default function App() {
  const raw = useRoute();
  const route = ALIAS[raw[0] ?? ''] ?? raw;
  const [page, arg] = route;
  const section = page === 'country' ? undefined : arg;
  useScrollToSection(section, raw.join('/'));
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [raw.join('/')]);
  useEffect(() => {
    if (!menu) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [menu]);
  let body: ReactNode;
  switch (page) {
    case undefined: body = <Pitch />; break;
    case 'story': body = <Home />; break;
    case 'map': body = <MapPage />; break;
    case 'country': body = <CountryPage iso3={(arg ?? '').toUpperCase()} />; break;
    case 'kariba': body = <KaribaPage />; break;
    case 'proof': body = <ProofPage />; break;
    case 'explore': body = <Explore />; break;
    case 'plan': body = <PlanPage />; break;
    case 'app': body = null; break;
    default: body = <div className="wrap page"><h1>Page not found</h1><p><a href="#/">Back to the overview</a></p></div>;
  }
  const active = SECTION_OF[page ?? ''] ?? page ?? '';
  const shellKey = page === 'country' ? `country/${arg ?? ''}` : page ?? '';
  const mainRef = useRef<HTMLElement>(null);
  useAutoReveal(mainRef);
  const [level, setLevel] = useState<number | null>(null);
  const waterline = useMemo(() => ({ level, setLevel }), [level]);
  if (page === 'app') {
    return (
      <PageShell key="app">
        <Suspense fallback={null}><AppShell view={arg ?? 'plan'} /></Suspense>
      </PageShell>
    );
  }
  return (
    <WaterlineContext.Provider value={waterline}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <header className="site-header">
        <div className="wrap header-row">
          <a className="brand" href="#/" aria-label={level === null ? 'Patronus home' : `Patronus home. Waterline shows ${level.toFixed(1)}% storage`}>
            <Wordmark level={level} />
          </a>
          <nav aria-label="Main" id="site-nav" className={menu ? 'nav open' : 'nav'}>
            <ul>
              {NAV.map(([k, label]) => (
                <li key={k}><a href={`#/${k}`} className={active === k ? 'active' : ''} aria-current={active === k ? 'page' : undefined}>{label}</a></li>
              ))}
            </ul>
            <a className="button nav-cta" href="#/kariba/forecast">2027 forecast</a>
          </nav>
          <button type="button" className="menu-btn" aria-expanded={menu} aria-controls="site-nav" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu((m) => !m)}>
            <span className="menu-icon" aria-hidden="true"><i /><i /></span>
            <span className="menu-word">{menu ? 'Close' : 'Menu'}</span>
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} ref={mainRef} className={page === undefined ? 'is-landing' : 'is-sub'}>
        <PageShell key={shellKey}>{body}</PageShell>
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <Wordmark className="on-deep" />
          <p><strong>Patronus</strong> is an independent, public early warning for hydropower shortfalls. NASA Space Apps 2026 project. Not affiliated with or endorsed by NASA.</p>
          <p className="muted">Built with NASA Earth observation data (GRACE/GRACE-FO, POWER, G-REALM, GEOS-S2S, Black Marble, GPCP) and other open sources. See <a href="#/proof">Proof</a> for methods, sources, limits and our AI-use statement.</p>
        </div>
      </footer>
    </WaterlineContext.Provider>
  );
}
