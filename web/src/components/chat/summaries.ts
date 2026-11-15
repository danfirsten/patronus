/**
 * Compact, model-sized summaries of the pipeline JSON (web/public/data). Pure functions: the chat
 * tools pass in parsed files and send the result to the model as a tool result. Every number the
 * assistant may quote comes from here (or the plan simulator), so keep values copied, not derived,
 * except for rounding and probability -> percent (fields named *_pct).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

const r1 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
/** probability (0-1) -> percent with one decimal */
const pct = (p: unknown) => (typeof p === 'number' && Number.isFinite(p) ? Math.round(p * 1000) / 10 : null);

export interface CountryRef { iso3: string; name: string }

/** Resolve "Zambia", "zmb", "ZMB", "Sichuan" to an ISO3 from countries.json. */
export function resolveCountry(q: string, countries: J): CountryRef | null {
  const list: J[] = countries?.countries ?? [];
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return null;
  const exact = list.find((c) => c.iso3.toLowerCase() === s || c.name.toLowerCase() === s);
  if (exact) return { iso3: exact.iso3, name: exact.name };
  const part = list.find((c) => c.name.toLowerCase().includes(s) || s.includes(c.name.toLowerCase()));
  return part ? { iso3: part.iso3, name: part.name } : null;
}

/** Find country names mentioned in free text (longest names first). */
export function findCountriesInText(text: string, countries: J): CountryRef[] {
  const t = ` ${text.toLowerCase()} `;
  const list: J[] = [...(countries?.countries ?? [])].sort((a, b) => b.name.length - a.name.length);
  const out: CountryRef[] = [];
  for (const c of list) {
    const n = c.name.toLowerCase();
    const re = new RegExp(`[^a-z]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`);
    if (re.test(t) || new RegExp(`[^a-z]${c.iso3.toLowerCase()}[^a-z]`).test(t)) {
      if (!out.some((o) => o.iso3 === c.iso3)) out.push({ iso3: c.iso3, name: c.name });
    }
  }
  return out;
}

export function karibaSummary(k: J) {
  const f = k?.forecast ?? {};
  const cow = k?.cost_of_waiting ?? {};
  const z = k?.zra_projection ?? {};
  return {
    source_file: 'kariba.json',
    datasets: 'G-REALM satellite lake level, NASA POWER rain and soil, GRACE-FO storage, NOAA ONI / NASA GEOS-S2S ENSO, ZRA gauge',
    issued: f.issued ?? k?.issue_date ?? null,
    latest: k?.latest ? {
      date: k.latest.date, level_m: k.latest.level_m, usable_pct: r1(k.latest.usable_pct), usable_bcm: r1(k.latest.usable_bcm),
      zra_gauge: k.latest.zra_gauge ? { date: k.latest.zra_gauge.date, level_m: k.latest.zra_gauge.level_m, usable_pct: r1(k.latest.zra_gauge.usable_pct) } : null,
    } : null,
    thresholds: { warning_usable_pct: k?.thresholds?.warning_usable_pct ?? null, danger_usable_pct: k?.thresholds?.danger_usable_pct ?? null, min_operating_m: k?.thresholds?.min_operating_m ?? null },
    forecast_model: f.model ?? null,
    forecast_months: (f.months ?? []).map((m: J) => ({
      month: m.month, usable_pct_p10: r1(m.usable_p10), usable_pct_p50: r1(m.usable_p50), usable_pct_p90: r1(m.usable_p90),
      chance_below_warning_pct: pct(m.p_below_warning), chance_below_danger_pct: pct(m.p_below_danger),
    })),
    dec_2027: z.patronus_dec_2027 ? {
      usable_pct_p10: r1(z.patronus_dec_2027.usable_p10), usable_pct_p50: r1(z.patronus_dec_2027.usable_p50), usable_pct_p90: r1(z.patronus_dec_2027.usable_p90),
      chance_below_warning_pct: pct(z.patronus_dec_2027.p_below_warning), chance_below_danger_pct: pct(z.patronus_dec_2027.p_below_danger),
    } : null,
    zra_projection: z.end_2027_usable_pct != null ? { end_2027_usable_pct: z.end_2027_usable_pct, allocation_2027_bcm: z.allocation_2027_bcm, allocation_2026_bcm: z.allocation_2026_bcm, comparison: z.comparison ?? null } : null,
    enso_outlook: k?.enso_outlook ?? null,
    crisis_2024: k?.crisis_2024_facts ? {
      zra_cut: k.crisis_2024_facts.zra_cut?.text, zra_cut_date: k.crisis_2024_facts.zra_cut?.date,
      load_shedding_8h_from: k.crisis_2024_facts.load_shedding_8h, load_shedding_12h_from: k.crisis_2024_facts.load_shedding_12h,
      low_point: k.crisis_2024_facts.low_point, imf: k.crisis_2024_facts.imf?.text,
    } : null,
    cost_of_waiting: cow.headline ? { illustrative_only: true, headline: cow.headline, note: cow.headline_note ?? null } : null,
  };
}

