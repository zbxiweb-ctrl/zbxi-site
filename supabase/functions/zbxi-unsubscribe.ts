// zbxi-unsubscribe — one-click opt-out from the digest. Public (no login):
// the tokenised link in every email is the credential. Also answers the
// List-Unsubscribe-Post one-click POST that Gmail/Apple Mail send.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// `cta` is the button/link HTML under the message — a "Back to the site" link on
// result pages, or an Unsubscribe submit button on the confirm page.
const page = (title: string, msg: string, cta?: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Zeta Beta Xi</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#071634;font-family:Helvetica,Arial,sans-serif">
  <div style="text-align:center;background:#FBF8F1;border-radius:16px;padding:40px 36px;max-width:420px;border:1px solid rgba(200,162,75,.5)">
    <div style="font:700 20px Georgia,serif;color:#0A1F44">Zeta Beta Xi</div>
    <div style="font-size:11px;letter-spacing:.28em;color:#A07E2D;margin-top:4px">EST. 1993 · GENESEO</div>
    <h1 style="font:700 20px Georgia,serif;color:#0A1F44;margin:24px 0 10px">${title}</h1>
    <p style="color:#5b6474;font-size:14px;line-height:1.7;margin:0 0 24px">${msg}</p>
    ${cta ?? `<a href="https://zetabetaxi.com" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font-weight:700;font-size:14px;padding:11px 24px;border-radius:999px;display:inline-block">Back to the site</a>`}
  </div></body></html>`;

const donePage = (ok: boolean) =>
  ok
    ? page("You're unsubscribed", "You won't get the brotherhood digest anymore. Nothing else changes — your profile and account stay exactly as they are. Changed your mind? Untick “email opt-out” in My Profile.")
    : page("Link not recognised", "That unsubscribe link didn't match a brother. It may have already been used, or the address was mistyped.");
const html = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

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

  // POST is the ONLY path that mutates. It serves BOTH the RFC-8058 one-click
  // List-Unsubscribe-Post (sent by Gmail/Apple mail servers) and the confirm
  // button on the GET page below; a 2xx with any body satisfies one-click.
  if (req.method === "POST") {
    const ok = token ? await optOut(token) : false;
    return html(donePage(ok));
  }

  // GET must NOT opt out. Email link-scanners / prefetchers (Outlook SafeLinks,
  // AV gateways) fetch every link in a message to vet it, before the brother
  // opens it — a mutating GET would silently unsubscribe him. So GET only shows a
  // confirm button that POSTs.
  if (!token || token === "PREVIEW") {
    return html(page("Preview link", "This was a preview email — there is nothing to unsubscribe."));
  }
  return html(page(
    "Unsubscribe from the digest?",
    "Click below to stop receiving the brotherhood digest. Your profile and account stay exactly as they are.",
    `<form method="POST" action="?t=${encodeURIComponent(token)}" style="margin:0">
       <button type="submit" style="background:#C8A24B;color:#0A1F44;border:0;cursor:pointer;font-weight:700;font-size:14px;padding:11px 24px;border-radius:999px">Unsubscribe me</button>
     </form>`,
  ));
});
