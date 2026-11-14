import { useMemo, useState } from 'react';
import { useData } from '../data/load';
import type { Watchlist, WatchRow } from '../data/types';
import { ExposureTag, Loading, RiskPill, SourceNote, Empty } from '../components/common';
import { ProbStrip } from '../components/small';
import { fmtDate, fmtMonth, fmtProb } from '../lib/format';
import { RISK_ORDER, TIER_LABEL, TIER_SHORT, countryHref } from '../lib/risk';

type Key = 'name' | 'tier' | 'risk' | 'p' | 'exposure';

export default function WatchlistPage() {
  const w = useData<Watchlist>('watchlist.json');
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
    <div className="wrap page">
      <p className="eyebrow">2026 watchlist</p>
      <h1>Which hydropower grids are at risk in the next six months</h1>
      <p className="lede">
        Each row gives the chance that hydro output falls 15% or more below normal for the time of year.
        Issued {fmtDate(w.data?.issued)}. The first forecast month is {fmtMonth(first)}.
      </p>

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
                      <ul>{(r.drivers ?? []).map((d) => <li key={d}>{d}</li>)}</ul>
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
        Patronus forecast from Ember monthly hydro generation, GRACE/GRACE-FO water storage, NASA POWER rain and soil wetness and NOAA ONI;
        Kariba rows from G-REALM lake levels. Forecast months {fmtMonth(first)} onward, issued {fmtDate(w.data?.issued)}.
      </SourceNote>
    </div>
  );
}
