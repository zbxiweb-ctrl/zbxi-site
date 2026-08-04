-- upgrade35.sql — One outbound queue for every NON-AUTH email, with the daily
-- cap enforced in the database.
--
-- Why: password resets, signup confirmations and the monthly digest all leave
-- through the same Resend account, and that account sends 100 emails per DAY.
-- One newsletter to the roster therefore consumes the entire day's allowance and
-- a brother who needs a password reset that evening silently gets nothing —
-- which is exactly what appears to have happened on 2026-08-01.
--
-- How: digest / composer / invites stop calling Resend in a loop and instead
-- INSERT one email_queue row per recipient. A 15-minute cron drains the queue
-- through claim_email_batch(), which refuses to hand out more than p_daily_cap
-- (default 60) sends per UTC day. That permanently reserves >= 40/day for
-- Supabase Auth, which nothing in this codebase can consume.
--
-- The cap lives HERE, not in the edge function, deliberately. A constant in
-- TypeScript is a promise; a default argument on a security-definer function that
-- only service_role may execute is a property of the system. A future maintainer
-- who edits the drainer cannot raise it by accident.
--
-- Two tables, not one, because the composer permits 4 MB of attachments: stored
-- per recipient that would be ~1.4 GB for a 350-brother send. The body lives once
-- on email_batches with {{UNSUB}} as the per-recipient slot; email_queue holds
-- only the address and that brother's unsubscribe URL.
--
-- NOTE: the pg_cron job is created OUT OF BAND, not in this file, because its
-- net.http_post command embeds CRON_SECRET and this repo is PUBLIC. Mirror the
-- existing 'zbxi-pending-alert' job; schedule '*/15 * * * *', job name
-- 'zbxi-email-drain', calling the zbxi-drain function.
--
-- Rollback:
--   select cron.unschedule('zbxi-email-drain');
--   drop function if exists public.claim_email_batch(int, int);
--   drop table if exists public.email_queue;
--   drop table if exists public.email_batches;
--   -- and re-create prune_old_logs() without its email_batches line (upgrade32).

begin;

-- 1) The message, stored ONCE per send.
create table if not exists public.email_batches (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'compose'
              check (kind in ('digest', 'compose', 'invite')),
  subject     text not null,
  -- Fully rendered HTML containing the literal marker {{UNSUB}} wherever this
  -- recipient's unsubscribe URL belongs. The drainer substitutes per row.
  html        text not null,
  -- Resend's attachments array verbatim, or null. On the batch, never the row.
  attachments jsonb,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- 2) One row per recipient.
create table if not exists public.email_queue (
  id         bigint generated always as identity primary key,
  batch_id   uuid not null references public.email_batches(id) on delete cascade,
  to_email   text not null,
  -- Null for transactional mail (invites) that carries no unsubscribe footer.
  unsub_url  text,
  status     text not null default 'queued'
             check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts   int  not null default 0,
  claimed_at timestamptz,
  sent_at    timestamptz,
  error      text,
  created_at timestamptz not null default now()
);

-- Partial indexes: the claim only ever scans 'queued', and the daily-cap count
-- only ever scans 'sent'. Both stay small even when the table does not.
create index if not exists email_queue_claim_idx on public.email_queue (id)       where status = 'queued';
create index if not exists email_queue_sent_idx  on public.email_queue (sent_at)  where status = 'sent';
create index if not exists email_queue_batch_idx on public.email_queue (batch_id);

