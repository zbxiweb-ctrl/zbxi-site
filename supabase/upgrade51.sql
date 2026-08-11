-- upgrade51.sql — the daily cap goes 60 → 280, and starts protecting something else.
--
-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  APPLY THIS **LAST**. ORDER IS LOAD-BEARING.                                 ║
-- ║                                                                              ║
-- ║    1. Brevo account + `send.zetabetaxi.com` authenticated in Brevo           ║
-- ║    2. BREVO_API_KEY set in Supabase → Edge Functions → Secrets               ║
-- ║    3. zbxi-drain DEPLOYED with the Brevo sender                              ║
-- ║    4. …then this file.                                                       ║
-- ║                                                                              ║
-- ║  Run it any earlier and the drain that is still live — the one that sends    ║
-- ║  through RESEND — is handed a 280/day allowance against Resend's 100/day      ║
-- ║  account limit. It would burn the whole day in one tick and block every       ║
-- ║  password reset until midnight UTC: precisely the failure the queue and the   ║
-- ║  cap were built to prevent, reintroduced by doing the right steps in the      ║
-- ║  wrong order.                                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- WHY: the monthly digest goes to 113 brothers. Resend allows 100/day for the whole
-- account and Supabase Auth's password resets draw on that same pool (confirmed live:
-- smtp_host = smtp.resend.com), so upgrade35 set a 60/day cap to keep 40 in reserve
-- for auth. The consequence: a digest took TWO DAYS to deliver and consumed the entire
-- non-auth allowance on both. Monthly volume was never the problem — 113 is 4% of
-- Resend's 3,000/month. The DAILY ceiling was the only thing binding.
--
-- WHAT CHANGED OUTSIDE THIS FILE: bulk mail now goes through BREVO (300/day) while
-- Auth keeps Resend (100/day). Two providers, so the two jobs can no longer starve
-- each other. zbxi-drain picks the provider from the BULK_PROVIDER secret.
--
-- ── SO THE CAP NOW MEANS SOMETHING DIFFERENT, AND THAT IS THE POINT OF THIS FILE ──
-- It NO LONGER reserves headroom for password resets — those are on another provider
-- entirely and this number cannot affect them. It now exists to keep us under Brevo's
-- 300/day, because exceeding that does not raise an error a brother would ever see: it
-- silently stops delivering. 280 leaves 20 in hand, deliberately, because the counter
-- charges ATTEMPTS rather than successes (upgrade36) — so retries spend real quota.
--
-- A future maintainer reading "60 reserves 40 for auth" and reasoning from it would
-- reach exactly the wrong conclusions, which is why the body's comments are rewritten
-- here rather than left to drift.
--
-- WHY IT STAYS IN THE DATABASE: unchanged from upgrade35 — a constant in TypeScript is
-- a promise; a default argument on a security definer function only service_role may
-- execute is a property of the system. zbxi-drain still calls this with a batch size
-- only, and lets the database decide how much of it it is allowed to have.
--
-- Everything else about the function is IDENTICAL to upgrade36: the advisory lock, the
-- 3-attempt give-up, counting attempts rather than successes. create or replace demands
-- the whole body, so it is re-emitted verbatim apart from the default and the comments.
--
-- Idempotent: safe to re-run.
-- ROLLBACK: re-run upgrade36.sql (restores the 60 default and the old comments).

