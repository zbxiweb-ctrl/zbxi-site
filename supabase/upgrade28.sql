-- upgrade28.sql — Add "claimed a roster entry vs created a new profile" to the
-- admin approval email.
--
-- Why: the alert email said only "someone is waiting", so the admin still had to open
-- the console to judge whether it was routine. `roster_name` already answers the single
-- highest-signal question for free: a brother who CLAIMED a chapter-record row is
-- almost certainly legitimate, while a SELF-CREATED profile is the one worth checking
-- against the roster. Verified on live data: 352/359 have roster_name set, only 7 are
-- self-created — so the warning stays rare, and rare is what makes it worth reading.
--
-- Deliberately NOT porting the console's fuzzy name-match (pendingNameFlag) here: that
-- logic lives in browser JS, and a second copy would drift. An email that says "routine"
-- while the console shows 🚩 would be worse than no flag. This one field needs no
-- duplicated logic and cannot drift.
--
-- A RETURNS TABLE signature cannot be changed by create-or-replace, so drop first, then
-- recreate (same lesson as upgrade24).
--
-- Rollback: re-run upgrade27.sql (the five-column version).

begin;

drop function if exists public.claim_pending_alerts();

create function public.claim_pending_alerts()
returns table (
  brother_id    uuid,
  brother_name  text,
  brother_class text,
  login_email   text,
  signed_up     timestamptz,
  claimed       boolean          -- true = matched himself to a chapter-record row
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    with claimed_rows as (
      update public.brothers b
         set pending_alert_at = now()
       where b.status = 'pending'
         and b.pending_alert_at is null
      returning b.id, b.full_name, b.pledge_class, b.user_id, b.roster_name
    )
    select c.id,
           c.full_name,
           c.pledge_class,
           u.email::text,               -- varchar(255) -> text (see upgrade24)
           u.created_at,                -- the REAL signup time, not the import stamp
           (c.roster_name is not null)  -- claimed an existing roster entry?
      from claimed_rows c
      left join auth.users u on u.id = c.user_id;
end;
$$;

-- Service-role ONLY, exactly as upgrade27 (the drop above discarded the old grants,
-- and create function re-grants EXECUTE to public by default — so this is load-bearing).
revoke all on function public.claim_pending_alerts() from public;
revoke all on function public.claim_pending_alerts() from anon;
revoke all on function public.claim_pending_alerts() from authenticated;
grant execute on function public.claim_pending_alerts() to service_role;

commit;
