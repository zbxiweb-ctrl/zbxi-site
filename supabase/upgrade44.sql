-- ============================================================================
-- upgrade44 — the Alumni Presidents may APPROVE brothers; the Active President
--             seat is retired from the Officer Console.
--
-- Until now, clearing the signup queue was the webmaster's alone: a brother who
-- signed up saw nothing until the admin personally flipped him to 'verified'.
-- This hands that one job to the Alumni Presidents (Johnathan Conway and Joseph
-- Occhino both hold the seat; grants are per SEAT, so one switch covers both and
-- any future holder).
--
-- TWO gates stood in the way, and one of them fails SILENTLY:
--   * RLS   — brothers_admin_update is `using (is_admin())` (upgrade14). An
--             officer may only update his OWN row.
--   * TRIGGER — tg_guard_status (upgrade37) does `new.status := old.status` for
--             every non-admin. No error. The UPDATE reports success and changes
--             nothing. Fixing only the RLS would ship an Approve button that
--             looks like it works and doesn't.
--
-- upgrade17 states an invariant worth keeping: "No dangerous table ever
-- references officer_can, so there is no code path to one." `brothers` IS the
-- dangerous table — status, titles, account linkage. So the RLS policy is NOT
-- widened here: brothers_admin_update has no WITH CHECK, and adding
-- `or officer_can(...)` to it would let an officer rewrite EVERY column of EVERY
-- brother's row. Instead the officer gets ONE security-definer verb — flip a
-- PENDING row to verified or rejected — and no other reach into the table. The
-- invariant is narrowed, not broken.
--
-- ⚠ `zbxi.bypass` is tg_guard_status's escape hatch. Any function that sets it
--   has unrestricted write access to `brothers` for the rest of that
--   transaction. decide_pending_brother() sets it for exactly one UPDATE and
--   clears it immediately. Do not copy the pattern without that discipline.
--
-- ROLLBACK (each part independent):
--   a) officers lose approval, functions stay harmless:
--        update public.officer_grants set enabled = false
--         where seat='alumni_president' and permission='members.approve';
--   b) restore the Active President seat:
--        -- re-add the `role_scope = 'active' then 'active_president'` branch to
--        -- my_officer_seat() (its pre-upgrade44 body is quoted in section 4)
--        insert into public.officer_grants (seat, permission, enabled)
--        values ('active_president','events.manage',false) on conflict do nothing;
--   c) drop the new surface entirely:
--        drop function public.decide_pending_brother(uuid, text);
--        drop function public.pending_queue();
--        drop function public.name_key(text);
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) name_key — one normalisation, used by the roster cross-check below.
--    Deliberately a NORMALISED EXACT match, not the fuzzy edit-distance matcher
--    in admin.js (looksLikeSame). It catches "not on the chapter roster at all"
--    and the obvious duplicate; near-misses stay the admin's call, where the
--    better tool lives.
-- ---------------------------------------------------------------------------
create or replace function public.name_key(s text)
returns text
language sql
immutable
set search_path = public
as $$ select lower(regexp_replace(coalesce(s, ''), '[^a-zA-Z]', '', 'g')) $$;

-- No grant: the only caller is pending_queue(), which is SECURITY DEFINER and
-- therefore runs this as the owner. Nothing in the browser calls it.
revoke execute on function public.name_key(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) pending_queue — an officer cannot SEE a pending brother at all today.
--    Verified against pg_policies on the live database, not inferred: the ONLY
--    SELECT policies left on brothers are brothers_admin_read (is_admin()) and
--    brothers_own_read (auth.uid() = user_id). brothers_public_read was dropped
--    back in upgrade.sql and brothers_brother_read in upgrade26; neither was
--    recreated. So a signed-in brother reads his own row and nothing else.
--
--    Widening that read policy is the wrong instrument — the client reads
--    brothers with select('*'), so a widened policy hands officers every column
--    of every brother (phone, email, contact_prefs...). A definer function
--    returns exactly the seven vetting fields and nothing else.
--
--    OUT parameters are prefixed b_ on purpose: plpgsql resolves a bare `id` or
--    `full_name` ambiguously against the table columns (same reason upgrade23
--    named its columns uid/login_email).
-- ---------------------------------------------------------------------------
create or replace function public.pending_queue()
returns table (
  b_id        uuid,
  b_name      text,
  b_class     text,
  b_claimed   boolean,   -- true = matched himself to an existing roster entry
  b_email     text,      -- the address he signed up with, for vetting
  b_signed_up timestamptz,
  b_flag      text       -- null | 'duplicate' | 'unknown'
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.officer_can('members.approve')) then
    return;                       -- everyone else gets zero rows
  end if;
  return query
    select b.id,
           b.full_name,
           b.pledge_class,
           (b.roster_name is not null),
           u.email::text,          -- auth.users.email is varchar(255)
           coalesce(u.created_at, b.created_at),
           case
             when b.roster_name is not null then null      -- claimed: expected by definition
             when exists (
               select 1 from public.brothers x
               where x.id <> b.id
                 and public.name_key(coalesce(x.roster_name, x.full_name))
                   = public.name_key(b.full_name)
             ) then 'duplicate'
             else 'unknown'
           end
    from public.brothers b
    left join auth.users u on u.id = b.user_id
    where b.status = 'pending'
    order by b.full_name;
