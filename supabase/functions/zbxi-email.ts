// zbxi-email — the console's compose-an-email tool (admin + granted officers).
// Sends a custom subject/message (plus optional attachments) in the navy/gold
// shell to: every brother with an account, one pledge class, or picked brothers.
// Recipients are resolved SERVER-SIDE only, email_opt_out is respected in every
// mode, and every real send carries the per-recipient unsubscribe link — the
// composer can never override a brother's opt-out.
// Auth: admin JWT, an officer whose seat holds the `email.send` grant (checked
// via rpc/officer_can with the caller's own token — the DB stays the enforcer),
// or x-zbxi-cron for curl rehearsals.
//   ?count=1 -> resolve recipients, send nothing: { recipients, skipped_optout }
//   ?dry=1   -> return the rendered HTML, send nothing
//   ?test=1  -> send only to the caller (admin inbox under cron)
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("DIGEST_FROM") || "Zeta Beta Xi <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SITE = "https://zetabetaxi.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-zbxi-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

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

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  const body = await r.text();
  return body ? JSON.parse(body) : null;
}

// Who is calling? Returns the caller's email if the JWT is valid, else null.
async function callerEmail(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.email ? String(u.email).toLowerCase() : null;
}

// Officer check runs AS THE CALLER: officer_can() derives the seat from the
// caller's own trigger-pinned role, so a forged flag isn't possible.
async function officerAllowed(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const r = await fetch(`${SB}/rest/v1/rpc/officer_can`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ perm: "email.send" }),
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
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

function shell(subject: string, message: string, unsubUrl: string) {
  const bodyHtml = esc(message).replace(/\r\n|\r|\n/g, "<br>");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f3efe4;padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FBF8F1;border-radius:14px;overflow:hidden;border:1px solid #e3d9bd">
  <tr><td style="background:#0A1F44;padding:26px 28px;text-align:center">
    <div style="font:700 22px Georgia,serif;color:#E8C766;letter-spacing:.04em">Zeta Beta Xi</div>
    <div style="font:600 10px Helvetica,Arial;color:#b9c4dc;letter-spacing:.28em;margin-top:4px">EST. 1993 · GENESEO</div>
  </td></tr>
  <tr><td style="padding:28px">
    <div style="font:700 17px Georgia,serif;color:#1c2a45;margin:0 0 12px">${esc(subject)}</div>
    <div style="font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657">${bodyHtml}</div>
    <p style="text-align:center;margin:26px 0 4px">
      <a href="${SITE}" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:12px 26px;border-radius:999px;display:inline-block">Open the site →</a>
    </p>
  </td></tr>
  <tr><td style="background:#f6f1e3;padding:16px 28px;text-align:center;border-top:1px solid #e8dfc6">
    <div style="font:400 11px/1.6 Helvetica,Arial;color:#8a8f9c">Sent by chapter leadership · Once a brother, always a brother.<br>
      <a href="${unsubUrl}" style="color:#8a8f9c">Unsubscribe from these emails</a></div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const cronOk = CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  const caller = cronOk ? await adminEmail() : await callerEmail(req);
  const allowed = cronOk || (caller && (caller === await adminEmail() || await officerAllowed(req)));
  if (!allowed) return json({ error: "forbidden" }, 403);

  try {
    const url = new URL(req.url);
    const count = url.searchParams.get("count") === "1";
    const dry = url.searchParams.get("dry") === "1";
    const test = url.searchParams.get("test") === "1";

    const { subject = "", message = "", mode = "all", pledge_class = null, brother_ids = [], attachments = [] } =
      await req.json().catch(() => ({}));

    if (!String(subject).trim() || String(subject).length > 200) return json({ error: "subject required (max 200 chars)" }, 400);
    if (!String(message).trim() || String(message).length > 10000) return json({ error: "message required (max 10,000 chars)" }, 400);
    if (["all", "class", "pick"].indexOf(mode) === -1) return json({ error: "bad mode" }, 400);
    if (mode === "class" && !pledge_class) return json({ error: "pledge_class required" }, 400);
    if (mode === "pick" && (!Array.isArray(brother_ids) || !brother_ids.length || brother_ids.length > 100)) {
      return json({ error: "brother_ids required (max 100)" }, 400);
    }
    if (!Array.isArray(attachments) || attachments.length > 4) return json({ error: "max 4 attachments" }, 400);
    let attachChars = 0;
    for (const a of attachments) {
      if (!a || !a.filename || !a.content) return json({ error: "bad attachment" }, 400);
      attachChars += String(a.content).length;
    }
    if (attachChars > 5_600_000) return json({ error: "attachments too large (4 MB total max)" }, 400);

    // ---- resolve recipients server-side ----
    let rows = await db(
      `brothers?status=eq.verified&user_id=not.is.null&select=id,user_id,full_name,email,email_opt_out,pledge_class,unsubscribe_token`,
    ) as any[];
    if (mode === "class") rows = rows.filter((b) => b.pledge_class === pledge_class);
    if (mode === "pick") rows = rows.filter((b) => brother_ids.indexOf(b.id) !== -1);

    const optedOut = rows.filter((b) => b.email_opt_out).length;
    rows = rows.filter((b) => !b.email_opt_out);

    const authMap = await authEmails();
    const seen: Record<string, boolean> = {};
    const list = rows
      .map((b) => ({ email: (b.email || authMap[b.user_id] || "").toLowerCase(), token: b.unsubscribe_token }))
      .filter((x) => x.email && !seen[x.email] && (seen[x.email] = true));

    if (count) return json({ recipients: list.length, skipped_optout: optedOut });

    const unsubBase = `${SB}/functions/v1/zbxi-unsubscribe?t=`;
    if (dry) {
      return new Response(shell(subject, message, unsubBase + "PREVIEW"), {
        headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!RESEND) return json({ sent: 0, error: "RESEND_API_KEY not set" }, 500);
    const resendAttachments = attachments.map((a: any) => ({
      filename: String(a.filename).slice(0, 100),
      content: String(a.content),
      ...(a.type ? { content_type: String(a.type) } : {}),
    }));

    async function send(to: string, unsubUrl: string) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to, subject: String(subject),
          html: shell(subject, message, unsubUrl),
          ...(resendAttachments.length ? { attachments: resendAttachments } : {}),
          headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
      });
      return r.ok ? null : (await r.text()).slice(0, 160);
    }

    if (test) {
      const err = await send(caller!, unsubBase + "PREVIEW");
      return err ? json({ sent: 0, error: err }, 502) : json({ sent: 1, to: "you (test)" });
    }

    if (!list.length) return json({ sent: 0, note: "no recipients" });

    let sent = 0;
    const errors: string[] = [];
    for (const r of list) {
      const err = await send(r.email, unsubBase + r.token);
      if (err) errors.push(err); else sent++;
    }

    await db(`digest_log`, {
      method: "POST",
      body: JSON.stringify({ recipients: sent, test: false, note: ("composed: " + String(subject)).slice(0, 180) }),
    });

    return json({ sent, attempted: list.length, skipped_optout: optedOut, errors: [...new Set(errors)] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
