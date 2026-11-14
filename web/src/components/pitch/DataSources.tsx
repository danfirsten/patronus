import { CountUp } from '../../lib/motion';
import { fmtNum, isNum } from '../../lib/format';
import { Fn } from './sources';
import { TWh } from './units';
import { InView } from './InView';

export interface MetaSource { id: string; name: string; provider: string; nasa: boolean; url: string | null; coverage: string; use?: string }

/** Plain names and one plain line per NASA record. Unknown ids fall back to meta.json's own name. */
const PLAIN: Record<string, { name: string; what: string }> = {
  gravis: { name: 'GRACE and GRACE-FO', what: 'Twin satellites that measure the water stored on land, including underground, from tiny changes in gravity.' },
  power: { name: 'NASA POWER', what: 'Rainfall, soil wetness and temperature for every point on Earth.' },
  grealm: { name: 'G-REALM', what: 'Lake and reservoir water levels from satellite radar. This is how we track Lake Kariba.' },
  gpcp: { name: 'GPCP', what: 'Monthly rainfall from satellites and rain gauges combined.' },
  geos_s2s: { name: 'GEOS-S2S', what: 'NASA’s seasonal forecasts of the ocean and the weather, months ahead.' },
  gibs_blackmarble: { name: 'Black Marble', what: 'Night-time light seen from space, which shows where the power went out.' },
};

/** "2002-04..2026-08, monthly" -> "2002 to 2026"; open-ended records read "to now". */
export function coverageYears(c: string): string {
  const years = (c.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number);
  if (!years.length) return 'Current forecasts';
  const open = /present/i.test(c) || /\.\.\s*[;,]/.test(c) || /\.\.\s*$/.test(c) || years.length === 1;
  return open ? `${years[0]} to now` : `${years[0]} to ${years[1]}`;
}

const host = (u: string) => u.replace(/^(https?:\/\/[^/]+).*$/, '$1');

export interface NasaMission { mission: string; source_id: string }

/**
 * The data behind it, read live from meta.json: every count is computed here, never typed in.
 * Count row inspired by 21st.dev "Number Ticker" (ShadcnSpace); it uses the design system's
 * CountUp (expo-out, about 1.4 s, still under prefers-reduced-motion) instead of @number-flow.
 */
export function DataSources({ sources, missions, nCountries, loading }: { sources: MetaSource[] | null; missions?: NasaMission[] | null; nCountries: number | null; loading: boolean }) {
  if (loading) return <section className="pt-section"><div className="wrap"><p className="pt-state">Loading the data sources…</p></div></section>;
  if (!sources) return <section className="pt-section"><div className="wrap"><p className="pt-state">The data sources could not be loaded. See the Proof page.</p></div></section>;
  const nasa = sources.filter((s) => s.nasa);
  const others = sources.filter((s) => !s.nasa);
  const nasaYears = nasa.map((s) => (s.coverage.match(/\b(19|20)\d{2}\b/) ?? [])[0]).filter(Boolean).map(Number);
  const since = nasaYears.length ? Math.min(...nasaYears) : null;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  // The satellite missions behind each record (meta.json nasa_data_summary), unless it only repeats the name.
  const mission = (id: string) => {
    const m = missions?.find((x) => x.source_id === id)?.mission ?? null;
    const name = PLAIN[id]?.name;
    return m && name && norm(m) === norm(name) ? null : m;
  };
  const providers = [...new Set(others.filter((s) => s.url).map((s) => s.provider.split(/[(/;]/)[0].trim()))];

  return (
    <section className="pt-section" id="pt-data" aria-labelledby="pt-data-h">
      <div className="wrap">
        <InView className="pt-head">
          <p className="eyebrow">The data</p>
          <h2 id="pt-data-h" className="pt-h2">{sources.length} data sources, {nasa.length} from <span className="pt-key">NASA</span><Fn k="meta" /></h2>
          <p className="pt-intro">
            Open satellite and agency records. We follow the {isNum(nCountries) ? nCountries : '—'} countries where hydropower makes at least 30% of electricity and at least <TWh value={1} /> a year.<Fn k="enso" />
          </p>
        </InView>
        <div className="stat-row pt-stats">
          <div className="stat"><p className="stat-value"><CountUp value={sources.length} /></p><p className="stat-label">data sources</p></div>
          <div className="stat stat-accent"><p className="stat-value"><CountUp value={nasa.length} /></p><p className="stat-label">from NASA</p></div>
          <div className="stat"><p className="stat-value">{since ?? '—'}</p><p className="stat-label">oldest NASA record starts</p></div>
          <div className="stat"><p className="stat-value"><CountUp value={isNum(nCountries) ? nCountries : '—'} /></p><p className="stat-label">countries followed</p></div>
        </div>
        <InView>
          <ul className="pt-nasa" aria-label="NASA data used">
            {nasa.map((s) => {
              const p = PLAIN[s.id];
              return (
                <li key={s.id}>
                  <p className="pt-nasa-name">{p?.name ?? s.name}</p>
                  <p className="pt-nasa-what">{p?.what ?? s.use ?? ''}</p>
                  {mission(s.id) ? <p className="pt-nasa-mission">{mission(s.id)}</p> : null}
                  <p className="pt-nasa-cov">{coverageYears(s.coverage)}</p>
                  <p className="pt-nasa-link">{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{host(s.url)}</a> : null}</p>
                </li>
              );
            })}
          </ul>
          <p className="pt-small pt-muted pt-others">
            The other {fmtNum(others.length)} come from {providers.join(', ')} and cited news reports. <a href="#/proof">Every source, with licences</a>
          </p>
        </InView>
      </div>
    </section>
  );
}
