// zbxi-thanks — one thank-you for one recorded gift.
//
// WHY THIS EXISTS. A fund page with a target and a bar asks people to give. A thank-you is
// what makes them give AGAIN next year, and it is the half nobody builds. The treasurer
// records the gift; this closes the loop in the same motion.
//
// SHAPE. Admin-gated and takes ONE gift id, rather than a cron that sweeps: the webmaster is
// standing right there when he records it, so he learns immediately if the brother has no
// address on file — which is the thing worth knowing. No new cron, no claim verb, no backlog.
//
// It renders the chapter's email shell and hands the message to the existing queue, which
// paces every send against the same daily cap. It does not talk to the mail provider.
//
// NO AMOUNT IS EVER IN THE EMAIL BODY beyond the one the brother himself gave, and it never
// says what anyone else gave.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://zetabetaxi.com";
const UNSUB_MARK = "{{UNSUB}}";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // `apikey` is here because every Supabase browser client sends it, and a preflight fails
  // on ANY requested header the server does not name — surfacing only as the useless
  // "TypeError: Failed to fetch". Learned on zbxi-event-reminder.
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

async function isAdmin(auth: string | null): Promise<boolean> {
  if (!auth) return false;
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!u.ok) return false;
  const me = await u.json();
  const a = await fetch(`${SB}/rest/v1/rpc/admin_email`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const adminEmail = a.ok ? await a.json() : null;
  return !!me?.email && !!adminEmail &&
    String(me.email).toLowerCase() === String(adminEmail).toLowerCase();
}

const usd = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/* Same shell as the digest, the notification mailer and the event reminder: table layout,
   inline styles, navy bar, cream card. Short on purpose — a thank-you that reads like a
   newsletter is not a thank-you. */
function body(first: string, amount: number, label: string | null): string {
  return `<!doctype html><html><body style="margin:0;background:#f3efe4;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBF8F1;border-radius:14px;border:1px solid #e3d9bd;overflow:hidden">
    <tr><td style="background:#0A1F44;padding:22px 26px;text-align:center">
      <div style="font:700 20px Georgia,serif;color:#E8C766;letter-spacing:.03em">Thank you, brother</div></td></tr>
    <tr><td style="padding:24px 26px;font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657">
      <p style="margin:0 0 12px">${esc(first)},</p>
      <p style="margin:0 0 12px">Your gift of <b>${usd(amount)}</b>${label ? ` to the <b>${esc(label)}</b>` : " to the Alumni Fund"} came through, and the chapter is grateful for it.</p>
      <p style="margin:0 0 12px">Gifts from alumni are what keep this thing running — and what let the actives put on the events the rest of us still talk about.</p>
      <p style="text-align:center;margin:24px 0 4px">
        <a href="${SITE}/donations.html" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:11px 24px;border-radius:999px;display:inline-block">See where the fund stands →</a></p>
      <p style="margin:14px 0 0;font-size:13px;color:#8a8f9c">Once a brother, always a brother.</p>
    </td></tr>
    <tr><td style="padding:0 26px 22px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#8a8171;text-align:center">
      Zeta Beta Xi · SUNY Geneseo · Est. 1993<br>
      <a href="${UNSUB_MARK}" style="color:#8a8171">Unsubscribe from brotherhood email</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req.headers.get("Authorization")))) return json({ ok: false, error: "forbidden" }, 403);

  try {
    const { gift_id } = await req.json();
    if (!gift_id) return json({ ok: false, error: "no gift given" }, 400);

    const gift = (await db(`fund_gifts?id=eq.${encodeURIComponent(gift_id)}&select=*`))?.[0];
    if (!gift) return json({ ok: false, error: "that gift is not on file" }, 404);
    if (gift.thanked_at) return json({ ok: false, error: "he has already been thanked for this one" });

    // A gift not linked to a roster row has nobody to thank. SAY SO — the treasurer is
    // standing there and can fix it, whereas a silent no-op means he believes it was sent.
    if (!gift.brother_id) {
      return json({ ok: false, error: "this gift is not linked to a brother, so there is no address to send to" });
    }
    const bro = (await db(
      `brothers?id=eq.${encodeURIComponent(gift.brother_id)}&select=full_name,roster_name,email,email_opt_out,unsubscribe_token`,
    ))?.[0];
    if (!bro) return json({ ok: false, error: "that brother is no longer on the roster" });
    if (!String(bro.email || "").trim()) {
      return json({ ok: false, error: `no email on file for ${String(bro.full_name || "him").split(" ")[0]} — thank him another way` });
    }
    // His choice outranks our gratitude.
    if (bro.email_opt_out) {
      return json({ ok: false, error: `${String(bro.full_name || "he").split(" ")[0]} has opted out of email from the site` });
    }

    const cfg = (await db(`donations?id=eq.1&select=goal_label`))?.[0] || {};
    const first = String(bro.roster_name || bro.full_name || "").trim().split(" ")[0] || "Brother";

    const batch = await db(`email_batches`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        kind: "notify",     // an existing kind: this is a one-off note to one brother
        subject: "Thank you from Zeta Beta Xi",
        html: body(first, gift.amount_cents, cfg.goal_label || null),
        created_by: "zbxi-thanks",
      }),
    });
    await db(`email_queue`, {
      method: "POST",
      body: JSON.stringify([{
        batch_id: batch[0].id,
        to_email: bro.email,
        unsub_url: bro.unsubscribe_token
          ? `${SB}/functions/v1/zbxi-unsubscribe?t=${encodeURIComponent(bro.unsubscribe_token)}`
          : null,
      }]),
    });

    // Stamped only after the queue accepted it, so a failure above leaves the gift
    // un-thanked and visibly so, rather than marked done with nothing sent.
    await db(`fund_gifts?id=eq.${encodeURIComponent(gift_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ thanked_at: new Date().toISOString() }),
    });

    return json({ ok: true, to: bro.email });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 200) }, 500);
  }
});
