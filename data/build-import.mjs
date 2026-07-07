// Build the roster import SQL from data/roster.txt.
// Rules: within a @FAMILY block, a person's big is the PREVIOUS person unless
// a Big name is given (branch) or "-" (root). Emits data/roster-import.sql.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const src = readFileSync(new URL('./roster.txt', import.meta.url), 'utf8');
const lines = src.split(/\r?\n/);

const people = [];        // {id, name, cls, family, bigName|null|root}
const byFamily = {};      // family -> [names in order] for resolution
let family = null, prev = null;
const warnings = [];

for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  if (line.startsWith('@FAMILY')) { family = line.replace('@FAMILY', '').trim(); prev = null; byFamily[family] = []; continue; }
  const parts = line.split('|').map(s => s.trim());
  const name = parts[0], cls = parts[1] || null, big = parts[2] || '';
  const p = { id: randomUUID(), name, cls, family, bigName: null, root: false };
  if (big === '-') p.root = true;
  else if (big) p.bigName = big;      // explicit branch parent
  else p.bigName = prev ? prev.name : null; // linear: previous person
  people.push(p);
  byFamily[family].push(p);
  prev = p;
}

// De-dupe by name+class (collapses the source's repeated "two-bigs" subtrees).
const seen = {};
const kept = [];
for (const p of people) {
  const key = (p.name + '|' + (p.cls || '')).toLowerCase();
  if (seen[key]) { warnings.push(`duplicate collapsed: ${p.name} (${p.cls})`); continue; }
  seen[key] = p; kept.push(p);
}

// Resolve bigName -> big id, within the same family (latest matching name).
const nameIndex = {}; // family -> name(lower) -> person
for (const p of kept) { (nameIndex[p.family] ||= {})[p.name.toLowerCase()] = p; }
let roots = 0, linked = 0, orphans = 0;
for (const p of kept) {
  if (p.root || !p.bigName) { p.bigId = null; roots++; continue; }
  const big = nameIndex[p.family][p.bigName.toLowerCase()];
  if (big) { p.bigId = big.id; linked++; }
  else { p.bigId = null; orphans++; warnings.push(`UNRESOLVED big "${p.bigName}" for ${p.name} (${p.family}) — set as root`); }
}

// Emit SQL: one multi-row insert with big_id inline. A self-referencing FK is
// fine in a single INSERT — Postgres validates the constraint after the whole
// statement, so all referenced rows already exist.
const esc = s => s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`;
let sql = `-- ZBXi roster import (${kept.length} brothers). Generated from data/roster.txt.\n`;
sql += `-- Run in the Supabase SQL editor. Safe to re-run: it clears prior import rows first.\n\n`;
sql += `delete from public.brothers where user_id is null;\n\n`;
sql += `insert into public.brothers (id, full_name, pledge_class, big_id, status, user_id) values\n`;
sql += kept.map(p => `  (${esc(p.id)}, ${esc(p.name)}, ${esc(p.cls)}, ${esc(p.bigId || null)}, 'verified', null)`).join(',\n') + ';\n';

writeFileSync(new URL('./roster-import.sql', import.meta.url), sql);

// Report
const familyRoots = kept.filter(p => !p.bigId).map(p => `${p.name} [${p.family}]`);
console.log('total brothers:', kept.length);
console.log('roots (no big):', roots, '->', familyRoots.join(' | '));
console.log('linked to a big:', linked);
console.log('orphans (unresolved):', orphans);
console.log('families:', Object.keys(byFamily).length);
console.log('\nwarnings/notes:');
warnings.forEach(w => console.log('  -', w));
