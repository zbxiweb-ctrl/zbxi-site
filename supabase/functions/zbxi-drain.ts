// zbxi-drain — sends whatever the email queue hands it, and nothing more.
// Auth: the cron secret header (x-zbxi-cron) or a signed-in ADMIN's JWT.
//
// Why this exists: bulk mail and password resets used to share one provider's
// daily allowance. Resend gives 100 emails per DAY across the whole account and
// Supabase Auth's resets draw on it, so one all-brothers send consumed the day
// and silently blocked every reset until midnight UTC.
//
// THE SPLIT (2026-08-11): the two jobs now use two providers, so they cannot
// starve each other.
//   BULK  (this file — digest, all-brothers email, invites)  -> Brevo, 300/day
//   AUTH  (Supabase SMTP: resets, verification)              -> Resend, 100/day
//   Small transactional (zbxi-approved, zbxi-pending, ?test=1) -> Resend
// Pointing anything else at the Brevo key re-creates the collision on a new
// provider. Only this function should hold it.
//
// The daily cap is NOT in this file. claim_email_batch() carries it as a default
// argument and only service_role may execute it, so the ceiling is a property of
// the database, not a constant a future maintainer can bump by editing
// TypeScript. This function deliberately calls the RPC with only a batch size
// and lets the DB decide how much of it it is allowed to have. What that cap
// protects has changed — it now keeps us under BREVO's 300/day; see upgrade51.
//
// Every call claims and sends exactly ONE batch, then reports. The cron ticks it
// every 15 minutes; calling it by hand is how a send is flushed early.
// Deployed via the Supabase Management API; no secrets live in the repo.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const BREVO = Deno.env.get("BREVO_API_KEY") || "";
// Which provider carries bulk. A SECRET, not a constant, deliberately: the
// choice of Brevo is under review (its free plan brands every email) and this
// makes going back to Resend a dashboard change rather than a redeploy.
const PROVIDER = (Deno.env.get("BULK_PROVIDER") || "brevo").toLowerCase();
const FROM = Deno.env.get("DIGEST_FROM") || "Zeta Beta Xi <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

// 120, not 20: at 20 per 15-minute tick a 113-brother digest took six ticks and
// ninety minutes. One tick now carries the whole roster in about 18 seconds at
// the pace below. The cron is a safety net again, not the delivery mechanism.
const BATCH = 120;
const PACE_MS = 150;   // gap between sends, to stay clear of either provider's burst limit
const MARK = "{{UNSUB}}";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-zbxi-cron",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  // PostgREST answers writes with an EMPTY body unless asked otherwise, so never
  // hand an empty string to JSON.parse.
  const body = await r.text();
  return body ? JSON.parse(body) : null;
}

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

async function isAdmin(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return false;
  const u = await r.json();
  return String(u?.email || "").toLowerCase() === await adminEmail();
}

type SendResult = { ok: boolean; retryable: boolean; error?: string };

// `retryable` is the whole point of these wrappers: it means "the quota door is
// shut or the provider is wobbling", so the run must STOP and leave the rest of
// the batch queued for the next tick. Anything else (a malformed address, say)
// is that row's own problem and must not stall the brothers queued behind it.
//
// Getting this classification wrong is the one bug here that silently loses
// mail: a quota response mistaken for a bad address burns the row's three
// attempts and marks a real brother permanently failed.
//
// The test: IS THIS ROW'S ADDRESS THE PROBLEM? If not, it is retryable.
//   429 / 402  quota — the door is shut, it will open tomorrow
//   401 / 403  the KEY is wrong or revoked. Systemic, not the recipient's fault.
//              This one was classified as permanent at first, which meant a
//              rotated key would mark the entire roster 'failed' and need every
//              row requeued by hand — while still hammering all 113 with a dead
//              credential instead of stopping. The give-away was that a MISSING
//              key was already retryable a few lines up: same operator mistake,
//              opposite outcome.
//   5xx        the provider is wobbling
// Everything else (a malformed address, say) belongs to its row alone and must
// not stall the brothers queued behind it.
const isSystemic = (status: number) =>
  status === 429 || status === 402 || status === 401 || status === 403 || status >= 500;

// DIGEST_FROM is an RFC address — "Zeta Beta Xi <noreply@send.zetabetaxi.com>".
// Resend takes it whole; Brevo wants the name and the address as separate fields.
function splitFrom(addr: string): { name: string; email: string } {
  const m = addr.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2].trim() }
           : { name: "", email: addr.trim() };
}

