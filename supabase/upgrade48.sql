-- ============================================================================
-- upgrade48 — the "brother awaiting approval" email goes to whoever can
--             actually approve, not just the admin.
--
-- zbxi-pending.ts already does the hard part: a 5-minute pg_cron job,
-- claim_pending_alerts() (upgrade27) for atomic de-duplication and burst
-- protection, and a quiet path when nothing is waiting. Its one limitation was
-- the recipient list: adminEmail(), a single address. Joe Occhino holds
-- members.approve and can clear the queue, but had no idea when there was one.
--
-- This adds ONE read-only function that answers "who should be told?", and the
-- edge function reads it instead of hardcoding the admin.
--
-- WHY A DEFINER FUNCTION AND NOT A VIEW OR A POLICY: it returns EMAIL
-- ADDRESSES, joined out of auth.users. That is exactly the kind of thing this
-- workspace has been burned by handing to a policy before (upgrade47: an RLS
-- SELECT policy is ROW-level and cannot hide a column, so `invites.token` went
-- out with it). So: a narrow verb, executable by service_role ONLY, with the
-- grants asserted at the bottom of this file.
--
-- The seat derivation below mirrors my_officer_seat() rather than restating it
-- loosely — President + alumni => alumni_president. If that mapping ever gains
-- a second seat, both must change together, so it is written the same way.
-- ============================================================================

create or replace function public.pending_alert_recipients()
returns table (email text, label text)
language sql
stable
security definer
set search_path = public
as $$
  -- The site administrator, always.
  select public.admin_email() as email, 'Site administrator'::text as label

  union

  -- Everyone whose officer seat carries members.approve. Being told to clear a
  -- queue you cannot act on is noise, so the permission — not the title — is
  -- what decides. NOTE the join: when the CASE yields NULL (an ordinary
  -- brother), `g.seat = null` is never true, so he is excluded. NULL-means-no-
  -- match is the fail-safe direction here and is deliberate.
  select lower(u.email), b.full_name
    from public.brothers b
    join auth.users u on u.id = b.user_id
    join public.officer_grants g
      on g.seat = case when b.role = 'President' and b.role_scope = 'alumni'
                       then 'alumni_president' end
   where b.status = 'verified'
     and g.permission = 'members.approve'
     and g.enabled
     and u.email is not null
     -- An unconfirmed address is a bounce waiting to happen.
     and u.email_confirmed_at is not null
     -- SUPPRESSED — the owner's personal brother account was promoted to a
     -- SECOND, temporary alumni_president seat on 2026-07-24 so he could test
     -- the officer console. It is a real seat, so it would really receive these.
     -- Suppressed by user_id, not email: this repo is public and a uuid is not
     -- personal data.
     -- DELETE THIS LINE when that test seat is reverted (see the revert SQL in
     -- project-johnathan-test-seat). Leaving it in breaks nothing — it simply
     -- stops matching anyone — but it should not outlive the seat.
     and b.user_id <> '14734357-7b21-4a38-ae55-6d52e842cdbf'::uuid
$$;

-- Locked to the service role. anon is named EXPLICITLY: Supabase's default
-- privileges grant it EXECUTE, and `revoke ... from public` does NOT remove an
-- explicit grant (learned the hard way in upgrade45).
revoke all on function public.pending_alert_recipients() from public, anon, authenticated;
grant execute on function public.pending_alert_recipients() to service_role;

-- ---------------------------------------------------------------------------
-- Assertions. This function hands out email addresses, so the grants are the
-- thing that matters and they get checked, not assumed.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  bad text;
begin
  -- 1. Neither anon nor authenticated may execute it.
  select string_agg(g, ', ') into bad
    from (select unnest(array['anon','authenticated']) as g) r
   where has_function_privilege(r.g, 'public.pending_alert_recipients()', 'EXECUTE');
  if bad is not null then
    raise exception 'pending_alert_recipients must not be executable by %', bad;
  end if;

  -- 2. service_role must be able to execute it, or the alert silently stops.
  if not has_function_privilege('service_role', 'public.pending_alert_recipients()', 'EXECUTE') then
    raise exception 'service_role cannot execute pending_alert_recipients';
  end if;

  -- 3. It must never return the suppressed test account.
  select count(*) into n
    from public.pending_alert_recipients()
   where email = (select lower(u.email) from auth.users u
                   where u.id = '14734357-7b21-4a38-ae55-6d52e842cdbf'::uuid);
  if n > 0 then
    raise exception 'the suppressed test account is still in the recipient list';
  end if;

  -- 4. Sanity: the admin is always in the list.
  select count(*) into n from public.pending_alert_recipients()
   where email = public.admin_email();
  if n <> 1 then
    raise exception 'admin_email is not in the recipient list exactly once (got %)', n;
  end if;

  raise notice 'upgrade48 ok — % recipient(s)', (select count(*) from public.pending_alert_recipients());
end $$;

notify pgrst, 'reload schema';
