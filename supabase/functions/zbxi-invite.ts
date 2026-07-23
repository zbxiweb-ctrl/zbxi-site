// zbxi-invite — admin-only "claim your profile" invitations.
// Transactional, one known brother at a time (never a bulk marketing blast):
// this is how the 300+ roster names without accounts actually get on the site,
// which is what makes the digest and the directory worth anything.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("DIGEST_FROM") || "Zeta Beta Xi <onboarding@resend.dev>";
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  // PostgREST returns 201 + empty body on insert; never JSON.parse("").
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

const body = (name: string | null, link: string) => `<!doctype html><html><body style="margin:0;background:#f3efe4;padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FBF8F1;border-radius:14px;overflow:hidden;border:1px solid #e3d9bd">
  <tr><td style="background:#0A1F44;padding:26px 28px;text-align:center">
    <div style="font:700 22px Georgia,serif;color:#E8C766;letter-spacing:.04em">Zeta Beta Xi</div>
    <div style="font:600 10px Helvetica,Arial;color:#b9c4dc;letter-spacing:.28em;margin-top:4px">EST. 1993 · GENESEO</div>
  </td></tr>
  <tr><td style="padding:28px">
    <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0 0 14px">${name ? `${esc(name)},` : "Brother,"}</p>
    <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0 0 14px">
      The brothers of ΖΒΞ have built a private home for the chapter — the full family tree back to our founding in 1993,
      a members-only directory, the photo gallery, and a board where brothers trade jobs, referrals and advice.
    </p>
    <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0 0 14px">
      <b>Your name is already on the tree.</b> Create an account, claim your profile, and you'll be verified by chapter
      leadership — then everything above opens up.
    </p>
    <p style="text-align:center;margin:28px 0 10px">
      <a href="${link}" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:13px 28px;border-radius:999px;display:inline-block">Claim your profile →</a>
    </p>
    <p style="font:400 12px/1.6 Helvetica,Arial;color:#8a8f9c;text-align:center;margin:14px 0 0">
      Takes two minutes. Your details are visible only to verified brothers — never the public.
    </p>
  </td></tr>
  <tr><td style="background:#f6f1e3;padding:16px 28px;text-align:center;border-top:1px solid #e8dfc6">
    <div style="font:400 11px/1.6 Helvetica,Arial;color:#8a8f9c">Once a brother, always a brother.<br>
      You received this because a chapter officer invited you. Not a brother? Simply ignore this email.</div>
  </td></tr>
</table></td></tr></table></body></html>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req))) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    const { emails = [], brother_id = null } = await req.json();
    // lower-cased so the `invites.email` unique constraint dedupes properly
    const list: string[] = [...new Set((emails as string[]).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
    if (!list.length) return new Response(JSON.stringify({ error: "no valid emails" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    if (list.length > 25) return new Response(JSON.stringify({ error: "max 25 at a time" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    // Optional: personalise using the roster row this invite is linked to.
    let name: string | null = null;
    if (brother_id) {
      const b = await db(`brothers?id=eq.${encodeURIComponent(brother_id)}&select=full_name`);
      name = b?.[0]?.full_name?.split(" ")[0] || null;
    }

    const results: any[] = [];
    for (const email of list) {
      // Upsert FIRST so we have this invite's token to put in the link. The
      // token lets the portal look up whether the address already has an
      // account, and land the brother on Log in vs Create account.
      const up = await fetch(`${SB}/rest/v1/invites?on_conflict=email`, {
        method: "POST",
        headers: {
          apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({ email, brother_id }),
      });
      if (!up.ok) { results.push({ email, ok: false, error: (await up.text()).slice(0, 140) }); continue; }
      const row = (await up.json())[0];
      const link = `${SITE}/?invite=${row.token}#brothers-portal`;

      let error: string | null = null;
      if (!RESEND) {
        error = "RESEND_API_KEY not set";
      } else {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM, to: email, subject: "Your place in the ΖΒΞ family tree is waiting", html: body(name, link) }),
        });
        if (!r.ok) error = (await r.text()).slice(0, 140);
      }

      // Stamp the outcome so the admin sees exactly what happened.
      await fetch(`${SB}/rest/v1/invites?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sent_at: error ? null : new Date().toISOString(), error }),
      });
      results.push({ email, ok: !error, error });
    }

    return new Response(JSON.stringify({ sent: results.filter((r) => r.ok).length, results }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
