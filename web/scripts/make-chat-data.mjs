// Build web/public/data/crisis_actions.json (compact, for the data chat) from
// data/reference/remediation/crisis_actions.csv. Run: node web/scripts/make-chat-data.mjs
// Never hand-edit the JSON; edit the CSV and rerun.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(root, 'data/reference/remediation/crisis_actions.csv');
const OUT = resolve(root, 'web/public/data/crisis_actions.json');

/** RFC 4180 CSV parser (quoted fields, doubled quotes, newlines in quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const rows = parseCsv(readFileSync(SRC, 'utf8'));
const crises = {};
for (const r of rows) {
  const list = (crises[r.crisis_id] ??= []);
  const e = { date: r.date, stage: r.stage, type: r.type, actor: r.actor, text: r.text };
  if (r.value !== '') e.value = isNaN(+r.value) ? r.value : +r.value;
  if (r.unit) e.unit = r.unit;
  if (r.source_url) e.source = r.source_url;
  list.push(e);
}
for (const k of Object.keys(crises)) crises[k].sort((a, b) => a.date.localeCompare(b.date));
const out = {
  generated_from: 'data/reference/remediation/crisis_actions.csv',
  note: 'What governments and utilities did in past hydropower crises. Built by web/scripts/make-chat-data.mjs; do not hand-edit.',
  crises,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}: ${rows.length} rows, ${Object.keys(crises).length} crises`);
