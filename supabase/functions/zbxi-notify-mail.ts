// zbxi-notify-mail — turns a 🤝 Connect request and a 🎓 mentor request into an actual
// email, not just a bell nobody is standing in the room to hear.
//
// WHY THIS EXISTS. Both features worked and both were silent. connect_request() and
// mentor_request() write a notification and stop there. 246 of the 359 brothers on the
// roster have no account, and most of the rest sign in rarely — so a brother could be
// asked for help and never learn it happened. The bell is still the record; this is the
// tap on the shoulder.
//
// Auth: cron secret header (x-zbxi-cron) or the admin's JWT. Same gate as the digest.
//   ?dry=1  -> claim NOTHING, render a sample from a fabricated row, send nothing.
//   ?peek=1 -> report how many are waiting. Claims nothing.
//
// The claim (claim_notify_mail) stamps emailed_at in the same statement that returns the
// row, so a crash costs one email rather than repeating it forever. It also drops anything
// older than two days, skips brothers who opted out, and is service_role only because it
// returns email addresses. All of that is enforced in upgrade59.sql, not here.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SITE = "https://zetabetaxi.com";

// The literal the drainer swaps for each brother's own unsubscribe URL.
const UNSUB_MARK = "{{UNSUB}}";

type Claim = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  to_email: string;
  unsub_token: string | null;
  to_name: string;
};

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/* ---- the email ------------------------------------------------------------------
   Same shell as the digest and the storage alert: table layout, inline styles, a navy
   bar and the cream card. `width="100%"` plus `max-width` because the HTML width
   attribute is what Outlook obeys and the CSS max-width is what everything else does.

   The subject line names the person, because "You have a new notification" is the
   thing people learn to ignore. */
function shell(heading: string, inner: string, unsubLine: boolean): string {
  return `<!doctype html><html><body style="margin:0;background:#f3efe4;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBF8F1;border-radius:14px;border:1px solid #e3d9bd;overflow:hidden">
    <tr><td style="background:#0A1F44;padding:22px 26px;text-align:center">
      <div style="font:700 20px Georgia,serif;color:#E8C766;letter-spacing:.03em">${heading}</div></td></tr>
    <tr><td style="padding:24px 26px;font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657">
      ${inner}
    </td></tr>
    <tr><td style="padding:0 26px 22px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#8a8171;text-align:center">
      Zeta Beta Xi · SUNY Geneseo · Est. 1993${
        unsubLine
          ? `<br><a href="${UNSUB_MARK}" style="color:#8a8171">Unsubscribe from brotherhood email</a>`
          : ""
      }
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="text-align:center;margin:24px 0 4px">
    <a href="${href}" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:11px 24px;border-radius:999px;display:inline-block">${label}</a></p>`;
}