export function watchlistSummary(w: J) {
  const rows: J[] = w?.countries ?? [];
  return {
    source_file: 'watchlist.json',
    datasets: 'Ember monthly hydro generation, GRACE-FO storage, GPCP rain, NASA POWER soil/temperature, NOAA ONI',
    issued: w?.issued ?? null,
    model_note: 'Experimental: the country monthly model has little skill (see get_scoreboard).',
    alarm_definition: w?.alarm_definition ?? null,
    countries: rows.map((c) => ({ iso3: c.iso3, name: c.name, risk_level: c.risk_level, chance_any_shortfall_6m_pct: pct(c.p_any_shortfall_6m), alarm: c.alarm })),
    on_alarm: rows.filter((c) => c.alarm).map((c) => c.name),
  };
}

export function ensoSummary(e: J, iso3?: string) {
  const s = e?.summary ?? {};
  const o = e?.outlook ?? {};
  const row = (c: J) => ({
    iso3: c.iso3, name: c.name, exposure: c.exposure, variable: c.variable, el_nino_effect_pct: r1(c.el_nino_effect_pct), el_nino_p: c.el_nino_p,
    la_nina_effect_pct: r1(c.la_nina_effect_pct), la_nina_p: c.la_nina_p, confidence: c.confidence, robust: c.robust ?? null,
    current_implication: c.current_implication ?? null, hydro_gw: c.hydro_gw ?? null,
  });
  const base = {
    source_file: 'enso.json',
    datasets: 'GPCP v2.3 rain (NASA GSFC), NASA POWER MERRA-2 cross-check, G-REALM Kariba level, NOAA ONI; permutation tests',
    outlook: { status: o.status ?? null, summary: o.summary ?? null, oni_latest: o.oni_latest ?? null, issued: o.issued ?? null },
  };
  if (iso3) {
    const c = (e?.countries ?? []).find((x: J) => x.iso3 === iso3);
    return { ...base, country: c ? row(c) : null, note: c ? undefined : `No ENSO fingerprint for ${iso3}.` };
  }
  return {
    ...base,
    el_nino_losers: s.el_nino_losers ?? [], gw_el_nino_losers: s.gw_el_nino_losers ?? null, n_el_nino_losers: s.n_el_nino_losers ?? null,
    la_nina_losers: s.la_nina_losers ?? [], gw_la_nina_losers: s.gw_la_nina_losers ?? null,
    n_countries: s.n_countries ?? null, expected_false_losers_per_phase: s.expected_false_losers_per_phase ?? null,
    losers: (e?.countries ?? []).filter((c: J) => /loser/.test(c.exposure ?? '')).map(row),
  };
}

