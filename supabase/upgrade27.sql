-- upgrade27.sql — Email the admin when a brother is waiting for approval.
--
-- Why: the ONLY signal that someone needs approving was the bell on the site, so
-- the admin had to remember to go look. tg_notify_status() (upgrade14) already
-- writes that bell notification; this adds the email path beside it, and does NOT
-- touch that trigger.
--
-- How: a 5-minute pg_cron job calls the `zbxi-pending` edge function, which calls
-- claim_pending_alerts() below. The UPDATE ... RETURNING inside the CTE *atomically
-- claims* the un-alerted pending rows, so two overlapping runs can never email the
-- same brother twice, and a burst of signups naturally collapses into ONE summary.
--
-- Why the auth.users join lives HERE and not in the edge function: the existing
-- admin_pending_emails() is is_admin()-gated, and a service-role call carries no JWT
-- => is_admin() is false => it returns nothing. A security-definer function runs as
-- owner and can read auth.users directly. Note also that brothers.created_at is the
-- bulk roster-import stamp for claimed rows — the REAL signup time is
-- auth.users.created_at, which is what the email must show (same lesson as upgrade24).
--
-- NOTE: the pg_cron job is created OUT OF BAND, not in this file, because its
-- net.http_post command embeds CRON_SECRET and this repo is PUBLIC. Mirror the
-- existing `zbxi-monthly-digest` job; schedule '*/5 * * * *', job name
-- 'zbxi-pending-alert'.
--
-- Rollback:
--   select cron.unschedule('zbxi-pending-alert');
--   drop function if exists public.claim_pending_alerts();
--   alter table public.brothers drop column if exists pending_alert_at;

begin;

-- 1) "We have already emailed about this pending brother."
alter table public.brothers
  add column if not exists pending_alert_at timestamptz;

-- 2) Atomically claim every pending brother we have not emailed about yet.
--    Data-modifying CTE + SELECT so RETURN QUERY gets a plain result set.
--    Output names are deliberately distinct from the table's column names to avoid
--    plpgsql RETURNS TABLE / column ambiguity.
create or replace function public.claim_pending_alerts()
returns table (
  brother_id    uuid,
  brother_name  text,
  brother_class text,
  login_email   text,
  signed_up     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    with claimed as (
      update public.brothers b
         set pending_alert_at = now()
       where b.status = 'pending'
         and b.pending_alert_at is null
      returning b.id, b.full_name, b.pledge_class, b.user_id
    )
    select c.id,
           c.full_name,
           c.pledge_class,
           u.email::text,          -- auth.users.email is varchar(255); cast (see upgrade24)
           u.created_at            -- the REAL signup time
      from claimed c
      left join auth.users u on u.id = c.user_id;   -- left: an admin-created pending row has no account
end;
$$;

-- 3) Service-role ONLY. This claims rows and reads auth.users — no brother, and no
--    anonymous visitor, may ever call it. (create function grants EXECUTE to public
--    by default, so the revoke is load-bearing.)
revoke all on function public.claim_pending_alerts() from public;
revoke all on function public.claim_pending_alerts() from anon;
revoke all on function public.claim_pending_alerts() from authenticated;
grant execute on function public.claim_pending_alerts() to service_role;

-- 4) Backfill guard: stamp the CURRENT queue as already-alerted, so switching this
--    on does not immediately email about brothers who have been waiting for days.
update public.brothers
   set pending_alert_at = now()
 where status = 'pending'
   and pending_alert_at is null;

commit;
