// Build web/public/data/hydro_plants.json: every hydro plant in the WRI Global Power Plant Database
// (v1.3.0, CC BY 4.0) with its HydroBASINS level-4 basin trend class (trends.json) and, if it feeds one
// of the 31 G-REALM reservoirs, that reservoir's watch tier (reservoirs.json).
// Input: data/raw/gppd/global_power_plant_database.csv (gitignored; download from
// https://github.com/wri/global-power-plant-database). Run: node scripts/make-hydro-plants.mjs
import fs from 'node:fs';
import { geoContains } from 'd3-geo';
const csv = fs.readFileSync('../data/raw/gppd/global_power_plant_database.csv', 'utf8');
function parse(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
const lines = csv.split(/\r?\n/).filter(Boolean);
const head = parse(lines[0]); const ix = (k) => head.indexOf(k);
const [cI, nI, idI, mwI, laI, loI, fI] = ['country', 'name', 'gppd_idnr', 'capacity_mw', 'latitude', 'longitude', 'primary_fuel'].map(ix);
const basins = JSON.parse(fs.readFileSync('public/data/basins.geojson', 'utf8')).features;
const trends = new Map(JSON.parse(fs.readFileSync('public/data/trends.json', 'utf8')).basins.map((b) => [b.basin_id, b]));
const res = JSON.parse(fs.readFileSync('public/data/reservoirs.json', 'utf8')).reservoirs;
const resOf = new Map(); for (const r of res) for (const d of [...(r.dams ?? []), ...(r.cascade ?? [])]) if (d.gppd_id) resOf.set(d.gppd_id, r.id);
const plants = [];
for (const l of lines.slice(1)) {
  const r = parse(l); if (r[fI] !== 'Hydro') continue;
  const lon = +r[loI], lat = +r[laI], mw = +r[mwI]; if (!isFinite(lon) || !isFinite(lat)) continue;
  let basin = null;
  for (const f of basins) { const b = f.properties; if (geoContains(f, [lon, lat])) { basin = b.basin_id; break; } }
  const t = basin ? trends.get(basin) : null;
  // [lon, lat, mw, name, iso3, gppd_id, trend ('d'|'w'|'n'|null), basin name, reservoir id]
  plants.push([+lon.toFixed(4), +lat.toFixed(4), Math.round(mw * 10) / 10, r[nI], r[cI], r[idI], t ? t.trend_class[0] : null, t ? t.name : null, resOf.get(r[idI]) ?? null]);
}
plants.sort((a, b) => b[2] - a[2]);
const out = { generated_at: new Date().toISOString(), source: 'WRI Global Power Plant Database v1.3.0 (CC BY 4.0), primary_fuel = Hydro; basin trend from trends.json (GRACE/GRACE-FO, Mann-Kendall + FDR); reservoir tier from reservoirs.json', fields: ['lon', 'lat', 'mw', 'name', 'iso3', 'gppd_id', 'trend', 'basin', 'reservoir'], trend_codes: { d: 'drying', w: 'wetting', n: 'no_significant_trend' }, plants };
fs.writeFileSync('public/data/hydro_plants.json', JSON.stringify(out));
const c = {}; for (const p of plants) c[p[6]] = (c[p[6]] || 0) + 1;
console.log(plants.length, 'plants', c, 'linked to reservoirs:', plants.filter((p) => p[8]).length, (fs.statSync('public/data/hydro_plants.json').size / 1024).toFixed(0) + ' KB');
console.log(plants.filter((p) => /Kariba|Kafue|Itezhi|Cahora/i.test(p[3])).map((p) => p.slice(0, 4).join(' ') + ' ' + p[6] + ' ' + p[8]).join('\n'));
