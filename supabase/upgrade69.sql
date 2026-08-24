-- ============================================================================
-- upgrade69 — seat overrides: the alert plumbing catches up, and the admin
--             gets narrow verbs to grant/revoke console access himself.
--
-- THE DRIFT THIS FIXES. upgrade58 gave my_officer_seat() a second source
-- (officer_seat_overrides) but left two functions deriving the seat the old
-- way, from role='President' + role_scope='alumni' alone:
--
--   * pending_alert_recipients() (upgrade48) — the "brother awaiting approval"
--     email list. Its own header says the derivation "mirrors my_officer_seat()
--     ... both must change together". They did not.
--   * tg_notify_status() (upgrade44) — the in-site bell for the same event.
--
-- Consequence: a president granted via override can approve brothers but is
-- never told one is waiting — no email, no bell. Today that only affects the
-- owner's test seat (the real president holds the title directly), but the
-- admin console is about to grow a "grant console access" button (this file's
-- RPCs are its server side), which makes overrides the NORMAL path for future
-- e-boards. Without this fix every future granted president would silently
-- lose the alerts.
--
-- Both functions below now use the same coalesce(derived, override) shape as
-- my_officer_seat() itself — third restatement of the mapping, same rule:
-- if the seat model ever changes, all of them change together.
--
-- THE NEW VERBS. officer_seat_overrides keeps ZERO table grants (upgrade58's
-- stance, re-asserted at the bottom): the admin UI reaches it only through
-- three SECURITY DEFINER functions gated on is_admin(), the same
-- narrow-verbs-on-a-locked-table pattern as decide_pending_brother
-- (upgrade44/45). RLS on the table stays; no client touches it directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) pending_alert_recipients(): re-emitted with the seat derivation widened.
--    Everything else — the admin floor, the confirmed-email condition, the
--    test-seat suppression — is unchanged from upgrade48.
-- ---------------------------------------------------------------------------
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

  -- Everyone whose officer seat carries members.approve. The seat comes from
  -- the SAME two sources as my_officer_seat(): the President title, or an
  -- explicit row in officer_seat_overrides. When both yield NULL (an ordinary
  -- brother), `g.seat = null` is never true, so he is excluded — NULL-means-
  -- no-match stays the fail-safe direction.
  select lower(u.email), b.full_name
    from public.brothers b
    join auth.users u on u.id = b.user_id
    join public.officer_grants g
      on g.seat = coalesce(
           case when b.role = 'President' and b.role_scope = 'alumni'
                then 'alumni_president' end,
           (select o.seat from public.officer_seat_overrides o
             where o.user_id = b.user_id))
   where b.status = 'verified'
     and g.permission = 'members.approve'
     and g.enabled
     and u.email is not null
     -- An unconfirmed address is a bounce waiting to happen.
     and u.email_confirmed_at is not null
     -- SUPPRESSED — the owner's test seat (see upgrade48 for the full story).
     -- DELETE THIS LINE when that seat is reverted.
     and b.user_id <> '14734357-7b21-4a38-ae55-6d52e842cdbf'::uuid
$$;

revoke all on function public.pending_alert_recipients() from public, anon, authenticated;
grant execute on function public.pending_alert_recipients() to service_role;

-- ---------------------------------------------------------------------------
-- 2) tg_notify_status(): re-emitted in full (create or replace demands it)
--    with ONE predicate widened — the officer branch now recognises a seat
--    held via override, not just via title.
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
         and coalesce(
               case when b.role = 'President' and b.role_scope = 'alumni'
                    then 'alumni_president' end,
               (select o.seat from public.officer_seat_overrides o
                 where o.user_id = b.user_id)
             ) = 'alumni_president'
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
-- 3) The admin's three verbs on officer_seat_overrides. All gated on
--    is_admin() INSIDE the function (raise, don't return-empty — a silent
--    no-op would look like success in the console); granted to authenticated
--    because the admin's browser session runs as that role, exactly like
--    decide_pending_brother.
-- ---------------------------------------------------------------------------

