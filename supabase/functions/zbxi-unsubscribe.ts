// zbxi-unsubscribe — one-click opt-out from the digest. Public (no login):
// the tokenised link in every email is the credential. Also answers the
// List-Unsubscribe-Post one-click POST that Gmail/Apple Mail send.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const page = (title: string, msg: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Zeta Beta Xi</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#071634;font-family:Helvetica,Arial,sans-serif">
  <div style="text-align:center;background:#FBF8F1;border-radius:16px;padding:40px 36px;max-width:420px;border:1px solid rgba(200,162,75,.5)">
    <div style="font:700 20px Georgia,serif;color:#0A1F44">Zeta Beta Xi</div>
    <div style="font-size:11px;letter-spacing:.28em;color:#A07E2D;margin-top:4px">EST. 1993 · GENESEO</div>
    <h1 style="font:700 20px Georgia,serif;color:#0A1F44;margin:24px 0 10px">${title}</h1>
    <p style="color:#5b6474;font-size:14px;line-height:1.7;margin:0 0 24px">${msg}</p>
    <a href="https://zetabetaxi.com" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font-weight:700;font-size:14px;padding:11px 24px;border-radius:999px;display:inline-block">Back to the site</a>
  </div></body></html>`;

async function optOut(token: string) {
  const r = await fetch(`${SB}/rest/v1/brothers?unsubscribe_token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ email_opt_out: true }),
  });
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") || "";

  // Gmail/Apple one-click unsubscribe
  if (req.method === "POST") {
    if (token) await optOut(token);
    return new Response("ok", { status: 200 });
  }

  if (!token || token === "PREVIEW") {
    return new Response(page("Preview link", "This was a preview email — there is nothing to unsubscribe."), {
      status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const ok = await optOut(token);
  return new Response(
    ok
      ? page("You're unsubscribed", "You won't get the brotherhood digest anymore. Nothing else changes — your profile and account stay exactly as they are. Changed your mind? Untick “email opt-out” in My Profile.")
      : page("Link not recognised", "That unsubscribe link didn't match a brother. It may have already been used, or the address was mistyped."),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
});
