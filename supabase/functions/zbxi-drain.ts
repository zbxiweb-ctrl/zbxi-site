// zbxi-drain — sends whatever the email queue hands it, and nothing more.
// Auth: the cron secret header (x-zbxi-cron) or a signed-in ADMIN's JWT.
//
// Why this exists: Resend allows 100 emails per DAY across the whole account,
// and Supabase Auth's password resets come out of that same allowance. Before
// the queue, one all-brothers send (100 recipients today) consumed the entire
// day and silently blocked every password reset until midnight UTC.
//
// The daily cap is NOT in this file. claim_email_batch() carries it as a default
// argument (60) and only service_role may execute it, so the reserve for auth
// mail is a property of the database, not a constant a future maintainer can
// bump by editing TypeScript. This function deliberately calls the RPC with only
// a batch size and lets the DB decide how much of it it is allowed to have.
//
// Every call claims and sends exactly ONE batch, then reports. The cron ticks it
// every 15 minutes; calling it by hand is how a send is flushed early.
// Deployed via the Supabase Management API; no secrets live in the repo.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("DIGEST_FROM") || "Zeta Beta Xi <onboarding@resend.dev>";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const BATCH = 20;      // rows to ask for per run; the DB caps this further
const PACE_MS = 150;   // gap between sends, to stay clear of Resend's burst limit
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

// One Resend call. `retryable` is the whole point of this wrapper: a 429 or a
// 5xx means the quota door is shut or the provider is wobbling, so the run must
// STOP and leave the rest of the batch queued for the next cron tick. Anything
// else (a malformed address, say) is that row's own problem and must not stall
// the other 99 brothers behind it.
//
// It is also the seam for a second provider, if the roster ever outgrows Resend:
// swap the body of this function, leave the rest of the file alone.
async function sendBulk(
  to: string,
  subject: string,
  html: string,
  unsubUrl: string | null,
  attachments: unknown,
): Promise<{ ok: boolean; retryable: boolean; error?: string }> {
  if (!RESEND) return { ok: false, retryable: true, error: "RESEND_API_KEY not set" };
  const payload: Record<string, unknown> = { from: FROM, to, subject, html };
  if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
  if (unsubUrl) {
    payload.headers = {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { ok: true, retryable: false };
    return {
      ok: false,
      retryable: r.status === 429 || r.status >= 500,
      error: `${r.status} ${(await r.text()).slice(0, 160)}`,
    };
  } catch (e) {
    // Network/DNS wobble — never the recipient's fault, so always retryable.
    return { ok: false, retryable: true, error: String(e).slice(0, 160) };
  }
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

    return json({ claimed: rows.length, sent, failed, requeued, stopped, errors: [...new Set(errors)] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
