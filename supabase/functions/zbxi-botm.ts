// zbxi-botm — settles the Brother of the Month vote that just closed, and opens the next.
//
// WHY THIS EXISTS. The owner asked for an automatic monthly cycle with one condition: if
// nobody gets round to crowning a winner, the site crowns the vote leader itself, breaking
// a dead heat with a coin flip. A feature that silently stalls in a busy month is worse
// than no feature — the homepage would sit on a stale brother with no explanation.
//
// THIS FUNCTION SENDS NOTHING. No email, no queue. It makes two RPC calls and reports.
//
// Auth: cron secret header (x-zbxi-cron) or the admin's JWT. Same gate as the digest.
//   ?dry=1 -> report what it WOULD do (which months are due, who leads, whether it is a
//             tie) and write nothing.
//
// All the judgement lives in the database, deliberately:
//   resolve_botm_cycles() — claim-and-stamp with a RE-CHECK UNDER THE ROW LOCK, so a retry
//     can neither crown twice nor overwrite a winner the owner picked by hand in the gap.
//     Votes for a brother who has since been un-verified or lost his account are ignored.
//     Nobody voted -> nobody is crowned and last month's brother stays up.
//   ensure_botm_cycle() — opens the coming month, ON CONFLICT DO NOTHING, so running this
//     twice in a day is harmless.
// Both are granted to service_role ONLY: settling a chapter-wide award unattended is not
// something a signed-in brother, or the admin in a browser, should be able to reach.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // apikey belongs here: without it the browser preflight fails and every console call
  // dies as "TypeError: Failed to fetch" rather than as a readable error.
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

async function db(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

async function rpc(name: string, body: unknown = {}) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${name} -> ${r.status} ${t.slice(0, 200)}`);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  const cronOk = !!CRON_SECRET && req.headers.get("x-zbxi-cron") === CRON_SECRET;
  if (!cronOk && !(await isAdmin(req.headers.get("Authorization")))) {
    return json({ error: "forbidden" }, 403);
  }

  try {
    // ── ?dry=1 — the rehearsal. Reads only. ──────────────────────────────────────────
    // Reports the same decision the resolver would reach, so the outcome can be inspected
    // before a real month turns over.
    if (dry) {
      const nowIso = new Date().toISOString();
      const due = await db(
        `botm_cycles?winner_brother=is.null&closes_at=lte.${nowIso}` +
        `&select=id,period,closes_at&order=period&limit=12`,
      ) as { id: string; period: string; closes_at: string }[];

      const preview = [];
      for (const c of due) {
        const tally = await db(
          `botm_tally?cycle_id=eq.${c.id}&select=brother_id,votes&order=votes.desc`,
        ) as { brother_id: string; votes: number }[];
        const top = tally.length ? tally[0].votes : 0;
        const tied = tally.filter((t) => t.votes === top);
        preview.push({
          period: c.period,
          closed: c.closes_at,
          total_votes: tally.reduce((n, t) => n + t.votes, 0),
          would_crown: tied.length === 1 ? tied[0].brother_id : null,
          tied_between: tied.length > 1 ? tied.map((t) => t.brother_id) : undefined,
          outcome: !tally.length
            ? "nobody voted — nobody crowned, last month's brother stays up"
            : tied.length > 1
            ? `a ${tied.length}-way tie on ${top} vote(s) — decided by coin flip`
            : `clear leader on ${top} vote(s)`,
        });
      }

      return json({ dry: true, wrote: "nothing", due: due.length, preview });
    }

    // ── The real run ─────────────────────────────────────────────────────────────────
    const resolved = await rpc("resolve_botm_cycles");
    const openedId = await rpc("ensure_botm_cycle");

    return json({
      ok: true,
      resolved: Array.isArray(resolved) ? resolved : [],
      resolved_count: Array.isArray(resolved) ? resolved.length : 0,
      open_cycle: openedId,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
