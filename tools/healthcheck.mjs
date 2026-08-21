#!/usr/bin/env node
/* ZBXi health check — what a plain uptime ping cannot tell you.
 *
 *   node tools/healthcheck.mjs                     # check production
 *   node tools/healthcheck.mjs --base http://localhost:8899
 *   node tools/healthcheck.mjs --json              # machine-readable
 *
 * Exit codes are the point — a caller can branch on them:
 *   0  healthy
 *   1  degraded  — worth a look, site still serves (e.g. cert expiring, slow)
 *   2  BROKEN    — visitors are hitting a wall (bad deploy, edge down, JS won't parse)
 *
 * The site is static files on Cloudflare, so "the server is down" is the least
 * likely failure. These checks aim at the ones that actually happen: a deploy
 * that shipped unparseable JS, a page that lost the shared module every other
 * script depends on, Supabase falling over under the members' area, a lapsed
 * cert, or a secret accidentally bundled into a public file.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const BASE = (arg('--base', 'https://zetabetaxi.com')).replace(/\/$/, '');
const JSON_OUT = argv.includes('--json');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT = 20000;

const results = [];
const add = (level, name, detail) => results.push({ level, name, detail });
const ok = (n, d) => add('ok', n, d);
const warn = (n, d) => add('warn', n, d);
const fail = (n, d) => add('fail', n, d);

async function get(path, { head = false } = {}) {
  const url = path.startsWith('http') ? path : BASE + path;
  const ctl = AbortSignal.timeout(TIMEOUT);
  const t0 = Date.now();
  const res = await fetch(url, { method: head ? 'HEAD' : 'GET', redirect: 'follow', signal: ctl });
  const body = head ? '' : await res.text();
  return { status: res.status, body, ms: Date.now() - t0, headers: res.headers, url: res.url };
}

/* Pages and scripts come from the repo when it is present, so this cannot drift
   out of date the way a hardcoded list would. */
function repoPages() {
  try {
    return readdirSync(REPO).filter(f => f.endsWith('.html'));
  } catch { return ['index.html']; }
}
function repoScripts() {
  try {
    return readdirSync(join(REPO, 'assets', 'js')).filter(f => f.endsWith('.js'));
  } catch { return []; }
}

// ---------------------------------------------------------------- 1. the edge
async function checkEdge() {
  try {
    const r = await get('/');
    if (r.status !== 200) return fail('edge', `homepage returned ${r.status}`);
    if (!/Zeta Beta Xi/i.test(r.body)) return fail('edge', 'homepage served but the content is not the site');
    if (r.ms > 4000) warn('edge', `homepage OK but slow (${r.ms}ms)`);
    else ok('edge', `homepage 200 in ${r.ms}ms`);
  } catch (e) { fail('edge', `homepage unreachable: ${e.message}`); }
}

// ------------------------------------------------------- 2. every page serves
async function checkPages() {
  const pages = repoPages();
  const bad = [];
  for (const p of pages) {
    try {
      const r = await get('/' + p);
      // Thin pages are a real symptom: a shell that renders nothing means its JS died.
      if (r.status !== 200) bad.push(`${p} -> ${r.status}`);
      else if (r.body.length < 500) bad.push(`${p} -> ${r.body.length} bytes (empty?)`);
    } catch (e) { bad.push(`${p} -> ${e.message}`); }
  }
  if (bad.length) fail('pages', `${bad.length}/${pages.length} not serving: ${bad.slice(0, 5).join(', ')}`);
  else ok('pages', `all ${pages.length} pages serve 200`);
}

// ----------------------------------------- 3. the deployed JS actually parses
// The highest-value check here: this is what a bad deploy looks like from outside.
async function checkScripts() {
  const files = repoScripts();
  const broken = [], missing = [];
  for (const f of files) {
    try {
      const r = await get('/assets/js/' + f);
      if (r.status !== 200) { missing.push(`${f} (${r.status})`); continue; }
      try { new vm.Script(r.body, { filename: f }); }   // compiles, never executes
      catch (e) { broken.push(`${f}: ${e.message.split('\n')[0]}`); }
    } catch (e) { missing.push(`${f}: ${e.message}`); }
  }
  if (broken.length) fail('js-parse', `${broken.length} file(s) will not parse: ${broken.slice(0, 3).join(' | ')}`);
  else if (missing.length) fail('js-missing', `not being served: ${missing.slice(0, 5).join(', ')}`);
  else ok('js-parse', `all ${files.length} scripts parse at the edge`);
}

