// zbxi-event-reminder — one email, a few days before an event, to the brothers who said
// they were coming (and, when the event asks for it, to everyone we can reach).
//
// WHY THIS EXISTS. An event that appeared in the monthly digest three weeks early gets no
// second mention before it happens. The calendar knows who RSVP'd and never tells them
// anything. This is the difference between a calendar and a turnout tool.
//
// Auth: cron secret header (x-zbxi-cron) or the admin's JWT. Same gate as the digest.
//   ?dry=1  -> claim NOTHING, render a sample from a fabricated event, send nothing.
//   ?peek=1 -> report which events are due and how many recipients. Claims nothing.
//
// claim_event_reminders() (upgrade63) stamps reminded_at in the same statement that returns
// the rows, so a crash costs one event's reminder rather than re-sending it every day until
// the event happens. It also drops opt-outs, brothers with no address, events already
// reminded, and — unless the event has remind_all ticked — everyone who did not RSVP. All of
// that is enforced in the database, not here.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SITE = "https://zetabetaxi.com";

// The literal the drainer swaps for each brother's own unsubscribe URL.
const UNSUB_MARK = "{{UNSUB}}";

type Claim = {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  description: string | null;
  to_email: string;
  to_name: string;
  unsub_token: string | null;
  rsvped: boolean;
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

/* ---- when it is -----------------------------------------------------------------
   A local copy of the digest's formatter, deliberately: edge functions here are single
   files and cannot import from each other, and the browser's copy lives in
   event-when.js. All three compare CALENDAR DAYS in chapter-local time rather than raw
   timestamps, so a 6pm-2am social is one line and a 13-day reunion is a range. */
const nyDay = (s: string) => new Date(s).toLocaleDateString("en-US", { timeZone: "America/New_York" });
function fmtDate(s: string, allDay: boolean): string {
  const d = new Date(s);
  const day = d.toLocaleDateString("en-US",
    { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
  if (allDay) return day;
  return `${day} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`;
}
function fmtWhen(e: { starts_at: string; ends_at: string | null; all_day: boolean }): string {
  const start = fmtDate(e.starts_at, e.all_day);
  if (!e.ends_at || nyDay(e.ends_at) === nyDay(e.starts_at)) return start;
  return `${start} – ${fmtDate(e.ends_at, e.all_day)}`;
}
// The weekday, not "in 3 days". The claim window is deliberately wide (upgrade63), so an
// event can be claimed two or three days out — and a subject line that says "3 days" when
// it is two is the kind of small wrongness that teaches people to stop reading these.
const weekdayOf = (s: string) =>
  new Date(s).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });

/* ---- the email ------------------------------------------------------------------
   Same shell as the digest and the notification mailer: table layout, inline styles, a
   navy bar and the cream card. width="100%" plus max-width because the HTML attribute is
   what Outlook obeys and the CSS is what everything else does. */
function shell(heading: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3efe4;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBF8F1;border-radius:14px;border:1px solid #e3d9bd;overflow:hidden">
    <tr><td style="background:#0A1F44;padding:22px 26px;text-align:center">
      <div style="font:700 20px Georgia,serif;color:#E8C766;letter-spacing:.03em">${heading}</div></td></tr>
    <tr><td style="padding:24px 26px;font:400 15px/1.7 Helvetica,Arial,sans-serif;color:#3d4657">
      ${inner}
    </td></tr>
    <tr><td style="padding:0 26px 22px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:#8a8171;text-align:center">
      Zeta Beta Xi · SUNY Geneseo · Est. 1993<br>
      <a href="${UNSUB_MARK}" style="color:#8a8171">Unsubscribe from brotherhood email</a>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="text-align:center;margin:24px 0 4px">
    <a href="${href}" style="background:#C8A24B;color:#0A1F44;text-decoration:none;font:700 14px Helvetica,Arial;padding:11px 24px;border-radius:999px;display:inline-block">${label}</a></p>`;
}

// One body per (event, rsvped) pair, NOT one per recipient: the only thing that differs
// between two brothers going to the same event is whether they said so. That is exactly
// what the batch/queue split is for — one stored body, many recipients.
function render(e: Claim, rsvped: boolean): { subject: string; html: string } {
  const when = fmtWhen(e);
  const where = e.location
    ? `<p style="margin:0 0 12px">📍 <a href="https://maps.google.com/?q=${encodeURIComponent(e.location)}" style="color:#7d5f1e">${esc(e.location)}</a></p>`
    : "";
  const note = e.description
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0">
         <tr><td style="border-left:3px solid #C8A24B;padding:6px 14px;color:#4a5264">${esc(e.description)}</td></tr>
       </table>`
    : "";
  const line = rsvped
    ? `<p style="margin:0 0 12px">You said you're going — this is just so it doesn't sneak up on you.</p>`
    : `<p style="margin:0 0 12px">You haven't said whether you're coming. If you are, tap below so the brothers running it know how many to expect.</p>`;

  return {
    subject: `${weekdayOf(e.starts_at)}: ${e.title}`,
    html: shell(
      rsvped ? "Coming up this week" : "Coming up — will we see you?",
      `<p style="margin:0 0 12px"><b style="font-size:17px">${esc(e.title)}</b></p>
       <p style="margin:0 0 6px">🗓️ ${esc(when)}</p>
       ${where}${note}${line}
       ${button(`${SITE}/events.html`, rsvped ? "See the calendar →" : "RSVP on the calendar →")}`,
    ),
  };
}

/* ---- queue it -------------------------------------------------------------------
   One batch per body, every recipient of that body in its queue rows. zbxi-drain releases
   them at the cap claim_email_batch() enforces, so a Reunion all-hands cannot outrun the
   daily budget. */
async function enqueue(subject: string, html: string,
                       list: { email: string; unsub: string | null }[]) {
  const batch = await db(`email_batches`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ kind: "reminder", subject, html, created_by: "zbxi-event-reminder" }),
  });
  await db(`email_queue`, {
    method: "POST",
    body: JSON.stringify(list.map((r) => ({ batch_id: batch[0].id, to_email: r.email, unsub_url: r.unsub }))),
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
// and the caller sees "TypeError: Failed to fetch" with no clue why. Both zbxi-digest and
// zbxi-notify-mail record hitting exactly this.
// `apikey` is in the list because every Supabase browser client sends it alongside the
// bearer token, and a preflight fails on ANY requested header the server does not name —
// which surfaces as a bare "TypeError: Failed to fetch" with no mention of the header. Hit
// exactly that testing this function from the console; zbxi-notify-mail's list has the same
// gap but is only ever called by cron, so it is left alone rather than changed blind.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-zbxi-cron",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const peek = url.searchParams.get("peek") === "1";

  const cronOk = !!CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  if (!cronOk && !(await isAdmin(req.headers.get("Authorization")))) {
    return json({ error: "forbidden" }, 403);
  }

  // ?peek — what is due, claiming nothing. Safe to hit any time.
  //
  // Bounded by the SAME window the claim uses. Without the upper bound it counted every
  // future unreminded event — an event three months out reported as "due" — and this is the
  // endpoint you'd check before deciding whether it is safe to trigger a send by hand. A
  // diagnostic that over-reports is worse than none.
  if (peek) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 3.5 * 86400000);
    const rows = await db(
      `events?reminded_at=is.null&starts_at=gt.${now.toISOString()}` +
      `&starts_at=lte.${cutoff.toISOString()}&select=id,title,starts_at,remind_all&order=starts_at&limit=5`,
    );
    return json({ due: rows.length, rows });
  }

  // ?dry — render a fabricated example. Claims nothing, sends nothing, touches nobody.
  if (dry) {
    const sample: Claim = {
      event_id: "00000000-0000-0000-0000-000000000000",
      title: "Reunion Weekend",
      starts_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      ends_at: null,
      all_day: false,
      location: "MacVittie Union, Geneseo",
      description: "Doors at 6. Bring the family — there's food.",
      to_email: "nobody@example.invalid",
      to_name: "Daniel Okafor",
      unsub_token: null,
      rsvped: url.searchParams.get("rsvped") !== "0",
    };
    const out = render(sample, sample.rsvped);
    return new Response(out.html, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
  }

  const claimed: Claim[] = await db(`rpc/claim_event_reminders`, { method: "POST", body: "{}" });

  // Group by (event, rsvped): one stored body per group, one queue row per brother.
  const groups = new Map<string, { e: Claim; rsvped: boolean; list: { email: string; unsub: string | null }[] }>();
  for (const c of claimed) {
    const key = `${c.event_id}:${c.rsvped ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { e: c, rsvped: c.rsvped, list: [] });
    groups.get(key)!.list.push({
      email: c.to_email,
      // The SAME endpoint the digest and the notification mailer use — a function, not a
      // site page. There is no unsubscribe.html to point at.
      unsub: c.unsub_token
        ? `${SB}/functions/v1/zbxi-unsubscribe?t=${encodeURIComponent(c.unsub_token)}`
        : null,
    });
  }

  let queued = 0;
  const problems: string[] = [];
  for (const g of groups.values()) {
    try {
      const { subject, html } = render(g.e, g.rsvped);
      await enqueue(subject, html, g.list);
      queued += g.list.length;
    } catch (err) {
      // The event is already stamped, so this group is lost rather than repeated. Say so
      // loudly in the response instead of failing the whole run — one bad group must not
      // block the rest.
      problems.push(`${g.e.event_id} (rsvped=${g.rsvped}): ${String(err).slice(0, 120)}`);
    }
  }

  return json({ claimed: claimed.length, groups: groups.size, queued, problems });
});
