-- upgrade36.sql — security review follow-up to upgrade35.
--
-- Findings from the 2026-08-04 review of the email queue. upgrade35 is left as
-- shipped rather than edited, because it has already been applied to production
-- and these files are the log of what was actually run.
--
-- (1) HIGH — invite claim links were readable by a non-admin officer.
--     upgrade35 gave the `email.send` officer seat SELECT on email_batches so a
--     console progress bar could poll it. But zbxi-invite stores the FULL
--     rendered invite email there, and that email contains ?invite=<token> — a
--     single-use credential that lets the holder create the account for that
--     address and choose its password (zbxi-claim.ts creates the user with
--     email_confirm: true). The `invites` table itself is admin-only, so this
--     was a brand-new way to reach those tokens, not a restatement of existing
--     access. An officer could have claimed a brother's account before he did.
--
-- (2) HIGH — every brother's email address was exposed to that same seat.
--     email_queue.to_email holds all 100 recipients. 70 of those brothers have
--     deliberately left 'email' out of contact_prefs, so roster_detail hides
--     their address; queueing a single digest would have handed all 100 to the
--     officer seat and quietly undone a privacy choice 70 people made.
--
--     Both fixes are the same statement: admin-only reads. The officer read was
--     DEAD CODE — nothing in assets/ or *.html queries either table — so this
--     costs no functionality. If a progress indicator is ever wanted, add a
--     security-definer function returning COUNTS, never rows.
--
-- (3) MEDIUM — the 60/day cap was not race-proof. The count and the claim are
--     two statements; two overlapping drains could each read "20 used" and each
--     take another 20. FOR UPDATE SKIP LOCKED stops two runs claiming the same
--     ROW, but not two runs claiming two different full batches off one stale
--     count. The cron alone would never hit it, but zbxi-drain is reachable over
--     HTTP with no rate limit. upgrade35's own header claims the cap is "a
--     property of the system, not a promise" — this is what makes that true.
--
-- (4) MEDIUM — nothing ever gave up. A row stuck in 'sending' was requeued
--     forever every 15 minutes, and `attempts` was incremented but never read.
--     With a bad RESEND_API_KEY the queue would have retried silently for ever.
--
-- (9) INFO — the daily-cap index no longer matched the query it was built for.
--
-- Rollback:
--   -- restore upgrade35's wider read (NOT recommended — see 1 and 2):
--   -- drop policy email_batches_admin_read on public.email_batches;
--   -- create policy email_batches_staff_read on public.email_batches
--   --   for select to authenticated using (is_admin() or officer_can('email.send'));
--   -- (same shape for email_queue), then re-grant select to authenticated.
--   -- claim_email_batch: re-apply upgrade35.sql, which is idempotent.

begin;

-- 1 + 2) Admin-only reads. Two layers, deliberately: the policy narrows to the
--        admin, and the grant is removed so `authenticated` cannot reach the
--        table at all even if a future policy is added carelessly.
drop policy if exists email_batches_staff_read on public.email_batches;
drop policy if exists email_queue_staff_read   on public.email_queue;

create policy email_batches_admin_read on public.email_batches
  for select to authenticated using (is_admin());

create policy email_queue_admin_read on public.email_queue
  for select to authenticated using (is_admin());

revoke select on public.email_batches from authenticated;
revoke select on public.email_queue   from authenticated;

-- 9) Index the column the cap actually filters on. The old partial index on
--    (sent_at) where status='sent' could not serve `status <> 'queued'`.
drop index if exists public.email_queue_sent_idx;
create index if not exists email_queue_used_idx
  on public.email_queue (claimed_at) where status <> 'queued';

-- 3 + 4) Re-declare the claim function with a serialising lock and a give-up rule.
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
  v_day_start timestamptz := date_trunc('day', (now() at time zone 'utc')) at time zone 'utc';
  v_used_today int;
  v_limit      int;
begin
  -- (0) Serialise the whole claim. Without this the count below and the claim
  --     further down are two statements in one READ COMMITTED transaction, so
  --     two simultaneous callers each read the same "used today" figure and each
  --     hand out a full batch — 60/day quietly becomes 120. The lock is released
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
  --     spent the moment we call Resend, whether that call succeeds ('sent'), is
  --     rejected ('failed'), or is still in flight ('sending').
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

revoke all on function public.claim_email_batch(int, int) from public;
revoke all on function public.claim_email_batch(int, int) from anon;
revoke all on function public.claim_email_batch(int, int) from authenticated;
grant execute on function public.claim_email_batch(int, int) to service_role;

-- 7) Drop attachment payloads as soon as a batch has finished draining. A
--    composer send may carry 4 MB of base64; before the queue that data was
--    transient, and it should not linger in the database or in every backup for
--    90 days just because it now passes through a table. The message body is
--    small and is kept for the existing retention window.
create or replace function public.prune_old_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications  where created_at < now() - interval '90 days';
  delete from public.activity_log   where created_at < now() - interval '365 days';

  update public.email_batches b
     set attachments = null
   where b.attachments is not null
     and not exists (select 1 from public.email_queue q
                      where q.batch_id = b.id and q.status in ('queued', 'sending'));

  delete from public.email_batches  where created_at < now() - interval '90 days';
$$;

revoke all on function public.prune_old_logs() from public, anon, authenticated;

commit;