-- 3) Atomically claim the next slice of the queue, capped for the UTC day.
--    Same shape as claim_pending_alerts() (upgrade27): SELECT ... FOR UPDATE SKIP
--    LOCKED picks the rows, a data-modifying CTE flips them to 'sending' in the
--    same statement. Two overlapping cron runs therefore physically cannot hand
--    the same recipient to two senders.
--
--    Output names are deliberately distinct from the tables' column names to
--    avoid plpgsql RETURNS TABLE / column ambiguity (same trap as upgrade27).
create or replace function public.claim_email_batch(
  p_batch_size int default 20,
  p_daily_cap  int default 60
)
returns table (
  queue_id     bigint,
  recipient    text,
  unsub        text,
  mail_subject text,
  mail_html    text,
  mail_attach  jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Midnight UTC today. Resend's quota day is UTC, so ours must be too --
  -- counting from local midnight would let a late-evening blast borrow against
  -- tomorrow's allowance and starve auth mail overnight.
  v_day_start timestamptz := date_trunc('day', (now() at time zone 'utc')) at time zone 'utc';
  v_used_today int;
  v_limit      int;
begin
  -- (a) Reclaim anything a crashed or timed-out run left mid-flight. Without
  --     this a single failed invocation strands those rows in 'sending' forever.
  update public.email_queue
     set status = 'queued', claimed_at = null
   where status = 'sending'
     and claimed_at < now() - interval '15 minutes';

  -- (b) The cap, counted by ATTEMPTS CLAIMED today -- not by successes.
  --     Quota is spent the moment we call Resend, whether that call succeeds
  --     ('sent'), is rejected ('failed'), or is still in flight ('sending').
  --     Counting only 'sent' was a real bug caught in testing: rows still in
  --     flight scored zero, so a second run overlapping the first handed out a
  --     fresh full batch and sailed straight past the cap -- defeating the
  --     entire point of this file. Reclaimed rows reset claimed_at to null and
  --     legitimately drop out of the count, since they are about to be retried.
  select count(*) into v_used_today
    from public.email_queue
   where status <> 'queued'
     and claimed_at >= v_day_start;

  v_limit := least(p_batch_size, p_daily_cap - v_used_today);
  if v_limit <= 0 then
    return;                       -- day's allowance spent; auth mail keeps the rest
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

-- 4) Service-role ONLY. This claims work and returns every recipient's address.
--    (create function grants EXECUTE to public by default, so the revoke is
--    load-bearing, not decoration.)
revoke all on function public.claim_email_batch(int, int) from public;
revoke all on function public.claim_email_batch(int, int) from anon;
revoke all on function public.claim_email_batch(int, int) from authenticated;
grant execute on function public.claim_email_batch(int, int) to service_role;

-- 5) RLS. email_queue.to_email is every brother's email address, so this is the
--    security boundary of the whole change.
--
--    Supabase's default privileges grant new public-schema tables to anon and
--    authenticated, and `revoke ... from public` does NOT reach those two roles
--    (they hold their own grants) -- so both revokes below are required.
alter table public.email_batches enable row level security;
alter table public.email_queue   enable row level security;

revoke all on public.email_batches from anon;
revoke all on public.email_batches from authenticated;
revoke all on public.email_queue   from anon;
revoke all on public.email_queue   from authenticated;

-- Read-only, and only for staff: the console needs it to poll "how far along is
-- this send". anon gets nothing at all. There is deliberately NO insert/update/
-- delete policy for ANY role -- RLS with no matching policy is a deny, so writes
-- are reachable only by service_role, which bypasses RLS entirely.
grant select on public.email_batches to authenticated;
grant select on public.email_queue   to authenticated;

drop policy if exists email_batches_staff_read on public.email_batches;
create policy email_batches_staff_read on public.email_batches
  for select to authenticated
  using (is_admin() or officer_can('email.send'));

drop policy if exists email_queue_staff_read on public.email_queue;
create policy email_queue_staff_read on public.email_queue
  for select to authenticated
  using (is_admin() or officer_can('email.send'));

-- 6) Housekeeping. Extends upgrade32's weekly job; the ON DELETE CASCADE on
--    email_queue.batch_id clears the recipient rows with the batch. 90 days is
--    far past any drain: even a 350-brother send finishes in 6 days at 60/day.
create or replace function public.prune_old_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications  where created_at < now() - interval '90 days';
  delete from public.activity_log   where created_at < now() - interval '365 days';
  delete from public.email_batches  where created_at < now() - interval '90 days';
$$;

revoke all on function public.prune_old_logs() from public, anon, authenticated;

commit;