end;
$$;

-- `revoke ... from public` alone is NOT enough here. Supabase's default
-- privileges grant EXECUTE on every new public function to anon and
-- authenticated EXPLICITLY, and revoking from the PUBLIC pseudo-role does not
-- touch an explicit grant — the same trap that makes a view writeable by anon.
-- Caught by reading the grants back after the first apply, not by assuming.
-- (anon was refused by the gate inside anyway; this removes the surface.)
revoke all on function public.pending_queue() from public, anon;
grant execute on function public.pending_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) decide_pending_brother — the ONE verb.
--
--    Every restriction below is load-bearing:
--      * `and status = 'pending'` is the real security boundary. An officer
--        cannot demote a verified brother, cannot resurrect a rejected one, and
--        cannot touch anyone who is not in the queue.
--      * Only `status` is written. Not full_name, not role, not user_id, not
--        big_id — the columns tg_guard_status exists to protect stay protected.
--      * Self-approval is structurally impossible: my_officer_seat() returns a
--        seat only for a brother whose own row is already 'verified', so the
--        caller is never in the pending set.
--      * decided_at is NOT set here. tg_stamp_decided (upgrade19) already
--        stamps it on any status change; writing it here would fight that.
--      * The audit trail needs no change — log_brothers (upgrade40) fires on
--        UPDATE and tg_log_activity already emits member_approved /
--        member_rejected. auth.uid() still resolves to the CALLER inside a
--        definer function, so the officer's name lands on the log line.
--      * It RAISES rather than returning quietly. The failure mode this whole
--        migration works around is a silent no-op; a new one would be worse.
-- ---------------------------------------------------------------------------
create or replace function public.decide_pending_brother(p_id uuid, p_decision text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_decision not in ('verified', 'rejected') then
    raise exception 'decision must be verified or rejected';
  end if;
  if not (public.is_admin() or public.officer_can('members.approve')) then
    raise exception 'not allowed';
  end if;

  -- Mandatory, not belt-and-braces: without it tg_guard_status pins status back
  -- to its old value and this function "succeeds" while doing nothing.
  -- set_config(..., true) is TRANSACTION-local, and PostgREST gives each RPC its
  -- own transaction, so it cannot leak to another request. Closed immediately
  -- after the one statement that needs it.
  perform set_config('zbxi.bypass', '1', true);

  update public.brothers
     set status = p_decision
   where id = p_id
     and status = 'pending';
  get diagnostics n = row_count;

  perform set_config('zbxi.bypass', '', true);

  if n = 0 then
    raise exception 'that brother is no longer waiting for a decision';
  end if;
  return p_decision;
end;
$$;

revoke all on function public.decide_pending_brother(uuid, text) from public, anon;
grant execute on function public.decide_pending_brother(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Retire the Active President seat.
--
--    Pre-upgrade44 body of my_officer_seat(), for the rollback in the header:
--      when b.role = 'President' and b.role_scope = 'active' then 'active_president'
--      when b.role = 'President' and b.role_scope = 'alumni' then 'alumni_president'
--
--    The seat's ONLY grant row on the live database was ('events.manage', false),
--    so nothing working is lost. The `check (seat in (...))` constraint keeps
--    allowing both values — dropping it buys nothing once the seat can no longer
--    be derived, and keeps the rollback to two plain statements.
--
--    The Active President's public TITLE is untouched. He still renders on the
--    E-board page; this is about console powers only.
-- ---------------------------------------------------------------------------
create or replace function public.my_officer_seat()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when b.role = 'President' and b.role_scope = 'alumni' then 'alumni_president'
    else null
  end
  from public.brothers b
  where b.user_id = auth.uid() and b.status = 'verified'
  limit 1;
$$;

-- Carry the committees switch across at whatever state it holds, so retiring the
-- seat can never silently take a working power away. (On the live database there
-- is no such row, so this is a no-op there — it exists so this file is correct
-- wherever it is replayed.)
insert into public.officer_grants (seat, permission, enabled)
select 'alumni_president', 'committees.manage', g.enabled
  from public.officer_grants g
 where g.seat = 'active_president' and g.permission = 'committees.manage'
on conflict (seat, permission) do nothing;

-- This DELETE is itself audited (log_grants -> 'grant_disabled').
delete from public.officer_grants where seat = 'active_president';

-- ---------------------------------------------------------------------------
-- 5) Switch the new permission ON. The owner asked for it enabled; shipping it
--    off would mean shipping a change that does nothing until a checkbox is found.
-- ---------------------------------------------------------------------------
insert into public.officer_grants (seat, permission, enabled)
values ('alumni_president', 'members.approve', true)
on conflict (seat, permission) do update set enabled = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- 6) The bell. tg_notify_status is re-emitted in full (create or replace demands
--    it) with ONE branch changed: the 'someone is waiting' notification now also
--    reaches each Alumni President — but only while members.approve is actually
--    enabled, so switching the grant off also stops the noise.
--
--    Deliberately NOT changed: zbxi-pending.ts still emails the admin alone.
--    The owner asked for the bell, not more mail.
-- ---------------------------------------------------------------------------
create or replace function public.tg_notify_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid;
  admin_uid uuid;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select u.id into admin_uid from auth.users u where u.email = public.admin_email();
    -- `union` (not `union all`) so an admin who also held the seat gets ONE bell.
    for uid in
      select admin_uid where admin_uid is not null
      union
      select b.user_id
        from public.brothers b
       where b.user_id is not null
         and b.status = 'verified'
         and b.role = 'President'
         and b.role_scope = 'alumni'
         and exists (select 1 from public.officer_grants g
                      where g.seat = 'alumni_president'
                        and g.permission = 'members.approve'
                        and g.enabled)
    loop
      -- The destination is decided HERE, where we already know who the recipient
      -- is. Deciding it in the browser would mean asking "am I the admin?"
      -- asynchronously while the list is already rendering — and losing that race
      -- sends an officer to admin.html, which is a wall for him.
      insert into public.notifications (recipient, kind, payload)
      values (uid, 'new_pending', jsonb_build_object(
        'name', new.full_name,
        'href', case when uid = admin_uid then 'admin.html' else 'officer.html#members' end));
    end loop;
  end if;
  if tg_op = 'UPDATE' and new.status = 'verified' and old.status = 'pending'
     and new.user_id is not null then
    insert into public.notifications (recipient, kind, payload)
    values (new.user_id, 'approved', jsonb_build_object('name', new.full_name));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Assertions — fail the migration loudly rather than leave a half-applied