export function trendsSummary(t: J, iso3?: string) {
  const s = t?.summary ?? {};
  const base = {
    source_file: 'trends.json',
    datasets: 'GRACE/GRACE-FO terrestrial water storage (GFZ GravIS), GPCP rain; Mann-Kendall + Sen slope, Benjamini-Hochberg FDR q<0.05',
    period: t?.period ?? null,
  };
  const basin = (b: J) => ({
    name: b.name, countries: b.countries, hydro_gw: r1(b.hydro_gw), trend_class: b.trend_class,
    tws_slope_cm_per_decade: r1(b.tws_slope_cm_per_decade), tws_q: b.tws_q, rain_decline_significant: b.precip_decline_significant ?? null,
  });
  if (iso3) {
    const list = (t?.basins ?? []).filter((b: J) => (b.countries ?? []).includes(iso3)).sort((a: J, b: J) => (b.hydro_gw ?? 0) - (a.hydro_gw ?? 0));
    return { ...base, country: iso3, n_basins: list.length, gw_drying: r1(list.filter((b: J) => b.trend_class === 'drying').reduce((a: number, b: J) => a + (b.hydro_gw ?? 0), 0)), largest_basins: list.slice(0, 5).map(basin) };
  }
  return {
    ...base,
    headline: s.headline ?? null, headline_supporting: s.headline_supporting ?? null,
    gw_total: s.gw_total, gw_drying: s.gw_drying, gw_drying_pct: s.gw_drying_pct, n_drying: s.n_drying, gw_wetting: s.gw_wetting, n_wetting: s.n_wetting,
    gw_drying_with_rain_decline: s.split?.gw_drying_with_rain_decline ?? null, gw_drying_without_rain_decline: s.split?.gw_drying_without_rain_decline ?? null,
    top_drying: (s.top_drying ?? []).slice(0, 5).map(basin),
  };
}

export function scoreboardSummary(sb: J, res: J) {
  const rs = res?.summary ?? {};
  return {
    source_file: 'scoreboard.json, reservoirs.json',
    headline: sb?.summary?.headline ?? null,
    n_crises: sb?.summary?.n_crises ?? null, n_caught: sb?.summary?.n_caught ?? null,
    crises: (sb?.rows ?? []).map((r: J) => ({ name: r.name, caught_by: r.caught_by, lead_months: r.lead_months, lead_vs_official_months: r.lead_vs_official_months })),
    reservoir_backtest: rs.n_crises_scored != null ? {
      n_reservoirs: rs.n_reservoirs, crises_scored: rs.n_crises_scored, caught: rs.n_crises_caught, missed: rs.n_crises_missed,
      caught_by_forecast: rs.n_crises_caught_by_forecast, caught_while_already_low: rs.n_crises_caught_while_already_low,
      caught_by_persistence_baseline: rs.n_crises_caught_by_persistence_baseline, median_lead_months: rs.median_lead_months,
      false_alarm_runs: rs.episodes?.false_alarm_runs ?? null, lead_note: rs.lead_note ?? null,
    } : null,
  };
}

export function crisisActionsSummary(ca: J, crisisId?: string) {
  const crises = ca?.crises ?? {};
  const ids = Object.keys(crises);
  const id = crisisId && (crises[crisisId] ? crisisId : ids.find((k) => k.startsWith(String(crisisId).toLowerCase().split('-')[0])));
  if (!id) return { source_file: 'crisis_actions.json (from data/reference/remediation/crisis_actions.csv)', crises_available: ids.map((k) => ({ id: k, n_entries: crises[k].length })) };
  return {
    source_file: 'crisis_actions.json (from data/reference/remediation/crisis_actions.csv)',
    crisis_id: id,
    entries: crises[id].map((e: J) => ({ date: e.date, stage: e.stage, type: e.type, actor: e.actor, text: e.text, value: e.value ?? null, unit: e.unit ?? null })),
  };
}

