// zbxi-claim — an INVITED brother sets his password and joins in ONE step, with
// NO confirmation email. His invite token (delivered to his inbox) is the proof
// he controls the address, so we create his account ALREADY CONFIRMED via the
// service role. Because it's created confirmed, GoTrue never sends a "confirm
// your email" message — that's the whole point.
//
// Security: gated entirely on the invite token (an unguessable uuid, same trust
// as the existing invite_status / claim-your-profile link). Creates nothing if
// the email already has an account (he should just log in). He still lands in
// Pending until an admin approves — this grants no access on its own.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${path}: ${body}`);
  return body ? JSON.parse(body) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { token, password } = await req.json();
    if (!token || typeof password !== "string" || password.length < 8) {
      return json({ error: "invalid input" }, 400);
    }

    // 1. token -> invited email (the token is the proof of inbox control)
    const inv = await db(`invites?token=eq.${encodeURIComponent(token)}&select=id,email`);
    if (!inv?.[0]) return json({ error: "invalid or expired invite" }, 400);
    const email = String(inv[0].email).toLowerCase();

    // 2. create the account ALREADY CONFIRMED (no confirmation email is sent).
    //    If the email is already taken, tell the client to log in instead.
    const cr = await fetch(`${SB}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!cr.ok) {
      const t = await cr.text();
      if (/already.*(registered|exists)|duplicate|has already/i.test(t)) {
        return json({ error: "account exists", exists: true }, 409);
      }
      return json({ error: t.slice(0, 200) }, 500);
    }

    // 3. stamp the invite as accepted (best-effort; don't fail the claim over it)
    await fetch(`${SB}/rest/v1/invites?id=eq.${inv[0].id}`, {
      method: "PATCH",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accepted_at: new Date().toISOString() }),
    }).catch(() => {});

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
