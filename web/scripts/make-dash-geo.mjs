// Build web/public/data/geo/dash_geo.json for the #/app dashboard map/globe.
// Inputs (Natural Earth, public domain), paths as args:
//   node scripts/make-dash-geo.mjs <ne_admin1.geojson> <ne_50m_admin_0_countries.geojson> <ne_50m_rivers_lake_centerlines.geojson> <ne_10m_lakes.geojson>
import fs from 'node:fs';
const [adm1, adm0, rivers, lakes] = process.argv.slice(2).map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
const r3 = (c) => Array.isArray(c[0]) ? c.map(r3) : [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
const dedupe = (c) => Array.isArray(c[0][0]) ? c.map(dedupe) : c.filter((p, i) => i === 0 || p[0] !== c[i - 1][0] || p[1] !== c[i - 1][1]);
const geom = (g) => ({ type: g.type, coordinates: dedupe(r3(g.coordinates)) });
const P = (f) => f.properties;
const provinces = adm1.features.filter((f) => P(f).adm0_a3 === 'ZMB' || P(f).iso_a2 === 'ZM')
  .map((f) => ({ type: 'Feature', properties: { name: P(f).name, lat: P(f).latitude, lon: P(f).longitude }, geometry: geom(f.geometry) }));
const ISO = ['ZMB', 'ZWE', 'MOZ', 'ZAF', 'COD', 'NAM', 'TZA', 'MWI', 'BWA', 'AGO'];
const countries = adm0.features.filter((f) => ISO.includes(P(f).ADM0_A3))
  .map((f) => ({ type: 'Feature', properties: { iso3: P(f).ADM0_A3, name: P(f).NAME }, geometry: geom(f.geometry) }));
const riv = rivers.features.filter((f) => /^(Zambezi|Kafue)/i.test(P(f).name ?? ''))
  .map((f) => ({ type: 'Feature', properties: { name: P(f).name }, geometry: geom(f.geometry) }));
const lk = lakes.features.filter((f) => /Kariba|Cahora|Itezhi/i.test(P(f).name ?? ''))
  .map((f) => ({ type: 'Feature', properties: { name: P(f).name }, geometry: geom(f.geometry) }));
const out = { source: 'Natural Earth (public domain): admin-1 provinces, admin-0 50m, rivers 50m, lakes 10m', provinces, countries, rivers: riv, lakes: lk };
fs.writeFileSync(new URL('../public/data/geo/dash_geo.json', import.meta.url), JSON.stringify(out));
console.log('provinces', provinces.map((f) => f.properties.name).join(','), '| countries', countries.length, '| rivers', riv.map((f) => f.properties.name).join(','), '| lakes', lk.map((f) => f.properties.name).join(','));