function render(c: Claim): { subject: string; html: string } {
  const first = String(c.to_name || "").trim().split(" ")[0] || "Brother";
  const actor = esc(c.payload?.actor ?? "A brother");
  const email = String(c.payload?.email ?? "");
  const note = c.payload?.note ? String(c.payload.note) : "";

  // The requester's own address, so replying is the obvious next move rather than
  // "log in and find the bell". This is the entire point of the feature.
  const replyLine = email
    ? `<p style="margin:0 0 12px">Reply straight to him: <a href="mailto:${esc(email)}" style="color:#7d5f1e"><b>${esc(email)}</b></a></p>`
    : "";
  const noteBlock = note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0">
         <tr><td style="border-left:3px solid #C8A24B;padding:6px 14px;font-style:italic;color:#4a5264">“${esc(note)}”</td></tr>
       </table>`
    : "";

  if (c.kind === "mentor_request") {
    const field = esc(c.payload?.field ?? "");
    return {
      subject: `${String(c.payload?.actor ?? "A brother")} is looking for a mentor`,
      html: shell(
        "A brother asked for help",
        `<p style="margin:0 0 12px">${first},</p>
         <p style="margin:0 0 12px"><b>${actor}</b> is looking for a mentor${field ? ` in <b>${field}</b>` : ""}, and you are one of the brothers who said you would help.</p>
         ${noteBlock}${replyLine}
         <p style="margin:12px 0 0">No obligation — if it is not a fit, ignore this and nothing happens.</p>
         ${button(`${SITE}/mentoring.html`, "See the Mentoring page →")}`,
        true,
      ),
    };
  }

  return {
    subject: `${String(c.payload?.actor ?? "A brother")} wants to connect`,
    html: shell(
      "A brother wants to connect",
      `<p style="margin:0 0 12px">${first},</p>
       <p style="margin:0 0 12px"><b>${actor}</b> reached out through the brotherhood directory.</p>
       ${noteBlock}${replyLine}
       ${button(`${SITE}/notifications.html`, "Open your notifications →")}`,
      true,
    ),
  };
}

/* ---- queue it -------------------------------------------------------------------
   One batch per email because each one is addressed to a different person and says
   something different — the batch/queue split exists to store ONE body for many
   recipients, which does not apply here. Volume is tiny by design: one request per
   brother per recipient per week, and at most five recipients per mentor request. */
async function enqueue(kind: string, subject: string, html: string, to: string, unsub: string | null) {
  const batch = await db(`email_batches`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ kind, subject, html, created_by: "zbxi-notify-mail" }),
  });
  await db(`email_queue`, {
    method: "POST",
    body: JSON.stringify([{ batch_id: batch[0].id, to_email: to, unsub_url: unsub }]),
  });
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
  const adminEmail = a.ok ? (await a.json()) : null;
  return !!me?.email && !!adminEmail &&
    String(me.email).toLowerCase() === String(adminEmail).toLowerCase();
}

// A browser call carrying an Authorization header sends a CORS preflight FIRST. Without
// this branch the OPTIONS request falls through to the auth check below, gets a bare 403,
// and the caller sees "TypeError: Failed to fetch" with no clue why. zbxi-digest documents
// having hit exactly this; I hit it too, testing from the console.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-zbxi-cron",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const peek = url.searchParams.get("peek") === "1";

  const cronOk = !!CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  if (!cronOk && !(await isAdmin(req.headers.get("Authorization")))) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // ?peek — how many are waiting, claiming nothing. Safe to hit any time.
  if (peek) {
    const rows = await db(
      `notifications?emailed_at=is.null&kind=in.(connect_request,mentor_request)&select=id,kind,created_at`,
    );
    return new Response(JSON.stringify({ waiting: rows.length, rows }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // ?dry — render a fabricated example. Claims nothing, sends nothing, touches nobody.
  if (dry) {
    const sample = render({
      id: "00000000-0000-0000-0000-000000000000",
      kind: url.searchParams.get("kind") === "mentor_request" ? "mentor_request" : "connect_request",
      payload: {
        actor: "Marcus Reilly",
        email: "example@invalid.test",
        note: "Saw you're at Evercore — would love 15 minutes on breaking into banking.",
        field: "Finance & Banking",
      },
      to_email: "nobody@example.invalid",
      unsub_token: null,
      to_name: "Daniel Okafor",
    });
    return new Response(sample.html, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
  }

  const claimed: Claim[] = await db(`rpc/claim_notify_mail`, {
    method: "POST",
    body: JSON.stringify({ p_limit: 50 }),
  });

  let queued = 0;
  const problems: string[] = [];
  for (const c of claimed) {
    try {
      const { subject, html } = render(c);
      // The SAME endpoint the digest uses — a function, not a site page. Checked against
      // zbxi-digest rather than guessed; my first attempt pointed at an unsubscribe.html
      // that does not exist, which would have shipped a dead link in every one of these.
      const unsub = c.unsub_token
        ? `${SB}/functions/v1/zbxi-unsubscribe?t=${encodeURIComponent(c.unsub_token)}`
        : null;
      // 'notify' exactly — email_batches.kind is CHECKed against a fixed set, and
      // `notify:connect_request` is not in it. Which kind of notification it was is
      // already in the subject and the body; the column is for grouping the SEND.
      await enqueue("notify", subject, html, c.to_email, unsub);
      queued++;
    } catch (e) {
      // Already stamped, so this one is lost rather than repeated. Say so loudly in the
      // response instead of failing the whole run — one bad address must not block the rest.
      problems.push(`${c.id}: ${String(e).slice(0, 120)}`);
    }
  }

  return new Response(JSON.stringify({ claimed: claimed.length, queued, problems }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
