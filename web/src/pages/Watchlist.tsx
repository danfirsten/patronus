import { useMemo, useState } from 'react';
import { useData } from '../data/load';
import type { Watchlist, WatchRow } from '../data/types';
import { ExposureTag, Loading, RiskPill, SourceNote, Empty } from '../components/common';
import { ProbStrip } from '../components/small';
import { fmtDate, fmtMonth, fmtProb } from '../lib/format';
import { RISK_ORDER, TIER_LABEL, TIER_SHORT, countryHref } from '../lib/risk';

type Key = 'name' | 'tier' | 'risk' | 'p' | 'exposure';

/** Six-month country watchlist. `embedded` renders it as a section inside Map (#/map/watchlist). */
export default function WatchlistPage({ embedded = false }: { embedded?: boolean }) {
  const H = embedded ? 'h2' : 'h1';
  const w = useData<Watchlist>('watchlist.json');
  const k = useData<any>('kariba.json');
  const kfc: any[] = k.data?.forecast?.months ?? [];
  const kLast = kfc[kfc.length - 1];
  const kMaxW = Math.max(-1, ...kfc.map((m) => m.p_below_warning ?? -1));
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'risk', dir: -1 });

  const rows = useMemo(() => {
    const val = (r: WatchRow): string | number => {
      switch (sort.key) {
        case 'name': return r.name ?? '';
        case 'tier': return r.tier ?? 9;
        case 'risk': return (RISK_ORDER[r.risk_level ?? ''] ?? -1) * 10 + (r.max_p_shortfall ?? 0);
        case 'p': return r.max_p_shortfall ?? -1;
        case 'exposure': return r.enso_exposure ?? '';
      }
    };
    return [...(w.data?.countries ?? [])].sort((a, b) => {
      const va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [w.data, sort]);

  const first = w.data?.first_month ?? w.data?.countries?.[0]?.months?.[0]?.month;

  const Th = ({ k, children, className }: { k: Key; children: React.ReactNode; className?: string }) => (
    <th className={className} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="sort" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : k === 'name' ? 1 : -1 }))}>
        {children}<span aria-hidden="true">{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  );

  return (
    <div className={embedded ? 'embed' : 'wrap page'}>
      <p className="eyebrow">2026 watchlist</p>
      <H className={embedded ? 'embed-title' : undefined}>Which hydropower grids are at risk in the next six months</H>
      <p className="lede">
        Each row gives the chance that hydro output falls 15% or more below normal for the time of year.
        Issued {fmtDate(w.data?.issued)}. The first forecast month is {fmtMonth(first)}.
      </p>

      <p><span className="experimental">Experimental: modest skill, <a href="#/proof/backtest">see the back-test</a></span></p>
      <p className="small muted" style={{ maxWidth: '80ch' }}>
        Monthly country forecasts from power data have little skill beyond 1 month in our backtest. Treat these as a watchlist, not a verdict.
        The strongest early warning is for reservoirs with an El Niño signal, such as <a href="#/kariba">Lake Kariba</a>.
      </p>

      {kLast && (
        <a className="reservoir-watch" href="#/kariba">
          <span className="eyebrow">Reservoir watch · strongest signal</span>
          <span className="rw-title">Lake Kariba (Zambia, Zimbabwe)</span>
          <span>
            Chance of falling below 20% usable by {fmtMonth(kLast.month)}: <b>{fmtProb(kMaxW >= 0 ? kMaxW : kLast.p_below_warning)}</b>.
            Below 10% (danger): <b>{fmtProb(kLast.p_below_danger)}</b>. Blended El Niño and machine-learning forecast. <u>Open the Kariba case</u>
          </span>
        </a>
      )}

      <div className="key-grid">
        <div>
          <h3>Risk levels</h3>
          <p className="muted">Based on the highest monthly chance of a shortfall.</p>
          <p className="pill-key">
            <RiskPill level="low" /> under 20%
            <RiskPill level="watch" /> 20–40%
            <RiskPill level="warning" /> 40–60%
            <RiskPill level="danger" /> 60% or more
          </p>
        </div>
        <div>
          <h3>Tiers: how much we can say</h3>
          <ul className="tier-list">
            <li><b>{TIER_LABEL[1]}.</b> Countries with monthly generation data. Backtested month by month.</li>
            <li><b>{TIER_LABEL[2]}.</b> A major reservoir tracked by satellite altimetry, such as Lake Kariba.</li>
            <li><b>{TIER_LABEL[3]}.</b> Only yearly data. We show long-term trend and El Niño exposure, not a monthly forecast.</li>
          </ul>
        </div>
      </div>

      {w.loading ? <Loading /> : rows.length === 0 ? <Empty>No watchlist rows yet.</Empty> : (
        <div className="table-wrap">
          <table className="data-table watch-table">
            <thead>
              <tr>
                <Th k="name">Country</Th>
                <Th k="tier">Tier</Th>
                <Th k="risk">Risk</Th>
                <Th k="p">Max chance</Th>
                <th>Next 6 months (chance %)</th>
                <th>Drivers</th>
                <Th k="exposure">ENSO exposure</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const h = countryHref(r.iso3, r.tier);
                return (
                  <tr key={r.iso3}>
                    <td data-label="Country" className="cell-name">{h ? <a href={h}>{r.name}</a> : r.name}</td>
                    <td data-label="Tier">{r.tier ? TIER_SHORT[r.tier] ?? r.tier : '—'}</td>
                    <td data-label="Risk"><RiskPill level={r.risk_level} /></td>
                    <td data-label="Max chance" className="num">{fmtProb(r.max_p_shortfall)}</td>
                    <td data-label="Next 6 months"><ProbStrip months={r.months} /></td>
                    <td data-label="Drivers" className="cell-drivers">
                      <ul>{(r.drivers ?? []).map((d, i) => <li key={i}>{d}</li>)}</ul>
                    </td>
                    <td data-label="ENSO"><ExposureTag exposure={r.enso_exposure} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <SourceNote files={['watchlist.json']}>
        Patronus forecast from Ember monthly hydro generation, GRACE/GRACE-FO water storage, GPCP rain, NASA POWER soil wetness and NOAA ONI;
        Kariba rows from G-REALM lake levels. Forecast months {fmtMonth(first)} onward, issued {fmtDate(w.data?.issued)}.
      </SourceNote>
    </div>
  );
}
