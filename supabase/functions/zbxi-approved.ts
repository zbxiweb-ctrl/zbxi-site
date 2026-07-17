// zbxi-approved — one transactional "you're approved" welcome email, fired by
// the admin console right after a brother's profile is approved. Same navy/gold
// shell as the invite email; body = orientation steps + recent chapter activity.
// Auth: the admin's JWT (like zbxi-invite) or the x-zbxi-cron secret (like the
// digest — also how it's tested without a browser session).
//   ?dry=1  -> return the HTML instead of sending (preview)
//   ?test=1 -> send to the admin's own inbox instead of the brother
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

async function db(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  return r.json();
}

async function isAdmin(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return false;
  const u = await r.json();
  return String(u?.email || "").toLowerCase() === await adminEmail();
}

const STEP = (n: string, title: string, text: string) => `
  <tr><td style="padding:10px 0">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td valign="top" style="padding-right:12px"><div style="width:26px;height:26px;border-radius:50%;background:#0A1F44;color:#E8C766;font:700 13px/26px Helvetica,Arial;text-align:center">${n}</div></td>
      <td><div style="font:700 14px Helvetica,Arial;color:#1c2a45">${title}</div>
        <div style="font:400 13px/1.6 Helvetica,Arial;color:#3d4657">${text}</div></td>
    </tr></table>
  </td></tr>`;

function body(first: string | null, activity: string) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f3efe4;padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FBF8F1;border-radius:14px;overflow:hidden;border:1px solid #e3d9bd">
  <tr><td style="background:#0A1F44;padding:26px 28px;text-align:center">
    <div style="font:700 22px Georgia,serif;color:#E8C766;letter-spacing:.04em">Zeta Beta Xi</div>
    <div style="font:600 10px Helvetica,Arial;color:#b9c4dc;letter-spacing:.28em;margin-top:4px">EST. 1993 · GENESEO</div>
  </td></tr>
  <tr><td style="padding:28px">
    <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0 0 14px">${first ? `${esc(first)},` : "Brother,"}</p>
    <p style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657;margin:0 0 14px">
      <b>Chapter leadership has approved your profile — you're in.</b> The members side of the site is
      now open to you: the full family tree back to 1993, the brotherhood directory, the photo gallery,
      and the board.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 2px">
      ${STEP("1", "Polish your profile", "Add a photo, your city and occupation — the directory is how brothers find you for referrals and mentoring.")}
      ${STEP("2", "Find yourself in the family tree", "Every brother since 1993, big to little. Open your line and see where you fit.")}
      ${STEP("3", "Say hello on the board", "Introduce yourself in Introductions — name, class, and where the brotherhood took you.")}
    </table>
    <p style="text-align:center;margin:24px 0 8px">
      <a href="${SITE}/welcome.html" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:13px 28px;border-radius:999px;display:inline-block">Start your orientation →</a>
    </p>
    ${activity}
  </td></tr>
  <tr><td style="background:#f6f1e3;padding:16px 28px;text-align:center;border-top:1px solid #e8dfc6">
    <div style="font:400 11px/1.6 Helvetica,Arial;color:#8a8f9c">Once a brother, always a brother.<br>
      You received this one-time email because chapter leadership approved your account on zetabetaxi.com.</div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

async function activityHtml(): Promise<string> {
  const now = new Date().toISOString();
  const [events, threads] = await Promise.all([
    db(`events?select=title,starts_at,location&starts_at=gte.${encodeURIComponent(now)}&order=starts_at.asc&limit=2`),
    db(`forum_threads?select=title,created_at&order=created_at.desc&limit=3`),
  ]);
  const rows: string[] = [];
  for (const e of events as { title: string; starts_at: string; location: string | null }[]) {
    const when = new Date(e.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    rows.push(`<div style="font:400 13px/1.8 Helvetica,Arial;color:#3d4657">📅 <b>${esc(e.title)}</b> — ${esc(when)}${e.location ? " · " + esc(e.location) : ""}</div>`);
  }
  for (const t of threads as { title: string }[]) {
    rows.push(`<div style="font:400 13px/1.8 Helvetica,Arial;color:#3d4657">💬 ${esc(t.title)}</div>`);
  }
  if (!rows.length) return "";
  return `<div style="margin:18px 0 0;padding:14px 16px;background:#f6f1e3;border:1px solid #e8dfc6;border-radius:10px">
    <div style="font:600 10px Helvetica,Arial;color:#8a8f9c;letter-spacing:.22em;margin-bottom:6px">LATELY IN THE BROTHERHOOD</div>
    ${rows.join("")}
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cronOk = CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  if (!cronOk && !(await isAdmin(req))) return json({ error: "forbidden" }, 403);

  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    const test = url.searchParams.get("test") === "1";
    const { brother_id = null } = await req.json().catch(() => ({}));
    if (!brother_id) return json({ error: "brother_id required" }, 400);

    const b = (await db(`brothers?id=eq.${encodeURIComponent(brother_id)}&select=full_name,user_id,status`))?.[0];
    if (!b) return json({ error: "no such brother" }, 404);
    if (b.status !== "verified") return json({ error: "brother is not approved" }, 400);

    const first = String(b.full_name || "").split(" ")[0] || null;
    const html = body(first, await activityHtml());
    if (dry) return new Response(html, { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });

    // The signup (login) email lives in auth.users, not on the brothers row.
    let to: string | null = null;
    if (test) {
      to = await adminEmail();
    } else if (b.user_id) {
      const r = await fetch(`${SB}/auth/v1/admin/users/${b.user_id}`, {
        headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
      });
      if (r.ok) to = (await r.json())?.email || null;
    }
    if (!to) return json({ sent: 0, note: "no account/email to notify" });

    if (!RESEND) return json({ sent: 0, error: "RESEND_API_KEY not set" }, 500);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject: "You're approved — welcome to the ΖΒΞ brotherhood", html }),
    });
    if (!r.ok) return json({ sent: 0, error: (await r.text()).slice(0, 200) }, 502);
    return json({ sent: 1, to: test ? "admin (test)" : "brother" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
