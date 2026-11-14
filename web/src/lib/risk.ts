import type { RiskLevel } from '../data/types';
import { isNum } from './format';

/** CONTRACTS.md: <0.2 low, 0.2–0.4 watch, 0.4–0.6 warning, >=0.6 danger. */
export function riskOf(p: number | null | undefined): RiskLevel | null {
  if (!isNum(p)) return null;
  if (p >= 0.6) return 'danger';
  if (p >= 0.4) return 'warning';
  if (p >= 0.2) return 'watch';
  return 'low';
}
export const RISK_ORDER: Record<string, number> = { low: 0, watch: 1, warning: 2, danger: 3 };
export const riskVar = (r: string | null | undefined) => (r && r in RISK_ORDER ? `var(--risk-${r})` : 'var(--bg-elev-2)');
export const riskTextVar = (r: string | null | undefined) =>
  r === 'danger' || r === 'low' ? 'var(--risk-text-light)' : 'var(--risk-text-dark)';
export const RISK_LABEL: Record<string, string> = { low: 'Low', watch: 'Watch', warning: 'Warning', danger: 'Danger' };

export const EXPOSURE_LABEL: Record<string, string> = {
  el_nino_loser: 'Loses under El Niño',
  la_nina_loser: 'Loses under La Niña',
  both: 'Loses under both',
  neutral: 'No clear ENSO effect',
};
export const exposureVar = (e: string | null | undefined) =>
  e === 'el_nino_loser' ? 'var(--enso-el-nino)'
  : e === 'la_nina_loser' ? 'var(--enso-la-nina)'
  : e === 'both' ? 'var(--enso-both)'
  : e === 'neutral' ? 'var(--enso-neutral)'
  : 'var(--enso-nodata)';

export const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1: monthly generation forecast',
  2: 'Tier 2: reservoir forecast',
  3: 'Tier 3: trend and ENSO exposure only',
};
export const TIER_SHORT: Record<number, string> = { 1: 'Monthly', 2: 'Reservoir', 3: 'Exposure only' };

/** Where a country row should link. Kariba countries go to the Kariba page. */
export function countryHref(iso3: string, tier?: number): string | null {
  if (iso3 === 'ZMB' || iso3 === 'ZWE') return '#/kariba';
  if (tier === 3) return null;
  return `#/country/${encodeURIComponent(iso3)}`;
}