--    privilege change behind (upgrade40/41 style).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.officer_grants where seat = 'active_president') then
    raise exception 'active_president grant rows survived; the seat is meant to be retired';
  end if;

  if not exists (select 1 from public.officer_grants
                  where seat = 'alumni_president' and permission = 'members.approve' and enabled) then
    raise exception 'members.approve is not enabled for alumni_president; officers still cannot approve';
  end if;

  if pg_get_functiondef('public.my_officer_seat()'::regprocedure) like '%active_president%' then
    raise exception 'my_officer_seat() can still return active_president';
  end if;

  -- The gate must be the grant, not the mere existence of the function.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'decide_pending_brother'
                    and p.prosecdef) then
    raise exception 'decide_pending_brother must exist and be SECURITY DEFINER';
  end if;

  -- anon must hold EXECUTE on none of the three. Supabase's default privileges
  -- hand it out automatically, so this catches a future replay that forgets the
  -- revokes as much as it catches a mistake here.
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in ('pending_queue', 'decide_pending_brother', 'name_key')
       and grantee = 'anon' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'anon can still execute one of the upgrade44 functions';
  end if;

  -- Nobody widened the dangerous table itself along the way.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'brothers'
                and qual like '%officer_can%') then
    raise exception 'a brothers policy now references officer_can; upgrade44 deliberately does not do that';
  end if;
end $$;

-- New functions are invisible to PostgREST until its schema cache reloads.
notify pgrst, 'reload schema';

commit;