// ------------------------------- 4. the dependency that breaks every page at once
// Every module assumes window.ZBXIUtil exists and is loaded FIRST. A page that
// lost that script tag dies on load, and nothing about the HTTP response says so.
async function checkUtilOrder() {
  const bad = [];
  for (const p of repoPages()) {
    try {
      const r = await get('/' + p);
      if (r.status !== 200 || !/assets\/js\//.test(r.body)) continue;   // page runs no scripts
      const util = r.body.indexOf('assets/js/zbxi-util.js');
      if (util === -1) { bad.push(`${p}: missing zbxi-util.js`); continue; }
      // config.js is the one script that legitimately precedes it — it defines the
      // config object and consumes nothing. Everything else must come after.
      const first = r.body.search(/assets\/js\/(?!zbxi-util|config)[a-z-]+\.js/);
      if (first !== -1 && first < util) bad.push(`${p}: zbxi-util.js loads too late`);
    } catch { /* covered by checkPages */ }
  }
  if (bad.length) fail('shared-module', bad.slice(0, 4).join(' | '));
  else ok('shared-module', 'zbxi-util.js present and first on every scripted page');
}

// ------------------------------------------------- 5. Supabase (members' area)
async function checkSupabase() {
  let url, key;
  try {
    const cfg = readFileSync(join(REPO, 'assets', 'js', 'config.js'), 'utf8');
    url = (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
    key = (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
  } catch { return warn('supabase', 'config.js unreadable — skipped'); }
  if (!url || !key) return warn('supabase', 'could not read URL/key from config.js');
  try {
    const h = await fetch(url + '/auth/v1/health', { headers: { apikey: key }, signal: AbortSignal.timeout(TIMEOUT) });
    if (h.status !== 200) return fail('supabase-auth', `auth health ${h.status} — nobody can sign in`);
    // A public-safe read: anon should get 200 with an empty set, because RLS hides
    // the rows rather than refusing the request. A 5xx means the database is hurting.
    const q = await fetch(url + '/rest/v1/events?select=id&limit=1', { headers: { apikey: key }, signal: AbortSignal.timeout(TIMEOUT) });
    if (q.status >= 500) return fail('supabase-rest', `REST ${q.status} — members' area will be down`);
    if (q.status !== 200) warn('supabase-rest', `REST returned ${q.status} (expected 200 + empty set for anon)`);
    else ok('supabase', 'auth 200, REST 200');
  } catch (e) { fail('supabase', `unreachable: ${e.message}`); }
}

// --------------------------------------------------------------- 6. TLS cert
function checkCert() {
  if (!BASE.startsWith('https')) return;
  const host = new URL(BASE).hostname;
  try {
    const out = execFileSync('bash', ['-c',
      `echo | openssl s_client -servername ${host} -connect ${host}:443 2>/dev/null | openssl x509 -noout -enddate`],
      { encoding: 'utf8', timeout: TIMEOUT });
    const d = new Date((out.split('=')[1] || '').trim());
    if (isNaN(d)) return warn('tls', 'could not read certificate expiry');
    const days = Math.round((d - Date.now()) / 86400000);
    if (days < 7) fail('tls', `certificate expires in ${days} day(s)`);
    else if (days < 21) warn('tls', `certificate expires in ${days} days`);
    else ok('tls', `certificate valid for ${days} more days`);
  } catch { warn('tls', 'openssl unavailable — skipped'); }
}

// ------------------------------------------ 7. security headers (regression net)
async function checkHeaders() {
  try {
    const r = await get('/');
    const csp = r.headers.get('content-security-policy') || '';
    const miss = [];
    if (!csp) miss.push('content-security-policy');
    else {
      if (!/frame-ancestors\s+'none'/.test(csp)) miss.push("frame-ancestors 'none'");
      if (/script-src[^;]*'unsafe-inline'/.test(csp)) miss.push('script-src gained unsafe-inline');
    }
    if (!r.headers.get('x-content-type-options')) miss.push('x-content-type-options');
    if (miss.length) warn('headers', `weakened: ${miss.join(', ')}`);
    else ok('headers', 'CSP + nosniff intact');
  } catch (e) { warn('headers', e.message); }
}

// --------------------------------- 8. no secret shipped into a public bundle
async function checkNoSecrets() {
  // Deliberately narrow: patterns that are ALWAYS server-side. The anon/publishable
  // key is meant to be public and must not trip this.
  const patterns = [/service_role/i, /\bsb_secret_[A-Za-z0-9_-]{8,}/, /SUPABASE_SERVICE/i, /\bsbp_[a-f0-9]{40}\b/];
  const hits = [];
  for (const f of repoScripts()) {
    try {
      const r = await get('/assets/js/' + f);
      if (r.status !== 200) continue;
      for (const p of patterns) if (p.test(r.body)) hits.push(`${f} matches ${p}`);
    } catch { /* covered above */ }
  }
  if (hits.length) fail('secrets', `SECRET IN PUBLIC BUNDLE: ${hits.join(' | ')}`);
  else ok('secrets', 'no server-side credential patterns in public JS');
}

// -------------------------- 9. repo files that must NOT be on the public web
// Cloudflare serves the whole repo, so anything added to it is public by default.
// This shipped for real: /data/roster.txt was handing out 343 brothers' names.
async function checkPrivatePaths() {
  const mustBe404 = [
    'data/roster.txt', 'data/roster-import.sql',
    'supabase/schema.sql', 'supabase/functions/zbxi-claim.ts',
    'README.md', 'wrangler.jsonc', 'tools/healthcheck.mjs',
  ];
  const exposed = [];
  for (const p of mustBe404) {
    try {
      const r = await get('/' + p);
      if (r.status === 200) exposed.push(p);
    } catch { /* unreachable is fine here */ }
  }
  if (exposed.length) fail('private-paths', `PUBLICLY DOWNLOADABLE: ${exposed.join(', ')} — check .assetsignore`);
  else ok('private-paths', `${mustBe404.length} non-site paths correctly withheld`);
}

// ------------------------------- 10. is the deployed build the committed build?
async function checkDeployFresh() {
  let head;
  try { head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return; }                       // no git (or not a checkout) — skip quietly
  try {
    const local = readFileSync(join(REPO, 'assets', 'js', 'zbxi-util.js'), 'utf8');
    const live = (await get('/assets/js/zbxi-util.js')).body;
    const norm = t => t.replace(/\r\n/g, '\n').trim();
    if (norm(live) !== norm(local)) warn('deploy-fresh', `edge is serving a different build than HEAD (${head.slice(0, 7)}) — deploy in flight or failed`);
    else ok('deploy-fresh', `edge matches HEAD ${head.slice(0, 7)}`);
  } catch (e) { warn('deploy-fresh', e.message); }
}

// ------------------------------------------------------------------- report
const t0 = Date.now();
await checkEdge();
await checkPages();
await checkScripts();
await checkUtilOrder();
await checkSupabase();
checkCert();
await checkHeaders();
await checkNoSecrets();
await checkPrivatePaths();
await checkDeployFresh();

const fails = results.filter(r => r.level === 'fail');
const warns = results.filter(r => r.level === 'warn');
const code = fails.length ? 2 : warns.length ? 1 : 0;
const verdict = code === 2 ? 'BROKEN' : code === 1 ? 'DEGRADED' : 'HEALTHY';

if (JSON_OUT) {
  console.log(JSON.stringify({ verdict, code, base: BASE, ms: Date.now() - t0, checks: results }, null, 2));
} else {
  const mark = { ok: '  ok  ', warn: ' WARN ', fail: ' FAIL ' };
  console.log(`\nZBXi health — ${BASE}`);
  for (const r of results) console.log(`${mark[r.level]} ${r.name.padEnd(15)} ${r.detail}`);
  console.log(`\n${verdict}  (${results.length} checks, ${fails.length} failing, ${warns.length} warning, ${Date.now() - t0}ms)\n`);
}
process.exit(code);
