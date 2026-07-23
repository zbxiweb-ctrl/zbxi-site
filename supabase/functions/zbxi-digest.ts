// zbxi-digest — the monthly brotherhood digest.
// Auth: either the cron secret header (x-zbxi-cron) or a signed-in ADMIN's JWT.
// ?test=1  -> render + send only to the admin (safe rehearsal)
// ?dry=1   -> render and return the HTML, send nothing (works with no API key)
// Deployed via the Supabase Management API; no secrets live in the repo.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("DIGEST_FROM") || "Zeta Beta Xi <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
// Admin identity comes from the DB's single source of truth, public.admin_email()
// (see upgrade14.sql), cached per cold start. No hard-coded email here.
let _adminEmail: string | null = null;
async function adminEmail(): Promise<string> {
  if (_adminEmail) return _adminEmail;
  const r = await fetch(`${SB}/rest/v1/rpc/admin_email`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error("admin_email lookup failed");
  _adminEmail = String(await r.json()).toLowerCase();
  return _adminEmail;
}
const SITE = "https://zetabetaxi.com";

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  // PostgREST answers inserts with 201 + an EMPTY body unless asked otherwise,
  // so never hand an empty string to JSON.parse.
  const body = await r.text();
  return body ? JSON.parse(body) : null;
}

