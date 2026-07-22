// zbxi-pending — tells the ADMIN, by email, that brothers are waiting for approval.
// Before this, the only signal was the bell on the site, so a signup could sit unseen.
//
// Driven by a 5-minute pg_cron job (job `zbxi-pending-alert`) that POSTs here with the
// x-zbxi-cron secret. Each run calls claim_pending_alerts() (upgrade27.sql), whose
// UPDATE ... RETURNING atomically CLAIMS the un-alerted pending rows. That gives two
// properties for free:
//   * no duplicates — a second run cannot re-claim the same brother
//   * burst protection — several signups in one window arrive as ONE summary email,
//     so a launch day (41 signups happened once) can't produce 41 emails.
// Quiet by design: 0 claimed => nothing sent (this is the case ~288x/day).
//
// Auth: the admin's JWT, or the x-zbxi-cron secret (same as the digest).
//   ?dry=1  -> return the HTML instead of sending (preview; claims nothing)
//   ?test=1 -> send to the admin's inbox (claims nothing; uses a sample if the queue is empty)
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("DIGEST_FROM") || "Zeta Beta Xi <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SITE = "https://zetabetaxi.com";

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-zbxi-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function dbGet(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  return r.json();
}
async function dbPost(path: string, body: unknown) {
  await fetch(`${SB}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});      // logging must never fail the send
}

async function isAdmin(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return false;
  const u = await r.json();
  return String(u?.email || "").toLowerCase() === await adminEmail();
}

type Row = {
  brother_id: string | null;
  brother_name: string | null;
  brother_class: string | null;
  login_email: string | null;
  signed_up: string | null;
  claimed: boolean | null;    // true = matched himself to an existing chapter-record row
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }) + " ET";

function personRow(b: Row) {
  const bits = [b.brother_class, b.login_email].filter(Boolean).map(esc);
  // signed_up is always present on the live path (the RPC joins auth.users). It's null
  // only in ?dry=1 / ?test=1, which read the queue without claiming — so say nothing
  // rather than print a "just now" that isn't true.
  return `
  <tr><td style="padding:10px 0;border-bottom:1px solid #e8dfc6">
    <div style="font:700 15px Helvetica,Arial;color:#1c2a45">${esc(b.brother_name || "(no name given)")}</div>
    ${bits.length ? `<div style="font:400 13px/1.6 Helvetica,Arial;color:#3d4657">${bits.join(" · ")}</div>` : ""}
    ${b.signed_up ? `<div style="font:400 12px Helvetica,Arial;color:#8a8f9c">Signed up ${esc(when(b.signed_up))}</div>` : ""}
    ${b.claimed === null ? "" : b.claimed
      ? `<div style="font:600 12px Helvetica,Arial;color:#3f7a4d;margin-top:3px">✓ Claimed an existing roster entry</div>`
      : `<div style="font:600 12px Helvetica,Arial;color:#a4392f;margin-top:3px">⚠ Created a new profile — check him against the roster</div>`}
  </td></tr>`;
}

function body(rows: Row[]) {
  const many = rows.length > 1;
  const lead = many
    ? `<b>${rows.length} brothers are waiting for your approval.</b> Until you approve them they can't see the
       members side of the site, so they're stuck at the front door.`
    : `<b>A brother is waiting for your approval.</b> Until you approve him he can't see the members side of
       the site, so he's stuck at the front door.`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f3efe4;padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FBF8F1;border-radius:14px;overflow:hidden;border:1px solid #e3d9bd">
  <tr><td style="background:#0A1F44;padding:26px 28px;text-align:center">
    <div style="font:700 22px Georgia,serif;color:#E8C766;letter-spacing:.04em">Zeta Beta Xi</div>
    <div style="font:600 10px Helvetica,Arial;color:#b9c4dc;letter-spacing:.28em;margin-top:4px">APPROVAL NEEDED</div>
  </td></tr>
  <tr><td style="padding:28px">
    <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0 0 16px">${lead}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 2px">
      ${rows.map(personRow).join("")}
    </table>
    <p style="text-align:center;margin:26px 0 8px">
      <a href="${SITE}/admin.html#pending" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:13px 28px;border-radius:999px;display:inline-block">Open the approval queue →</a>
    </p>
    <p style="font:400 13px/1.7 Helvetica,Arial;color:#8a8f9c;margin:14px 0 0">
      Check the name against the chapter roster before approving — the console flags anyone who looks like a
      duplicate or isn't on the roster at all.
    </p>
  </td></tr>
  <tr><td style="background:#f6f1e3;padding:16px 28px;text-align:center;border-top:1px solid #e8dfc6">
    <div style="font:400 11px/1.6 Helvetica,Arial;color:#8a8f9c">You're getting this because you're the site
      administrator for zetabetaxi.com.<br>It's sent only when someone is actually waiting.</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// Shown only when the queue is empty, so a preview still demonstrates the design.
// Deliberately the self-created case — that's the flag actually worth recognising.
const SAMPLE: Row = {
  brother_id: null, brother_name: "Sample Brother", brother_class: "Gamma Rho · Fall '25",
  login_email: "sample@example.com", signed_up: new Date().toISOString(), claimed: false,
};

// Preview/test read the queue WITHOUT claiming, so testing can never swallow a real alert.
async function peek(): Promise<Row[]> {
  const rows = await dbGet(
    `brothers?status=eq.pending&select=id,full_name,pledge_class,roster_name&order=created_at.desc&limit=10`,
  );
  return (rows as { id: string; full_name: string; pledge_class: string | null; roster_name: string | null }[])
    .map((b) => ({
      brother_id: b.id, brother_name: b.full_name, brother_class: b.pledge_class,
      login_email: null, signed_up: null, claimed: b.roster_name !== null,
    }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cronOk = CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  if (!cronOk && !(await isAdmin(req))) return json({ error: "forbidden" }, 403);

  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    const test = url.searchParams.get("test") === "1";

    let rows: Row[];
    if (dry || test) {
      rows = await peek();
      if (!rows.length) rows = [SAMPLE];            // empty queue: still show the design
    } else {
      const r = await fetch(`${SB}/rest/v1/rpc/claim_pending_alerts`, {
        method: "POST",
        headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) return json({ sent: 0, error: (await r.text()).slice(0, 200) }, 500);
      rows = (await r.json()) as Row[];
      if (!rows.length) return json({ sent: 0 });   // the quiet path — nothing waiting
    }

    const html = body(rows);
    if (dry) return new Response(html, { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });

    const subject = rows.length > 1
      ? `${rows.length} brothers awaiting approval · ΖΒΞ`
      : `${rows[0].brother_name || "A brother"} is awaiting approval · ΖΒΞ`;

    if (!RESEND) return json({ sent: 0, error: "RESEND_API_KEY not set" }, 500);
    const to = await adminEmail();
    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!send.ok) return json({ sent: 0, error: (await send.text()).slice(0, 200) }, 502);

    await dbPost("digest_log", {
      recipients: 1, test,
      note: `pending alert: ${rows.length} brother${rows.length === 1 ? "" : "s"}`.slice(0, 180),
    });
    return json({ sent: 1, brothers: rows.length, test });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
