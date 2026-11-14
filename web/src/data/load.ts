import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Data loading with fixture fallback.
 *
 * 1. Fetch `data/<file>` relative to the page (pipeline output in web/public/data/).
 * 2. If the fetch fails, returns non-JSON (a dev server's index.html), or fails the
 *    file's shape check, load `src/fixtures/<file>` instead.
 * 3. Every page reports which files came from fixtures; the layout then shows the
 *    "Sample data: pipeline output not loaded" banner, and chart source lines get a
 *    SAMPLE tag. Fixtures can never pass silently as results.
 */

export type DataSource = 'real' | 'fixture' | 'missing';
export interface Loaded<T> {
  data: T | null;
  source: DataSource;
  reason?: string;
}

// Lazy chunks: fixture JSON is only downloaded when a real file is absent.
const fixtureLoaders = import.meta.glob('../fixtures/**/*.json');

function fixtureKey(file: string) {
  const name = file.endsWith('.json') ? file : `${file}.json`;
  return `../fixtures/${name}`;
}

export function hasFixture(file: string) {
  return fixtureKey(file) in fixtureLoaders;
}

type Check = (d: any) => boolean;

// Minimal shape checks, so a half-written pipeline file falls back instead of crashing a page.
const checks: Record<string, Check> = {
  'watchlist.json': (d) => Array.isArray(d?.countries),
  'trends.json': (d) => Array.isArray(d?.basins),
  'basins.geojson': (d) => Array.isArray(d?.features),
  'enso.json': (d) => Array.isArray(d?.countries),
  'scoreboard.json': (d) => Array.isArray(d?.rows),
  'ledger.json': (d) => Array.isArray(d?.entries),
  'nightlights.json': (d) => Array.isArray(d?.frames),
  'countries.json': (d) => Array.isArray(d?.countries),
  'kariba.json': (d) => d && typeof d === 'object' && (Array.isArray(d.history) || d.forecast),
  'generation_backtest.json': (d) => d && typeof d === 'object',
  'meta.json': (d) => Array.isArray(d?.sources),
  'crises.json': (d) => d && typeof d === 'object',
};
const countryCheck: Check = (d) => d && typeof d === 'object' && typeof d.iso3 === 'string';

const cache = new Map<string, Promise<Loaded<any>>>();

async function loadFixture(file: string, reason: string): Promise<Loaded<any>> {
  const loader = fixtureLoaders[fixtureKey(file)];
  if (!loader) return { data: null, source: 'missing', reason };
  const mod: any = await loader();
  return { data: mod.default ?? mod, source: 'fixture', reason };
}

async function load(file: string): Promise<Loaded<any>> {
  const check = file.startsWith('country/') ? countryCheck : checks[file] ?? ((d: any) => d != null);
  try {
    const res = await fetch(`data/${file}`, { cache: 'no-cache' });
    if (!res.ok) return loadFixture(file, `HTTP ${res.status}`);
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return loadFixture(file, 'not JSON (file missing)');
    }
    if (!check(json)) return loadFixture(file, 'unexpected shape');
    return { data: json, source: 'real' };
  } catch (e) {
    return loadFixture(file, String(e));
  }
}

export function loadData<T>(file: string): Promise<Loaded<T>> {
  let p = cache.get(file);
  if (!p) {
    p = load(file);
    cache.set(file, p);
  }
  return p as Promise<Loaded<T>>;
}

/** Fetch optional text (e.g. briefs/*.md). Returns null when absent. No fixture. */
export async function loadText(file: string): Promise<string | null> {
  try {
    const res = await fetch(`data/${file}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return null;
    const t = await res.text();
    if (t.trimStart().startsWith('<!doctype') || t.trimStart().startsWith('<html')) return null;
    return t;
  } catch {
    return null;
  }
}

// ---- page-level reporting for the banner ----
export type Reporter = (file: string, source: DataSource, reason?: string) => void;
export const ReportContext = createContext<Reporter>(() => {});

export function useData<T>(file: string | null): Loaded<T> & { loading: boolean } {
  const report = useContext(ReportContext);
  const [state, setState] = useState<(Loaded<T> & { loading: boolean })>({ data: null, source: 'missing', loading: true });
  useEffect(() => {
    if (!file) return;
    let alive = true;
    setState({ data: null, source: 'missing', loading: true });
    loadData<T>(file).then((r) => {
      if (!alive) return;
      setState({ ...r, loading: false });
      report(file, r.source, r.reason);
    });
    return () => {
      alive = false;
    };
  }, [file, report]);
  return state;
}
