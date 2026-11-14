// Generates ILLUSTRATIVE fixture JSON into src/fixtures/.
// These are NOT pipeline results. Numbers are deliberately round.
// The app only uses them when web/public/data/*.json is missing,
// and shows a "Sample data" banner whenever it does.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'fixtures');
const REF = join(here, '..', '..', 'data', 'reference', 'hydro_dependent_countries_ember.csv');
mkdirSync(join(OUT, 'country'), { recursive: true });

const GEN = '2026-11-15T00:00:00Z';
const NOTE = 'ILLUSTRATIVE SAMPLE DATA from web/src/fixtures. Not pipeline output. Do not cite.';
const base = (sources) => ({ generated_at: GEN, sources, _fixture: true, notes: [NOTE] });
const write = (name, obj) => writeFileSync(join(OUT, name), JSON.stringify(obj, null, 1) + '\n');

function months(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const r1 = (x) => Math.round(x * 10) / 10;
const r5 = (x) => Math.round(x * 2) / 2;
const rp = (x) => Math.max(0, Math.min(1, Math.round(x * 10) / 10));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------- meta ----------
write('meta.json', {
  ...base([]),
  issue_date: '2026-11-15',
  sources: [
    { id: 'gravis', name: 'GRACE/GRACE-FO terrestrial water storage (GFZ GravIS)', provider: 'NASA/GFZ', nasa: true, url: 'https://gravis.gfz-potsdam.de/', coverage: '2002-04..2026-08', license: 'CC BY 4.0' },
    { id: 'power', name: 'NASA POWER (MERRA-2) precipitation and soil wetness', provider: 'NASA LaRC', nasa: true, url: 'https://power.larc.nasa.gov/', coverage: '1981..2026', license: 'Public' },
    { id: 'grealm', name: 'G-REALM satellite lake levels', provider: 'NASA/USDA', nasa: true, url: 'https://ipad.fas.usda.gov/cropexplorer/global_reservoir/', coverage: '1992..2026', license: 'Public' },
    { id: 'geos_s2s', name: 'GEOS-S2S seasonal forecasts', provider: 'NASA GMAO', nasa: true, url: 'https://gmao.gsfc.nasa.gov/cgi-bin/products/climateforecasts/index.php', coverage: '2026-10 issue', license: 'Public' },
    { id: 'gibs_blackmarble', name: 'Black Marble night lights (VNP46) via GIBS', provider: 'NASA', nasa: true, url: 'https://earthdata.nasa.gov/gibs', coverage: '2012..2026', license: 'Public' },
    { id: 'ember_monthly', name: 'Ember monthly electricity data', provider: 'Ember', nasa: false, url: 'https://ember-energy.org/data/', coverage: '2010..2026-10', license: 'CC BY 4.0' },
    { id: 'oni', name: 'Oceanic Niño Index', provider: 'NOAA CPC', nasa: false, url: 'https://www.cpc.ncep.noaa.gov/', coverage: '1950..2026', license: 'Public' },
    { id: 'gppd', name: 'Global Power Plant Database v1.3', provider: 'WRI', nasa: false, url: 'https://datasets.wri.org/dataset/globalpowerplantdatabase', coverage: '2021', license: 'CC BY 4.0' },
    { id: 'hydrobasins', name: 'HydroBASINS level 4', provider: 'HydroSHEDS', nasa: false, url: 'https://www.hydrosheds.org/', coverage: 'static', license: 'Free' },
    { id: 'zra', name: 'Zambezi River Authority lake levels and allocations', provider: 'ZRA', nasa: false, url: 'https://www.zambezira.org/', coverage: '2023..2026', license: 'Public' },
  ],
});

// ---------- countries ----------
const csv = readFileSync(REF, 'utf8').trim().split('\n');
const head = csv[0].split(',');
const rows = csv.slice(1).map((line) => {
  // the only quoted names contain no commas in this file except none; split naively
  const cells = line.split(',');
  return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
});
const countries = rows.map((r) => {
  const iso3 = r['ISO 3 code'];
  const tier = iso3 === 'ZMB' || iso3 === 'ZWE' ? 2 : r.has_monthly === 'True' ? 1 : 3;
  return {
    iso3, name: r.Area, continent: r.Continent, tier,
    hydro_share_pct: Math.round(+r.hydro_share_pct), hydro_twh: Math.round(+r.hydro_TWh),
    hydro_gw: r.hydro_capacity_GW ? Math.round(+r.hydro_capacity_GW) : null,
    lat: null, lon: null,
    monthly_from: r.monthly_first ? r.monthly_first.slice(0, 7) : null,
    monthly_to: r.monthly_last ? r.monthly_last.slice(0, 7) : null,
    has_country_page: tier === 1,
  };
});
countries.push({ iso3: 'CHN-SC', name: 'Sichuan (China)', continent: 'Asia', tier: 1, hydro_share_pct: 80, hydro_twh: 350, hydro_gw: 100, lat: null, lon: null, monthly_from: '2019-01', monthly_to: '2026-08', has_country_page: true });
write('countries.json', { ...base(['ember_yearly', 'ember_monthly']), countries });

// ---------- basins + trends ----------
const basinDefs = [
  ['F01', 'Sample basin: Middle Zambezi (Kariba)', ['ZMB', 'ZWE'], [26, -19, 31, -15], 2, 'drying', -2],
  ['F02', 'Sample basin: Paraná (Itaipu)', ['BRA', 'PRY'], [-56, -27, -48, -19], 14, 'drying', -1],
  ['F03', 'Sample basin: São Francisco', ['BRA'], [-46, -16, -39, -9], 10, 'drying', -2],
  ['F04', 'Sample basin: Upper Yangtze (Sichuan)', ['CHN'], [99, 27, 107, 33], 20, 'no_significant_trend', 0],
  ['F05', 'Sample basin: Red River (N. Vietnam)', ['VNM', 'LAO'], [102, 19, 106, 23], 6, 'drying', -1],
  ['F06', 'Sample basin: Ecuador Andes (Paute, Coca)', ['ECU'], [-79, -3, -76.5, 0.5], 4, 'no_significant_trend', 0],
  ['F07', 'Sample basin: Magdalena', ['COL'], [-76, 3, -73, 8], 8, 'no_significant_trend', 0],
  ['F08', 'Sample basin: Western Norway', ['NOR'], [5, 59, 10, 64], 20, 'wetting', 1],
  ['F09', 'Sample basin: La Grande (Québec)', ['CAN'], [-79, 51, -71, 55], 15, 'wetting', 2],
  ['F10', 'Sample basin: Volta (Akosombo)', ['GHA'], [-2, 6, 1, 10], 1, 'drying', -1],
  ['F11', 'Sample basin: Blue Nile', ['ETH', 'SDN'], [35, 9, 39, 13], 6, 'wetting', 1],
  ['F12', 'Sample basin: Vakhsh', ['TJK'], [69, 37, 73, 40], 5, 'drying', -2],
  ['F13', 'Sample basin: Caroní (Guri)', ['VEN'], [-64, 4, -61, 8], 15, 'drying', -1],
  ['F14', 'Sample basin: Lower Congo (Inga)', ['COD'], [13, -6, 16, -4], 2, 'no_significant_trend', 0],
  ['F15', 'Sample basin: Waitaki', ['NZL'], [169, -45, 171, -43], 2, 'no_significant_trend', 0],
];
const sm = months('2002-04', '2026-08');
const features = basinDefs.map(([id, , , [w, s, e, n]]) => ({
  type: 'Feature', properties: { basin_id: id },
  // counter-clockwise exterior ring (RFC 7946); the app rewinds if needed
  geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
}));
write('basins.geojson.json', { type: 'FeatureCollection', _fixture: true, features });
const basins = basinDefs.map(([id, name, ctry, [w, s, e, n], gw, cls, slope], i) => ({
  basin_id: id, name, countries: ctry, hydro_gw: gw, n_plants: Math.max(1, Math.round(gw / 2)),
  centroid: [(w + e) / 2, (s + n) / 2],
  tws_slope_cm_per_decade: slope, tws_p: cls === 'no_significant_trend' ? 0.5 : 0.01, tws_q: cls === 'no_significant_trend' ? 0.6 : 0.02,
  precip_slope_pct_per_decade: slope * 2, precip_p: 0.3, precip_q: 0.5,
  trend_class: cls,
  ...(i < 10 ? {
    series: {
      months: sm,
      tws_anom_cm: sm.map((_, k) => r5(slope * (k - sm.length / 2) / 120 + 3 * Math.sin((k / 12) * 2 * Math.PI + i))),
    },
  } : {}),
}));
const sumGw = (f) => basins.filter(f).reduce((a, b) => a + b.hydro_gw, 0);
write('trends.json', {
  ...base(['gravis', 'power', 'gppd', 'hydrobasins']),
  method: 'SAMPLE. Mann-Kendall (Hamed-Rao) + Sen slope on deseasonalized monthly GRACE/GRACE-FO TWS; Benjamini-Hochberg FDR q<0.05',
  period: { from: '2002-04', to: '2026-08' },
  summary: {
    n_basins: basins.length, n_drying: basins.filter((b) => b.trend_class === 'drying').length,
    n_wetting: basins.filter((b) => b.trend_class === 'wetting').length,
    gw_total: sumGw(() => true), gw_drying: sumGw((b) => b.trend_class === 'drying'), gw_wetting: sumGw((b) => b.trend_class === 'wetting'),
    headline: `Sample: ${sumGw((b) => b.trend_class === 'drying')} GW of hydropower sits in basins with a significant drying trend since 2002`,
  },
  basins,
});

// ---------- enso ----------
const ensoDefs = [
  ['ZMB', 'Zambia', 'reservoir_level', -20, 0.01, 0, 0.6, 'el_nino_loser', 'Effect is strongest in the Dec-Mar rainy season'],
  ['ZWE', 'Zimbabwe', 'reservoir_level', -20, 0.01, 0, 0.6, 'el_nino_loser', 'Shares Lake Kariba with Zambia'],
  ['MOZ', 'Mozambique', 'basin_precip', -10, 0.05, 5, 0.4, 'el_nino_loser', null],
  ['MWI', 'Malawi', 'basin_precip', -10, 0.05, 0, 0.7, 'el_nino_loser', null],
  ['VNM', 'Viet Nam', 'hydro_generation', -15, 0.05, 5, 0.3, 'el_nino_loser', 'Dry-season (Mar-Jun) output falls most'],
  ['COL', 'Colombia', 'hydro_generation', -15, 0.02, 10, 0.1, 'el_nino_loser', null],
  ['ECU', 'Ecuador', 'hydro_generation', -5, 0.3, -10, 0.05, 'la_nina_loser', 'Amazon-side basins dry under La Niña'],
  ['BRA', 'Brazil', 'hydro_generation', -5, 0.08, -10, 0.05, 'both', 'North and south of Brazil respond in opposite ways'],
  ['PER', 'Peru', 'hydro_generation', 0, 0.7, -5, 0.2, 'neutral', null],
  ['CRI', 'Costa Rica', 'hydro_generation', -10, 0.05, 0, 0.8, 'el_nino_loser', null],
  ['PAN', 'Panama', 'basin_precip', -10, 0.05, 5, 0.3, 'el_nino_loser', null],
  ['GTM', 'Guatemala', 'basin_precip', -10, 0.05, 0, 0.6, 'el_nino_loser', null],
  ['HND', 'Honduras', 'basin_precip', -10, 0.05, 0, 0.6, 'el_nino_loser', null],
  ['SLV', 'El Salvador', 'hydro_generation', -10, 0.08, 0, 0.6, 'el_nino_loser', null],
  ['VEN', 'Venezuela', 'basin_precip', -10, 0.05, 5, 0.3, 'el_nino_loser', null],
  ['PRY', 'Paraguay', 'basin_precip', 5, 0.3, -10, 0.05, 'la_nina_loser', null],
  ['LKA', 'Sri Lanka', 'hydro_generation', 0, 0.6, 0, 0.7, 'neutral', null],
  ['ETH', 'Ethiopia', 'basin_precip', -5, 0.09, 5, 0.3, 'el_nino_loser', null],
  ['LAO', 'Lao PDR', 'basin_precip', -10, 0.05, 0, 0.5, 'el_nino_loser', null],
  ['NOR', 'Norway', 'hydro_generation', 0, 0.8, 0, 0.8, 'neutral', null],
  ['CAN', 'Canada', 'hydro_generation', 0, 0.6, 0, 0.6, 'neutral', null],
  ['NZL', 'New Zealand', 'hydro_generation', -5, 0.2, 0, 0.5, 'neutral', null],
  ['TJK', 'Tajikistan', 'hydro_generation', 0, 0.5, -5, 0.2, 'neutral', null],
  ['GHA', 'Ghana', 'basin_precip', -5, 0.1, 0, 0.5, 'neutral', null],
  ['AGO', 'Angola', 'basin_precip', -10, 0.05, 0, 0.5, 'el_nino_loser', null],
  ['NAM', 'Namibia', 'basin_precip', -10, 0.05, 5, 0.3, 'el_nino_loser', null],
];
const gwOf = Object.fromEntries(countries.map((c) => [c.iso3, c.hydro_gw ?? 0]));
const ensoCountries = ensoDefs.map(([iso3, name, variable, en, enp, ln, lnp, exposure, season_note]) => ({
  iso3, name, variable, el_nino_effect_pct: en, el_nino_p: enp, la_nina_effect_pct: ln, la_nina_p: lnp,
  n_el_nino: 10, n_la_nina: 10, record: '1981-2025', exposure, season_note,
}));
const isEn = (c) => c.exposure === 'el_nino_loser' || c.exposure === 'both';
const isLn = (c) => c.exposure === 'la_nina_loser' || c.exposure === 'both';
const gwEn = ensoCountries.filter(isEn).reduce((a, c) => a + (gwOf[c.iso3] ?? 0), 0);
write('enso.json', {
  ...base(['oni', 'power', 'ember_monthly', 'grealm', 'cpc_enso', 'geos_s2s']),
  method: 'SAMPLE. Composites of hydro output / basin rain in El Niño and La Niña years vs other years, with permutation tests.',
  summary: {
    gw_el_nino_losers: gwEn, gw_la_nina_losers: ensoCountries.filter(isLn).reduce((a, c) => a + (gwOf[c.iso3] ?? 0), 0),
    n_el_nino_losers: ensoCountries.filter(isEn).length, n_la_nina_losers: ensoCountries.filter(isLn).length,
    headline: `Sample: ${gwEn} GW of hydropower is in grids that usually lose output under El Niño`,
  },
  countries: ensoCountries,
  outlook: {
    source: 'NOAA CPC + NASA GEOS-S2S', issued: '2026-11', oni_latest: { season: 'ASO 2026', value: 2.0 },
    status: 'El Nino Advisory (sample)', summary: 'Sample text: a strong El Niño is expected to last through early 2027.',
    geos_nino34_forecast: [{ season: 'NDJ', value: 2.5 }, { season: 'DJF', value: 2.5 }, { season: 'JFM', value: 2.0 }, { season: 'FMA', value: 1.5 }, { season: 'MAM', value: 1.0 }],
  },
  projections: {
    text: 'Extreme El Niño events are projected to roughly double, from about once every 20 years to about once a decade, and keep rising after warming stabilizes.',
    refs: [
      { title: 'Cai et al. 2014, Nature Climate Change', url: 'https://doi.org/10.1038/nclimate2100' },
      { title: 'Wang et al. 2020, Nature Climate Change', url: 'https://doi.org/10.1038/s41558-019-0675-2' },
    ],
  },
});

// ---------- watchlist + country pages ----------
const fm = months('2026-12', '2027-05');
const levelOf = (p) => (p >= 0.6 ? 'danger' : p >= 0.4 ? 'warning' : p >= 0.2 ? 'watch' : 'low');
const wlDefs = [
  // iso3, name, tier, peak p, exposure, drivers
  ['ZMB', 'Zambia', 2, 0.8, 'el_nino_loser', ['Sample: Lake Kariba usable storage near 30% and falling', 'Sample: El Niño usually lowers the lake']],
  ['ZWE', 'Zimbabwe', 2, 0.8, 'el_nino_loser', ['Sample: shares Lake Kariba with Zambia']],
  ['VNM', 'Viet Nam', 1, 0.6, 'el_nino_loser', ['Sample: basin water storage 1 SD below normal', 'Sample: El Niño usually costs this grid 15%']],
  ['COL', 'Colombia', 1, 0.5, 'el_nino_loser', ['Sample: 3-month rain 20% below normal', 'Sample: El Niño usually costs this grid 15%']],
  ['CRI', 'Costa Rica', 1, 0.5, 'el_nino_loser', ['Sample: soil moisture 1 SD below normal']],
  ['SLV', 'El Salvador', 1, 0.4, 'el_nino_loser', ['Sample: El Niño usually costs this grid 10%']],
  ['ECU', 'Ecuador', 1, 0.3, 'la_nina_loser', ['Sample: basin water storage near normal', 'Sample: dry season starts in Oct']],
  ['BRA', 'Brazil', 1, 0.3, 'both', ['Sample: south-east reservoirs below normal']],
  ['PER', 'Peru', 1, 0.2, 'neutral', ['Sample: rain near normal']],
  ['LKA', 'Sri Lanka', 1, 0.2, 'neutral', ['Sample: monsoon rain near normal']],
  ['TJK', 'Tajikistan', 1, 0.1, 'neutral', ['Sample: snow cover near normal']],
  ['NOR', 'Norway', 1, 0.1, 'neutral', ['Sample: reservoir filling above normal']],
  ['NZL', 'New Zealand', 1, 0.1, 'neutral', ['Sample: lake inflows near normal']],
  ['GEO', 'Georgia', 1, 0.1, 'neutral', ['Sample: rain near normal']],
];
const wl = wlDefs.map(([iso3, name, tier, peak, enso_exposure, drivers], i) => {
  const ms = fm.map((month, k) => {
    const p = rp(peak * (0.5 + 0.5 * Math.sin(((k + 1) / 6) * Math.PI)));
    const p50 = -Math.round(p * 40 / 5) * 5;
    return { month, p_shortfall: p, p_severe: rp(p / 3), anomaly_p10_pct: p50 - 20, anomaly_p50_pct: p50, anomaly_p90_pct: p50 + 15 };
  });
  const mx = Math.max(...ms.map((m) => m.p_shortfall));
  return { iso3, name, tier, risk_level: levelOf(mx), max_p_shortfall: mx, months: ms, drivers, enso_exposure };
});
write('watchlist.json', { ...base(['ember_monthly', 'gravis', 'power', 'oni', 'grealm']), issued: '2026-11-15', first_month: fm[0], countries: wl });

const hm = months('2019-01', '2026-08');
wl.filter((w) => w.tier === 1).forEach((w, ci) => {
  const history = hm.map((month, k) => {
    // smooth synthetic wave with a dip, rounded to 5%
    const v = Math.round((15 * Math.sin(k / 6 + ci) + 10 * Math.sin(k / 17 + ci * 2) - 5 * (k > 50 && k < 60 ? 3 : 0)) / 5) * 5;
    return { month, hydro_twh: 2, cf_anom_pct: v, shortfall: v <= -15, severe: v <= -30 };
  });
  const backtest = [];
  for (const h of [1, 3, 6]) {
    history.forEach((t, k) => {
      if (k < 12 + h) return;
      const ahead = history[k];
      const noisy = clamp((-(ahead.cf_anom_pct) + 5) / 40 + (h - 1) * 0.02, 0.05, 0.95);
      backtest.push({ issue: hm[k - h], target: t.month, horizon: h, p_shortfall: rp(noisy), observed_shortfall: t.shortfall });
    });
  }
  const p50cost = Math.round(w.max_p_shortfall * 500 / 50) * 50;
  write(`country/${w.iso3}.json`, {
    ...base(['ember_monthly', 'gravis', 'power', 'oni']),
    iso3: w.iso3, name: w.name, tier: w.tier,
    history,
    drivers_now: { tws_anom_sd: -1.0, precip_3m_anom_pct: -20.0, soil_root_anom_sd: -0.5, oni: 2.0 },
    backtest,
    forecast: { issued: '2026-11-15', months: w.months },
    analogs: [
      { month: '2023-08', similarity: 0.9, shortfall_next_6m: true },
      { month: '2020-02', similarity: 0.8, shortfall_next_6m: false },
      { month: '2024-07', similarity: 0.7, shortfall_next_6m: true },
    ],
    costs: { replacement_usd_per_kwh: 0.2, voll_usd_per_kwh: 1.0, expected_cost_next_6m_musd: { p10: Math.round(p50cost / 4), p50: p50cost, p90: p50cost * 3 } },
  });
});

// ---------- generation backtest ----------
write('generation_backtest.json', {
  ...base(['ember_monthly', 'gravis', 'power', 'oni']),
  design: 'SAMPLE. Blocked leave-one-year-out CV with a 12-month gap; pooled LightGBM across tier-1 countries; features respect publication lags',
  n_countries: 23, n_country_months: 2000, base_rate_shortfall: 0.15,
  by_horizon: [1, 2, 3, 4, 5, 6].map((h) => ({
    horizon: h, brier: r1(0.08 + h * 0.01 * 1) , bss_vs_climatology: r1(0.4 - h * 0.05), bss_vs_persistence: r1(0.3 - h * 0.05),
    bss_vs_enso_only: r1(0.3 - h * 0.04), auc_pr: r1(0.6 - h * 0.05), auc_pr_climatology: 0.15, auc_pr_ci90: [r1(0.5 - h * 0.05), r1(0.7 - h * 0.05)],
  })),
  reliability: [1, 3, 6].map((h) => ({
    horizon: h, bins: [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => ({ p_mean: p, observed_rate: r1(p + (h - 3) * 0.02 - 0.05 + (p > 0.6 ? -0.05 : 0)), n: Math.round(400 * (1 - p)) + 20 })),
  })),
  ablations: [
    { removed: 'gravis', horizon: 3, auc_pr: 0.4, delta_vs_full: -0.1 },
    { removed: 'power', horizon: 3, auc_pr: 0.4, delta_vs_full: -0.1 },
    { removed: 'oni', horizon: 3, auc_pr: 0.4, delta_vs_full: -0.1 },
    { removed: 'persistence features', horizon: 3, auc_pr: 0.3, delta_vs_full: -0.2 },
  ],
  feature_importance: [
    { feature: 'cf_anom_lag', gain_share: 0.3 }, { feature: 'tws_anom_sd', gain_share: 0.2 },
    { feature: 'precip_3m_anom_pct', gain_share: 0.2 }, { feature: 'oni', gain_share: 0.1 }, { feature: 'soil_root_anom_sd', gain_share: 0.1 },
  ],
  limitations: ['Sample limitation: Ember monthly data mostly starts in 2019, so the record is short.', 'Sample limitation: the five crises are illustrations, not the whole test.'],
});

// ---------- kariba ----------
const decLow = {1992:8,1993:15,1994:20,1995:15,1996:12,1997:25,1998:40,1999:50,2000:60,2001:65,2002:55,2003:50,2004:45,2005:40,2006:45,2007:55,2008:60,2009:65,2010:70,2011:75,2012:65,2013:55,2014:50,2015:30,2016:15,2017:20,2018:25,2019:10,2020:15,2021:25,2022:20,2023:12,2024:3,2025:15,2026:30};
const usableToLevel = (u) => r5(475.5 + 13 * Math.pow(Math.max(0, u) / 100, 0.75));
const khist = months('1992-11', '2026-11').map((mm) => {
  const [y, m] = mm.split('-').map(Number);
  const a = decLow[y] ?? 30, b = decLow[y + 1] ?? a;
  const t = (m - 1) / 12;
  const baseLow = a + (b - a) * Math.max(0, t - 0.5) * 2;
  // seasonal: lowest Dec-Jan, highest Jun-Jul
  const seas = 10 * (1 - Math.cos(((m - 1) / 12) * 2 * Math.PI)) / 2;
  const u = Math.max(0, Math.round(baseLow + (y === 2024 ? seas * 0.3 : seas)));
  return { date: `${mm}-15`, level_m: usableToLevel(u), usable_pct: u };
});
const kfm = months('2026-12', '2027-12');
const kfc = kfm.map((month, k) => {
  const p50 = Math.round(30 - k * 1.5 + (k > 4 && k < 9 ? 4 : 0));
  const sp = 5 + k;
  const pw = rp((20 - p50 + sp) / (2 * sp));
  const pd = rp((10 - p50 + sp) / (2 * sp));
  return { month, usable_p10: Math.max(0, p50 - sp), usable_p50: p50, usable_p90: p50 + sp, p_below_warning: pw, p_below_danger: pd };
});
const kbh = [1, 3, 6].map((h) => ({ horizon: h, brier: r1(0.05 + h * 0.02), bss_vs_climatology: r1(0.5 - h * 0.05), bss_vs_persistence: r1(0.3 - h * 0.04), bss_vs_enso_only: r1(0.3 - h * 0.03), auc_pr: r1(0.8 - h * 0.05), auc_pr_climatology: 0.2, auc_pr_ci90: [r1(0.7 - h * 0.05), r1(0.9 - h * 0.05)] }));
write('kariba.json', {
  ...base(['grealm', 'gravis', 'power', 'oni', 'zra', 'zesco_erb']),
  thresholds: { min_operating_m: 475.5, max_operating_m: 488.5, warning_usable_pct: 20, danger_usable_pct: 10 },
  storage_curve: { method: 'SAMPLE curve', points: [0, 10, 20, 40, 60, 80, 100].map((u) => ({ level_m: usableToLevel(u), usable_pct: u })) },
  history: khist,
  latest: { date: '2026-11-15', level_m: usableToLevel(30), usable_pct: 30, zra_gauge: { date: '2026-11-15', level_m: usableToLevel(30), usable_pct: 30 } },
  backtest: {
    design: 'SAMPLE. Strictly forward rolling forecast from 2003',
    by_horizon: kbh,
    ablation_no_grace: kbh.map((b) => ({ ...b, auc_pr: r1(b.auc_pr - 0.1) })),
    crisis_2024: { first_warning_p_gt_0_5: '2023-08', first_danger_p_gt_0_5: '2023-10', zra_allocation_cut: '2023-12-28', load_shedding_start: '2024-03-11', lead_months_vs_load_shedding: 7, lead_months_vs_zra: 4 },
  },
  forecast: { issued: '2026-11-15', months: kfc },
  zra_projection: { end_2027_usable_pct: 9, end_2027_level_m: 476.8, allocation_2027_bcm: 23, cut_pct: 36, source_url: 'https://www.zambezira.org/' },
  enso: { el_nino_years: ['1994', '1997', '2002', '2009', '2015', '2023'], mean_level_change_el_nino_m: -2.0, mean_level_change_other_m: 1.0, p: 0.01 },
  analogs: [
    { date: '2023-10', similarity: 0.9, what_happened: 'Sample: fell to about 3% usable by Dec 2024' },
    { date: '2015-10', similarity: 0.8, what_happened: 'Sample: fell to about 12% usable by early 2016' },
    { date: '2018-10', similarity: 0.7, what_happened: 'Sample: fell to about 10% usable by late 2019' },
  ],
  cost_of_waiting: {
    assumptions: { replacement_contracted_usd_per_kwh: 0.17, replacement_emergency_usd_per_kwh: 0.26, voll_usd_per_kwh: 1.0, source: 'ZESCO ERB filing Jul 2024; VoLL literature' },
    curve: months('2026-12', '2027-07').map((action_month, k) => ({ action_month, expected_cost_musd_p10: 50 + k * 50, expected_cost_musd_p50: 100 + k * 100, expected_cost_musd_p90: 200 + k * 200 })),
    headline: 'Sample: waiting from December to April adds about $400 M in expected costs',
  },
  other_reservoirs: [
    { name: 'Cahora Bassa', country: 'MOZ', grealm_id: 'sample', latest_level_m: 320, anomaly_m: -2 },
    { name: 'Volta (Akosombo)', country: 'GHA', grealm_id: 'sample', latest_level_m: 80, anomaly_m: 1 },
    { name: 'Guri', country: 'VEN', grealm_id: 'sample', latest_level_m: 260, anomaly_m: -1 },
  ],
});

// ---------- crises + scoreboard ----------
write('crises.json', {
  ...base(['ons', 'news', 'world_bank', 'zra', 'imf']),
  crises: [
    { id: 'brazil-2021', name: 'Brazil 2021', countries: ['BRA'], enso: 'La Nina', official_warning: { date: '2021-05-27', what: 'Sample text' }, onset: { date: '2021-05-28', what: 'Sample text' }, summary: 'Water-emergency alert, then a red tariff flag. South-east storage fell to 16.5%. No rationing.', costs: ['Average bills up about 6.8%'], sources: [] },
    { id: 'sichuan-2022', name: 'Sichuan 2022', countries: ['CHN-SC'], enso: 'La Nina', official_warning: null, onset: { date: '2022-08-14', what: 'Sample text' }, summary: 'A record heatwave and drought more than halved hydro output. Factories were shut for 11 days.', costs: ['No official estimate'], sources: [] },
    { id: 'vietnam-2023', name: 'Northern Vietnam 2023', countries: ['VNM'], enso: 'El Nino', official_warning: { date: '2023-05-10', what: 'Sample text' }, onset: { date: '2023-05-25', what: 'Sample text' }, summary: 'Rolling cuts across the north. About 900 GWh went unserved.', costs: ['About $1.4B, roughly 0.3% of GDP (World Bank, preliminary)'], sources: [] },
    { id: 'ecuador-2023-24', name: 'Ecuador 2023–24', countries: ['ECU'], enso: 'El Nino, then neutral', official_warning: { date: '2023-10-24', what: 'Sample text' }, onset: { date: '2023-10-27', what: 'Sample text' }, summary: 'Three waves of cuts, reaching 14 hours a day from 24 Oct 2024.', costs: ['About 1–1.5% of GDP (finance minister)'], sources: [] },
    { id: 'kariba-2024', name: 'Lake Kariba 2024', countries: ['ZMB', 'ZWE'], enso: 'El Nino', official_warning: { date: '2023-12-28', what: 'Sample text' }, onset: { date: '2024-03-11', what: 'Sample text' }, summary: 'Allocation cut, then load-shedding of 8, then 12 hours a day. The lake fell to 2.89% usable.', costs: ['IMF cut Zambia 2024 growth from 4.7% to 1.2%'], sources: [] },
  ],
});
write('scoreboard.json', {
  ...base(['ember_monthly', 'grealm', 'gravis', 'power', 'oni']),
  rows: [
    { id: 'brazil-2021', name: 'Brazil 2021', countries: ['BRA'], enso: 'La Nina', official_warning: '2021-05-27', onset: '2021-05-28', patronus_alarm: '2021-02', lead_months: 3, lead_vs_official_months: 3, caught_by: 'next', notes: 'Sample row.' },
    { id: 'sichuan-2022', name: 'Sichuan 2022', countries: ['CHN-SC'], enso: 'La Nina', official_warning: null, onset: '2022-08-14', patronus_alarm: '2022-07', lead_months: 1, lead_vs_official_months: null, caught_by: 'now', notes: 'Sample row. Heatwave, not ENSO.' },
    { id: 'vietnam-2023', name: 'Northern Vietnam 2023', countries: ['VNM'], enso: 'El Nino', official_warning: '2023-05-10', onset: '2023-05-25', patronus_alarm: '2023-02', lead_months: 3, lead_vs_official_months: 3, caught_by: 'both', notes: 'Sample row.' },
    { id: 'ecuador-2023-24', name: 'Ecuador 2023–24', countries: ['ECU'], enso: 'El Nino', official_warning: '2023-10-24', onset: '2023-10-27', patronus_alarm: null, lead_months: null, lead_vs_official_months: null, caught_by: 'missed', notes: 'Sample row, shown as a miss so the layout for misses is visible.' },
    { id: 'kariba-2024', name: 'Lake Kariba 2024', countries: ['ZMB', 'ZWE'], enso: 'El Nino', official_warning: '2023-12-28', onset: '2024-03-11', patronus_alarm: '2023-08', lead_months: 7, lead_vs_official_months: 4, caught_by: 'both', notes: 'Sample row.' },
  ],
  false_alarms: { per_country_5yr: 1.0, definition: 'Sample: alarm months with no shortfall in the next 6 months, per country per 5 years' },
});

// ---------- nightlights + ledger ----------
write('nightlights.json', {
  ...base(['gibs_blackmarble']),
  frames: [
    { id: 'sample-before', place: 'Lusaka and Copperbelt', date: '2024-02-15', src: 'img/nightlights/sample-before.png', bbox: [25, -17, 30, -12], caption: 'Sample frame: before load-shedding' },
    { id: 'sample-after', place: 'Lusaka and Copperbelt', date: '2024-10-15', src: 'img/nightlights/sample-after.png', bbox: [25, -17, 30, -12], caption: 'Sample frame: during 12 h/day cuts' },
  ],
});
const fakeHash = '0'.repeat(64);
write('ledger.json', {
  ...base([]),
  entries: ['kariba.json', 'watchlist.json', 'scoreboard.json'].map((file) => ({ file, sha256: fakeHash, logged_at: '2026-11-15T00:00:00Z', ots: null, verify: `sha256sum web/public/data/${file}` })),
});
console.log('fixtures written to', OUT);