const unsubHeaders = (unsubUrl: string | null) =>
  unsubUrl
    ? {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : undefined;

async function sendViaResend(
  to: string, subject: string, html: string, unsubUrl: string | null, attachments: unknown,
): Promise<SendResult> {
  if (!RESEND) return { ok: false, retryable: true, error: "RESEND_API_KEY not set" };
  const payload: Record<string, unknown> = { from: FROM, to, subject, html };
  if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
  const h = unsubHeaders(unsubUrl);
  if (h) payload.headers = h;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { ok: true, retryable: false };
    return {
      ok: false,
      retryable: isSystemic(r.status),
      error: `resend ${r.status} ${(await r.text()).slice(0, 150)}`,
    };
  } catch (e) {
    // Network/DNS wobble — never the recipient's fault, so always retryable.
    return { ok: false, retryable: true, error: String(e).slice(0, 160) };
  }
}

// Brevo's transactional API. Three differences from Resend that all matter:
//   - the key goes in an `api-key` header, NOT `Authorization: Bearer`
//   - success is 201, not 200 (r.ok covers both, but do not "fix" it to === 200)
//   - attachments are `attachment: [{ name, content }]`, not `attachments: [{ filename, content }]`
async function sendViaBrevo(
  to: string, subject: string, html: string, unsubUrl: string | null, attachments: unknown,
): Promise<SendResult> {
  if (!BREVO) return { ok: false, retryable: true, error: "BREVO_API_KEY not set" };
  const payload: Record<string, unknown> = {
    sender: splitFrom(FROM),
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachment = (attachments as Array<Record<string, unknown>>).map((a) => ({
      name: a.filename ?? a.name,
      content: a.content,
    }));
  }
  const h = unsubHeaders(unsubUrl);
  if (h) payload.headers = h;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { ok: true, retryable: false };
    return {
      ok: false,
      // Brevo signals a spent day with 402 where Resend uses 429; both are the
      // same closed door. See isSystemic above.
      retryable: isSystemic(r.status),
      error: `brevo ${r.status} ${(await r.text()).slice(0, 150)}`,
    };
  } catch (e) {
    return { ok: false, retryable: true, error: String(e).slice(0, 160) };
  }
}

function sendBulk(
  to: string,
  subject: string,
  html: string,
  unsubUrl: string | null,
  attachments: unknown,
): Promise<SendResult> {
  return PROVIDER === "resend"
    ? sendViaResend(to, subject, html, unsubUrl, attachments)
    : sendViaBrevo(to, subject, html, unsubUrl, attachments);
}

// Never let a failed status write abort the run. db() throws on any non-OK
// response, and an exception here used to escape the send loop entirely: the row
// stayed 'sending', got reclaimed 15 minutes later, and was sent a SECOND time —
// while also dropping out of the day's count, because the reclaim clears
// claimed_at. Swallowing it leaves the reclaim to retry, which is bounded now
// that claim_email_batch gives up after 3 attempts (upgrade36).
const mark = async (id: number, patch: Record<string, unknown>) => {
  try {
    await db(`email_queue?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  } catch (e) {
    console.error("email_queue mark failed", id, String(e).slice(0, 200));
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const cronOk = CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  if (!cronOk && !(await isAdmin(req))) return json({ error: "forbidden" }, 403);

  try {
    // No cap argument: the database owns that number. See the header.
    const rows = await db(`rpc/claim_email_batch`, {
      method: "POST",
      body: JSON.stringify({ p_batch_size: BATCH }),
    }) as any[];

    if (!rows?.length) return json({ claimed: 0, sent: 0, note: "nothing to send, or the day's cap is spent" });

    let sent = 0, failed = 0, requeued = 0;
    let stopped: string | null = null;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const body = row.unsub ? String(row.mail_html).split(MARK).join(row.unsub) : String(row.mail_html);
      const res = await sendBulk(row.recipient, row.mail_subject, body, row.unsub, row.mail_attach);

      if (res.ok) {
        await mark(row.queue_id, { status: "sent", sent_at: new Date().toISOString(), error: null });
        sent++;
      } else if (res.retryable) {
        // Quota shut or provider down. Put THIS row and every row we have not
        // tried yet back on the queue, then stop — hammering a closed door would
        // burn the remaining rows' attempts for nothing.
        stopped = res.error || "retryable failure";
        for (let j = i; j < rows.length; j++) {
          await mark(rows[j].queue_id, { status: "queued", claimed_at: null });
          requeued++;
        }
        break;
      } else {
        await mark(row.queue_id, { status: "failed", error: res.error || "send failed" });
        failed++;
        errors.push(String(res.error).slice(0, 120));
      }
      if (i < rows.length - 1) await new Promise((r) => setTimeout(r, PACE_MS));
    }

    // `provider` is echoed so an operator can tell at a glance which one just ran
    // — the whole point of BULK_PROVIDER is that it can change without a deploy.
    return json({ provider: PROVIDER, claimed: rows.length, sent, failed, requeued, stopped, errors: [...new Set(errors)] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
