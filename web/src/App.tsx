import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRoute } from './lib/router';
import { ReportContext, type DataSource } from './data/load';
import { SampleBanner, SampleContext } from './components/sample';
import { ErrorBoundary } from './components/common';
import { useAutoReveal, Wordmark, WaterlineContext } from './lib/motion';
import Home from './pages/Home';
import MapPage from './pages/MapPage';
import WatchlistPage from './pages/Watchlist';
import CountryPage from './pages/Country';
import KaribaPage from './pages/Kariba';
import ScoreboardPage from './pages/Scoreboard';
import ProofPage from './pages/Proof';

const NAV = [
  ['', 'Story'],
  ['map', 'Map'],
  ['watchlist', 'Watchlist'],
  ['kariba', 'Kariba'],
  ['scoreboard', 'Scoreboard'],
  ['proof', 'Proof'],
] as const;

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
  const route = useRoute();
  const [page, arg] = route;
  let body: ReactNode;
  switch (page) {
    case undefined: body = <Home />; break;
    case 'map': body = <MapPage />; break;
    case 'watchlist': body = <WatchlistPage />; break;
    case 'country': body = <CountryPage iso3={(arg ?? '').toUpperCase()} />; break;
    case 'kariba': body = <KaribaPage />; break;
    case 'scoreboard': body = <ScoreboardPage />; break;
    case 'proof': body = <ProofPage />; break;
    default: body = <div className="wrap page"><h1>Page not found</h1><p><a href="#/">Back to the story</a></p></div>;
  }
  const active = page === 'country' ? 'watchlist' : page ?? '';
  const mainRef = useRef<HTMLElement>(null);
  useAutoReveal(mainRef);
  const [level, setLevel] = useState<number | null>(null);
  const waterline = useMemo(() => ({ level, setLevel }), [level]);
  return (
    <WaterlineContext.Provider value={waterline}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <header className="site-header">
        <div className="wrap header-row">
          <a className="brand" href="#/" aria-label={level === null ? 'Patronus home' : `Patronus home. Waterline shows ${level.toFixed(1)}% storage`}>
            <Wordmark level={level} />
          </a>
          <nav aria-label="Main">
            {NAV.map(([k, label]) => (
              <a key={k} href={`#/${k}`} className={active === k ? 'active' : ''} aria-current={active === k ? 'page' : undefined}>{label}</a>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} ref={mainRef}>
        <PageShell key={route.join('/')}>{body}</PageShell>
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <Wordmark className="on-deep" />
          <p><strong>Patronus</strong> is an independent, public early warning for hydropower shortfalls. NASA Space Apps 2026 project. Not affiliated with or endorsed by NASA.</p>
          <p className="muted">Built with NASA Earth observation data (GRACE/GRACE-FO, POWER, G-REALM, GEOS-S2S, Black Marble) and other open sources. See <a href="#/proof">Proof</a> for methods, sources, limits and our AI-use statement.</p>
        </div>
      </footer>
    </WaterlineContext.Provider>
  );
}