async function isAdmin(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return false;
  const u = await r.json();
  return String(u?.email || "").toLowerCase() === await adminEmail();
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Pledge class -> year, mirroring pledgeYear() on the site ("Kappa · Spring '98").
function pledgeYear(cls: string): number | null {
  const m4 = cls.match(/(19|20)\d{2}/);
  if (m4) return parseInt(m4[0], 10);
  const m2 = cls.match(/'(\d{2})/);
  if (!m2) return null;
  const yy = parseInt(m2[1], 10);
  return yy >= 93 ? 1900 + yy : 2000 + yy;
}

async function authEmails(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const r = await fetch(`${SB}/auth/v1/admin/users?per_page=500`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  if (!r.ok) return map;
  const j = await r.json();
  (j.users || []).forEach((u: any) => { if (u.email) map[u.id] = u.email; });
  return map;
}

async function build(adminUserId: string | null) {
  const last = await db(`digest_log?test=eq.false&order=sent_at.desc&limit=1&select=sent_at`);
  const since = last?.[0]?.sent_at || new Date(Date.now() - 30 * 864e5).toISOString();
  const nowISO = new Date().toISOString();

  const [newMembersRaw, events, jobs, photos, classes] = await Promise.all([
    db(`brothers?status=eq.verified&user_id=not.is.null&created_at=gt.${since}&select=full_name,pledge_class,user_id&limit=12`),
    db(`events?starts_at=gt.${nowISO}&order=starts_at.asc&limit=5&select=title,starts_at,location,all_day`),
    db(`forum_threads?category=eq.opportunities&created_at=gt.${since}&order=created_at.desc&limit=5&select=id,title`),
    db(`gallery_posts?created_at=gt.${since}&select=id`),
    db(`brothers?pledge_class=not.is.null&select=pledge_class`),
  ]);

  // The webmaster's own admin row isn't a "new brother".
  const newMembers = (newMembersRaw as any[])
    .filter((b) => b.user_id !== adminUserId && String(b.full_name).toLowerCase() !== "webdev")
    .slice(0, 10);

  // Pledge-class anniversaries (there is no birthday column; this is the
  // milestone content the chapter actually has data for). Biggest first,
  // capped — 13 lines of "turns 5" is noise, not news.
  const yr = new Date().getFullYear();
  const seen = new Set<string>();
  const milestones: { label: string; age: number }[] = [];
  for (const b of classes as any[]) {
    const c = b.pledge_class;
    if (!c || seen.has(c) || String(c).toLowerCase() === "none") continue;
    seen.add(c);
    const py = pledgeYear(c);
    if (!py) continue;
    const age = yr - py;
    if (age > 0 && age % 5 === 0) milestones.push({ label: c, age });
  }
  milestones.sort((a, z) => z.age - a.age || a.label.localeCompare(z.label));
  const annis = milestones.slice(0, 6).map((m) => `<b>${esc(m.label)}</b> turns ${m.age}`);

  const fmtDate = (s: string, allDay: boolean) => {
    const d = new Date(s);
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    if (allDay) return day;
    return `${day} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`;
  };

  const sec = (title: string, rows: string[]) =>
    rows.length
      ? `<h3 style="font:700 15px Georgia,serif;color:#0A1F44;margin:26px 0 8px;border-bottom:1px solid #e8dfc6;padding-bottom:6px">${title}</h3>
         <ul style="margin:0;padding-left:18px;color:#3d4657;font:400 14px/1.7 Helvetica,Arial,sans-serif">${rows.map((r) => `<li>${r}</li>`).join("")}</ul>`
      : "";

  const blocks = [
    sec("🗓️ Coming up", (events as any[]).map((e) => `<b>${esc(e.title)}</b> — ${fmtDate(e.starts_at, e.all_day)}${e.location ? ` · ${esc(e.location)}` : ""}`)),
    sec("💼 New on the Opportunities board", (jobs as any[]).map((t) => `<a href="${SITE}/board.html#thread=${t.id}" style="color:#A07E2D">${esc(t.title)}</a>`)),
    sec("🎉 New brothers on the site", newMembers.map((b) => {
      const cls = b.pledge_class && String(b.pledge_class).toLowerCase() !== "none" ? ` · ${esc(b.pledge_class)}` : "";
      return `${esc(b.full_name)}${cls}`;
    })),
    sec("🏛️ Milestones", annis),
    (photos as any[]).length
      ? sec("📸 The gallery", [`${(photos as any[]).length} new photo${(photos as any[]).length === 1 ? "" : "s"} — <a href="${SITE}/gallery.html" style="color:#A07E2D">take a look</a>`])
      : "",
  ].filter(Boolean);

  const empty = blocks.length === 0;
  const body = empty
    ? `<p style="color:#5b6474;font:400 15px/1.7 Helvetica,Arial,sans-serif">Quiet month in the chapter — but the brotherhood is always open. Drop a photo in the gallery or say hello on the board.</p>`
    : blocks.join("");

  const html = (unsubUrl: string) => `<!doctype html><html><body style="margin:0;background:#f3efe4;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FBF8F1;border-radius:14px;overflow:hidden;border:1px solid #e3d9bd">
    <tr><td style="background:#0A1F44;padding:26px 28px;text-align:center">
      <div style="font:700 22px Georgia,serif;color:#E8C766;letter-spacing:.04em">Zeta Beta Xi</div>
      <div style="font:600 10px Helvetica,Arial;color:#b9c4dc;letter-spacing:.28em;margin-top:4px">EST. 1993 · GENESEO</div>
    </td></tr>
    <tr><td style="padding:26px 28px">
      <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0 0 6px">Brothers,</p>
      <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0">Here's what's happened in the brotherhood lately.</p>
      ${body}
      <p style="text-align:center;margin:30px 0 6px">
        <a href="${SITE}" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:12px 26px;border-radius:999px;display:inline-block">Open the site →</a>
      </p>
    </td></tr>
    <tr><td style="background:#f6f1e3;padding:16px 28px;text-align:center;border-top:1px solid #e8dfc6">
      <div style="font:400 11px/1.6 Helvetica,Arial;color:#8a8f9c">Once a brother, always a brother.<br>
        <a href="${unsubUrl}" style="color:#8a8f9c">Unsubscribe from these emails</a></div>
    </td></tr>
  </table></td></tr></table></body></html>`;

  return { html, since, counts: { events: (events as any[]).length, jobs: (jobs as any[]).length, newMembers: newMembers.length, photos: (photos as any[]).length, milestones: annis.length }, empty };
}

async function send(to: string, subject: string, html: string, unsubUrl: string) {
  if (!RESEND) return { ok: false, dry: true };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html, headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
  });
  return r.ok ? { ok: true } : { ok: false, error: await r.text() };
}

// A plain admin-only email (no List-Unsubscribe) — operational alerts, not a
// broadcast, so email_opt_out never applies.
async function sendPlain(to: string, subject: string, html: string) {
  if (!RESEND) return { ok: false, dry: true };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  return r.ok ? { ok: true } : { ok: false, error: await r.text() };
}

// ---- Gallery storage watch -------------------------------------------------
// Photos live in Cloudflare R2 (10 GB free). Once a month the digest asks
// zbxi-gallery's `usage` op for total bytes and, past 8 GB, nudges the admin —
// tons of runway before the cap, and R2 overflow costs only pennies/GB anyway.
const R2_LIMIT_GB = 10;
const R2_ALERT_BYTES = 8 * 1024 ** 3;
const gb = (b: number) => b / 1024 ** 3;

async function galleryUsage(): Promise<{ objects: number; bytes: number } | null> {
  if (!CRON_SECRET) return null;
  try {
    const r = await fetch(`${SB}/functions/v1/zbxi-gallery`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SRK, "x-zbxi-cron": CRON_SECRET },
      body: JSON.stringify({ op: "usage" }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function storageAlertHtml(bytes: number): string {
  const used = gb(bytes).toFixed(2);
  return `<!doctype html><html><body style="margin:0;background:#f3efe4;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBF8F1;border-radius:14px;border:1px solid #e3d9bd;overflow:hidden">
    <tr><td style="background:#0A1F44;padding:22px 26px;text-align:center">
      <div style="font:700 20px Georgia,serif;color:#E8C766;letter-spacing:.03em">Gallery storage heads-up</div></td></tr>
    <tr><td style="padding:24px 26px;font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657">
      <p style="margin:0 0 12px">The photo gallery is now using <b>${used} GB</b> of its <b>${R2_LIMIT_GB} GB</b> of free storage.</p>
      <p style="margin:0 0 12px">Nothing is broken and nothing is lost — this is an early nudge while there's still plenty
      of room. When you get a chance you can delete some older photos, or simply let it spill a little past 10 GB,
      which costs only a couple of cents per gigabyte on the card already on file.</p>
      <p style="text-align:center;margin:24px 0 4px">
        <a href="${SITE}/admin.html" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:11px 24px;border-radius:999px;display:inline-block">Open the admin console →</a></p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

// Browser calls (the admin console's Preview/Send buttons) carry an
// Authorization header, which makes the browser send a CORS preflight FIRST.
// Without this OPTIONS branch the preflight fell through to the auth check,
// got a bare 403, and every console call died as "TypeError: Failed to fetch".
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const test = url.searchParams.get("test") === "1";
  const dry = url.searchParams.get("dry") === "1";

  const cronOk = CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  if (!cronOk && !(await isAdmin(req))) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const ADM = await adminEmail();

    // Gallery storage: `?storage=1` returns the figure and sends NOTHING (so the
    // threshold plumbing is verifiable email-free). Computed lazily so a digest
    // Preview (?dry=1) never triggers a bucket list.
    if (url.searchParams.get("storage") === "1") {
      const storage = await galleryUsage();
      return new Response(JSON.stringify({
        storage,
        gb: storage ? +gb(storage.bytes).toFixed(3) : null,
        limitGb: R2_LIMIT_GB, alertGb: 8, wouldAlert: !!storage && storage.bytes > R2_ALERT_BYTES,
      }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const authMap = await authEmails();
    const adminUserId = Object.keys(authMap).find((id) => authMap[id].toLowerCase() === ADM) || null;
    const { html, counts, empty } = await build(adminUserId);
    const unsubBase = `${SB}/functions/v1/zbxi-unsubscribe?t=`;

    if (dry) {
      return new Response(html(unsubBase + "PREVIEW"), { headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
    }

    // Recipients: verified brothers with an account who haven't opted out.
    const rows = await db(`brothers?status=eq.verified&user_id=not.is.null&email_opt_out=eq.false&select=user_id,email,unsubscribe_token`);
    let list = (rows as any[])
      .map((b) => ({ email: b.email || authMap[b.user_id], token: b.unsubscribe_token }))
      .filter((x) => !!x.email);

    if (test) list = list.filter((x) => x.email.toLowerCase() === ADM);
    if (!list.length) return new Response(JSON.stringify({ sent: 0, note: "no recipients" }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

    const subject = `ΖΒΞ — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })} brotherhood digest`;
    let sent = 0;
    const errors: string[] = [];
    for (const r of list) {
      const unsub = unsubBase + r.token;
      const res = await send(r.email, subject, html(unsub), unsub);
      if (res.ok) sent++;
      else if (res.dry) errors.push("RESEND_API_KEY not set");
      else errors.push(String(res.error).slice(0, 120));
    }

    await db(`digest_log`, { method: "POST", body: JSON.stringify({ recipients: sent, test, note: (empty ? "quiet month; " : "") + (errors[0] || "") || null }) });

    // Storage nudge rides the real send only (never the dry preview). One bucket
    // list, reused for both the alert decision and the summary. test=1 is a
    // rehearsal, so it reports the figure but never actually alerts.
    const storage = await galleryUsage();
    let storageAlerted = false;
    if (!test && storage && storage.bytes > R2_ALERT_BYTES) {
      const res = await sendPlain(ADM, `ΖΒΞ — gallery storage at ${gb(storage.bytes).toFixed(1)} GB of ${R2_LIMIT_GB} GB`, storageAlertHtml(storage.bytes));
      storageAlerted = !!res.ok;
    }

    return new Response(JSON.stringify({ sent, attempted: list.length, test, counts, storageGb: storage ? +gb(storage.bytes).toFixed(2) : null, storageAlerted, errors: [...new Set(errors)] }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