create or replace function public.claim_email_batch(
  p_batch_size int default 120,
  p_daily_cap  int default 280
)
returns table (
  queue_id bigint, recipient text, unsub text,
  mail_subject text, mail_html text, mail_attach jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := date_trunc('day', (now() at time zone 'utc')) at time zone 'utc';
  v_used_today int;
  v_limit      int;
begin
  -- (0) Serialise the whole claim. Without this the count below and the claim
  --     further down are two statements in one READ COMMITTED transaction, so
  --     two simultaneous callers each read the same "used today" figure and each
  --     hand out a full batch — the cap quietly doubles. The lock is released
  --     automatically at transaction end; concurrent callers simply queue.
  perform pg_advisory_xact_lock(hashtext('zbxi_email_drain'));

  -- (a) Reclaim anything a crashed or timed-out run left mid-flight -- but GIVE
  --     UP after 3 attempts. Previously a row that could never send (a bad API
  --     key, a rejected address) cycled between 'sending' and 'queued' every 15
  --     minutes for ever, and because the reclaim clears claimed_at it also fell
  --     out of the day's count each time. Rows that hit the ceiling KEEP their
  --     claimed_at so the attempts they already burned stay charged to the day.
  update public.email_queue
     set status     = case when attempts >= 3 then 'failed' else 'queued' end,
         claimed_at = case when attempts >= 3 then claimed_at else null end,
         error      = case when attempts >= 3
                           then coalesce(error, 'stuck in sending; gave up after 3 attempts')
                           else error end
   where status = 'sending'
     and claimed_at < now() - interval '15 minutes';

  -- (b) The cap, counted by ATTEMPTS CLAIMED today -- not by successes. Quota is
  --     spent the moment the provider is called, whether that call succeeds
  --     ('sent'), is rejected ('failed'), or is still in flight ('sending').
  --     This is why 280 and not 300: retries are real spend.
  select count(*) into v_used_today
    from public.email_queue
   where status <> 'queued'
     and claimed_at >= v_day_start;

  v_limit := least(p_batch_size, p_daily_cap - v_used_today);
  if v_limit <= 0 then
    return;                       -- day's allowance spent; stop rather than overrun Brevo
  end if;

  return query
    with cand as (
      select q.id
        from public.email_queue q
       where q.status = 'queued'
       order by q.id                       -- FIFO
       limit v_limit
         for update skip locked
    ),
    claimed as (
      update public.email_queue q
         set status     = 'sending',
             claimed_at = now(),
             attempts   = q.attempts + 1
        from cand
       where q.id = cand.id
      returning q.id, q.batch_id, q.to_email, q.unsub_url
    )
    select c.id, c.to_email, c.unsub_url, b.subject, b.html, b.attachments
      from claimed c
      join public.email_batches b on b.id = c.batch_id
     order by c.id;
end;
$$;

-- Unchanged from upgrade35, restated because create or replace does not carry
-- grants and a silent widening here would hand the send loop to anyone signed in.
revoke all on function public.claim_email_batch(int, int) from public, anon, authenticated;
grant execute on function public.claim_email_batch(int, int) to service_role;

do $$
declare d text; bad text;
begin
  -- (a) The new ceiling is actually in place.
  select pg_get_function_arguments(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_email_batch';
  if d not like '%p_daily_cap integer DEFAULT 280%' then
    raise exception 'claim_email_batch daily cap is not 280: %', d;
  end if;

  -- (b) Nobody but service_role may run the send loop. This is the grant that
  --     keeps the cap meaningful — an authenticated caller who could execute it
  --     could drain the queue at will.
  select string_agg(r, ', ') into bad from (
    select unnest(array['public', 'anon', 'authenticated']) as r
  ) x where has_function_privilege(x.r, 'public.claim_email_batch(int, int)', 'EXECUTE');
  if bad is not null then
    raise exception 'claim_email_batch is executable by %; only service_role may run it', bad;
  end if;

  -- (c) The two fixes from upgrade36 survived the re-emit. Both were found by
  --     testing rather than reading, and both are invisible when broken: without
  --     the lock two runs double the cap, and counting 'sent' instead of attempts
  --     lets an overlapping run claim a fresh full batch.
  d := pg_get_functiondef('public.claim_email_batch(int, int)'::regprocedure);
  if d not like '%pg_advisory_xact_lock%' then
    raise exception 'the advisory lock is gone; two concurrent drains would each get a full batch';
  end if;
  if d not like '%status <> ''queued''%' then
    raise exception 'the cap is no longer counting attempts; in-flight rows would score zero';
  end if;
end $$;

notify pgrst, 'reload schema';