-- List every override. LEFT join: an override whose brothers row has gone
-- missing must still be VISIBLE to the admin — an invisible privilege is the
-- one kind we never allow. (my_officer_seat() ignores such a row, so it is
-- inert, but the admin should still see and be able to ask about it.)
create or replace function public.admin_seat_overrides_list()
returns table (brother_id uuid, brother_name text, seat text, note text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  return query
    select b.id, coalesce(b.full_name, '(profile row missing)'), o.seat, o.note, o.created_at
      from public.officer_seat_overrides o
      left join public.brothers b on b.user_id = o.user_id
     order by o.created_at;
end;
$$;

-- Grant console access to one brother. Takes the brothers.id the console
-- already has everywhere; resolves user_id here so the client never handles
-- auth ids. Errors are written for the person reading them in a dialog.
create or replace function public.admin_seat_override_set(p_brother_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_status text;
  v_name   text;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select b.user_id, b.status, b.full_name into v_uid, v_status, v_name
    from public.brothers b where b.id = p_brother_id;
  if not found then
    raise exception 'No brother record with that id.';
  end if;
  if v_status <> 'verified' then
    raise exception '% is not an approved brother yet — approve him first.', v_name;
  end if;
  if v_uid is null then
    raise exception '% has not signed up on the site yet, so there is no account to attach console access to.', v_name;
  end if;
  insert into public.officer_seat_overrides (user_id, seat, note)
  values (v_uid, 'alumni_president', p_note)
  on conflict (user_id) do update set seat = excluded.seat, note = excluded.note;
end;
$$;

-- Remove a grant. Raising on "nothing to remove" instead of no-op'ing keeps
-- the console honest about what actually happened.
create or replace function public.admin_seat_override_delete(p_brother_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  n     int;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select b.user_id into v_uid from public.brothers b where b.id = p_brother_id;
  if v_uid is null then
    raise exception 'No signed-up brother with that id.';
  end if;
  delete from public.officer_seat_overrides where user_id = v_uid;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'That brother has no console-access grant to remove.';
  end if;
end;
$$;

-- anon named explicitly: default privileges grant it EXECUTE and
-- `revoke from public` does not remove an explicit grant (upgrade45's lesson).
revoke all on function public.admin_seat_overrides_list()                  from public, anon;
revoke all on function public.admin_seat_override_set(uuid, text)          from public, anon;
revoke all on function public.admin_seat_override_delete(uuid)             from public, anon;
grant execute on function public.admin_seat_overrides_list()               to authenticated;
grant execute on function public.admin_seat_override_set(uuid, text)       to authenticated;
grant execute on function public.admin_seat_override_delete(uuid)          to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Assertions — fail loudly rather than leave a half-applied change behind.
-- ---------------------------------------------------------------------------
do $$
declare
  n   int;
  bad text;
begin
  -- 1. Both repaired functions really consult the override table now
  --    (structural, same style as the "must never read brother_titles" checks).
  if pg_get_functiondef('public.pending_alert_recipients()'::regprocedure)
       not like '%officer_seat_overrides%' then
    raise exception 'pending_alert_recipients still ignores officer_seat_overrides';
  end if;
  if pg_get_functiondef('public.tg_notify_status()'::regprocedure)
       not like '%officer_seat_overrides%' then
    raise exception 'tg_notify_status still ignores officer_seat_overrides';
  end if;

  -- 2. pending_alert_recipients stays service_role-only (upgrade48 re-assert).
  select string_agg(g, ', ') into bad
    from (select unnest(array['anon','authenticated']) as g) r
   where has_function_privilege(r.g, 'public.pending_alert_recipients()', 'EXECUTE');
  if bad is not null then
    raise exception 'pending_alert_recipients must not be executable by %', bad;
  end if;
  if not has_function_privilege('service_role', 'public.pending_alert_recipients()', 'EXECUTE') then
    raise exception 'service_role cannot execute pending_alert_recipients';
  end if;

  -- 3. The new verbs: anon never, authenticated yes (the gate is inside).
  select string_agg(f, ', ') into bad
    from (select unnest(array[
            'public.admin_seat_overrides_list()',
            'public.admin_seat_override_set(uuid, text)',
            'public.admin_seat_override_delete(uuid)']) as f) r
   where has_function_privilege('anon', r.f, 'EXECUTE')
      or not has_function_privilege('authenticated', r.f, 'EXECUTE');
  if bad is not null then
    raise exception 'seat-override verb grants are wrong on: %', bad;
  end if;

  -- 4. The table itself still has ZERO client grants (upgrade58 re-assert).
  select string_agg(r.g || '/' || r.p, ', ') into bad
    from (select g, p
            from unnest(array['anon','authenticated']) as g
           cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p) r
   where has_table_privilege(r.g, 'public.officer_seat_overrides', r.p);
  if bad is not null then
    raise exception 'officer_seat_overrides has client table grants again: %', bad;
  end if;

  -- 5. The suppressed test account stays out of the email list, and the
  --    admin stays in it exactly once (upgrade48 re-asserts).
  select count(*) into n
    from public.pending_alert_recipients()
   where email = (select lower(u.email) from auth.users u
                   where u.id = '14734357-7b21-4a38-ae55-6d52e842cdbf'::uuid);
  if n > 0 then
    raise exception 'the suppressed test account is back in the recipient list';
  end if;
  select count(*) into n from public.pending_alert_recipients()
   where email = public.admin_email();
  if n <> 1 then
    raise exception 'admin_email is not in the recipient list exactly once (got %)', n;
  end if;

  -- 6. The grant this all hangs on is still enabled, and the sitting
  --    (title-holding) president still makes the list — the fix must widen
  --    the recipients, never narrow them.
  if not exists (select 1 from public.officer_grants
                  where seat = 'alumni_president' and permission = 'members.approve' and enabled) then
    raise exception 'members.approve is not enabled for alumni_president';
  end if;
  select count(*) into n from public.pending_alert_recipients();
  if n < 2 then
    raise exception 'recipient list shrank to % — the sitting president fell out', n;
  end if;

  raise notice 'upgrade69 ok — % recipient(s), override table locked, verbs in place',
    (select count(*) from public.pending_alert_recipients());
end $$;

notify pgrst, 'reload schema';