export function countrySummary(ref: CountryRef, d: { countries: J; watchlist: J; enso: J; trends: J; kariba?: J }) {
  const c = (d.countries?.countries ?? []).find((x: J) => x.iso3 === ref.iso3) ?? {};
  const w = (d.watchlist?.countries ?? []).find((x: J) => x.iso3 === ref.iso3);
  const out: Record<string, unknown> = {
    source_file: 'countries.json, watchlist.json, enso.json, trends.json',
    iso3: ref.iso3, name: ref.name, tier: c.tier ?? null,
    hydro_share_pct: c.hydro_share_pct ?? null, hydro_twh: c.hydro_twh ?? null, hydro_gw: c.hydro_gw ?? null, data_year: c.latest_year ?? null,
    six_month_forecast: w ? {
      issued: d.watchlist?.issued ?? null, risk_level: w.risk_level, chance_any_shortfall_6m_pct: pct(w.p_any_shortfall_6m), alarm: w.alarm,
      months: (w.months ?? []).map((m: J) => ({ month: m.month, chance_shortfall_pct: pct(m.p_shortfall), risk_level: m.risk_level })),
      drivers: w.drivers ?? [], model_note: 'Experimental country monthly model; little skill in the backtest.',
    } : null,
    enso: (ensoSummary(d.enso, ref.iso3) as J).country,
    trends: trendsSummary(d.trends, ref.iso3),
    has_country_page: !!c.has_country_page,
  };
  if ((ref.iso3 === 'ZMB' || ref.iso3 === 'ZWE') && d.kariba) {
    const k = karibaSummary(d.kariba);
    out.kariba = { latest: k.latest, dec_2027: k.dec_2027, zra_projection: k.zra_projection, note: 'Zambia and Zimbabwe are forecast through Lake Kariba (kariba.json); use get_kariba_forecast for months.' };
  }
  if (!w && !out.kariba) out.six_month_forecast_note = 'No monthly forecast for this country (tier 3: trend and ENSO exposure only).';
  return out;
}

export function overviewSummary(d: { kariba: J; enso: J; watchlist: J; trends: J; scoreboard: J; reservoirs: J }) {
  const k = karibaSummary(d.kariba);
  const w = watchlistSummary(d.watchlist);
  const t = trendsSummary(d.trends) as J;
  const sb = scoreboardSummary(d.scoreboard, d.reservoirs);
  return {
    source_file: 'kariba.json, enso.json, watchlist.json, trends.json, scoreboard.json, reservoirs.json',
    kariba: { latest: k.latest, dec_2027: k.dec_2027, thresholds: k.thresholds, zra_projection: k.zra_projection ? { end_2027_usable_pct: k.zra_projection.end_2027_usable_pct } : null },
    enso_outlook: ensoSummary(d.enso).outlook,
    el_nino_losers_gw: d.enso?.summary?.gw_el_nino_losers ?? null,
    watchlist: { issued: w.issued, on_alarm: w.on_alarm, n_countries: w.countries.length, note: w.model_note },
    drying_trends: { headline: t.headline, gw_drying: t.gw_drying, gw_drying_pct: t.gw_drying_pct, gw_drying_with_rain_decline: t.gw_drying_with_rain_decline, gw_drying_without_rain_decline: t.gw_drying_without_rain_decline },
    track_record: { headline: sb.headline, n_crises: sb.n_crises, n_caught: sb.n_caught, reservoir_backtest_caught: sb.reservoir_backtest?.caught ?? null, reservoir_backtest_scored: sb.reservoir_backtest?.crises_scored ?? null },
  };
}

export function sourcesSummary(m: J) {
  return {
    source_file: 'meta.json',
    nasa_data: m?.nasa_data_summary ?? [],
    sources: (m?.sources ?? []).map((s: J) => ({ id: s.id, name: s.name, provider: s.provider, nasa: s.nasa, licence: s.license ?? null })),
    ai_disclosure: m?.ai_disclosure ?? null,
  };
}
