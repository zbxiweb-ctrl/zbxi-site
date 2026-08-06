-- ============================================================================
-- upgrade46 — four more Officer Console powers for the Alumni Presidents:
--             invite brothers, undo your own decision, fix roster facts
--             (incl. the family tree), and read the serious audit log.
--
-- upgrade44 handed the Alumni Presidents the signup queue. That immediately
-- exposed the next bottlenecks, all of which still routed through the webmaster:
-- an officer could let a brother IN but could not invite anyone in the first
-- place, could not fix the decision if he got it wrong, could not correct a
-- misspelled name or a wrong pledge class, could not record who big'd whom, and
-- could not see what had been done.
--
-- SAME RULE AS upgrade44, restated because it is what keeps this safe:
-- upgrade17's invariant is "no dangerous table ever references officer_can".
-- `brothers` is that table. NO RLS POLICY ON brothers IS WIDENED HERE. Each new
-- power is a narrow SECURITY DEFINER verb whose dangerous columns are ABSENT
-- FROM THE PARAMETER LIST — not filtered out of it. There is no argument an
-- officer can pass that reaches role, role_scope, status, user_id or
-- roster_name through officer_update_brother().
--
-- ⚠ THE BYPASS DISCIPLINE, and why officer_update_brother() breaks the pattern
--   deliberately:
--   tg_guard_status (upgrade37, re-emitted upgrade45) pins status, user_id,
--   role, role_scope, unsubscribe_token and roster_name for every non-admin
--   caller. It does NOT pin full_name, pledge_class, grad_year or big_id.
--   So officer_update_brother() writes exactly the four columns the trigger
--   already leaves alone, and therefore NEVER OPENS zbxi.bypass. That is not an
--   oversight to tidy up later: with the bypass shut, tg_guard_status remains a
--   SECOND, INDEPENDENT lock on the dangerous columns even if this function is
--   one day edited carelessly. An assertion at the foot of this file fails the
--   migration if that function ever mentions the bypass.
--   undo_my_decision() DOES need it (it writes status, which is pinned), and
--   follows decide_pending_brother's discipline: set, one statement, clear.
--
--   CORRECTED (this file first claimed "exactly TWO functions open the bypass",
--   which was wrong — checked against pg_proc on the live database, FOUR do):
--     claim_profile          (upgrade12) — opens, NEVER clears
--     release_profile        (upgrade12) — opens, NEVER clears
--     decide_pending_brother (upgrade45) — opens, clears
--     undo_my_decision       (this file) — opens, clears
--   The upgrade12 pair are harmless today: set_config(..., true) is discarded
--   at COMMIT and PostgREST gives each RPC its own transaction. The latent risk
--   is COMPOSITION — the day anything calls claim_profile() and then does a
--   second write in the SAME transaction, that write runs with tg_guard_status
--   disabled. Not fixed here: upgrade12 is working code outside this change.
--
-- ROLLBACK (each part independent, none of them destructive):
--   a) take the powers back, leave the code in place doing nothing:
--        update public.officer_grants set enabled = false
--         where seat = 'alumni_president'
--           and permission in ('members.invite','members.edit','history.view');
--      (undo is folded into members.approve by design — it is the correction
--       path for a power he already has, not a new one. Turning off
--       members.approve turns off undo with it.)
--   b) drop the new surface entirely:
--        drop function public.officer_update_brother(uuid, text, text, int, uuid);
--        drop function public.undo_my_decision(uuid);
--        drop function public.my_recent_decisions(int);
--        drop function public.activity_feed(int);
--        drop policy invites_officer_read on public.invites;
--   c) decided_by is additive and harmless; leaving it costs nothing. To remove:
--        alter table public.brothers drop column decided_by;
--        -- and re-apply the upgrade19 body of tg_stamp_decided (quoted in §1).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) WHO decided. brothers records decided_at (upgrade19) but not decided_by,
--    so "undo the decision YOU made" was not expressible.
--
--    Stamped in the trigger rather than in the verb, for the same reason
--    upgrade19 put decided_at there: the trigger is the only place a client
--    cannot spoof it. Trigger ORDER matters and is already correct — Postgres
--    fires same-timing triggers alphabetically, and `guard_status` < `stamp_
--    decided`, so the guard has already pinned (or allowed) the status change
--    by the time this runs. An update the guard reverted is therefore not
--    distinct from old.status here, and stamps nothing.
--
--    NOTHING IS BACK-FILLED, deliberately. Every brother decided before today
--    keeps decided_by = null, and `null = auth.uid()` evaluates to NULL — never
--    true — so no historical decision is undoable by anyone. Service-role and
--    cron decisions have a null auth.uid() and are sealed the same way. This is
--    the one place a NULL comparison silently failing is exactly what we want,
--    so it is written as a plain `=` on purpose and commented at the use site.
--
--    upgrade19 body, for the rollback in the header:
--      if tg_op = 'INSERT' then new.decided_at := null;
--      elsif new.status is distinct from old.status then new.decided_at := now();
--      else new.decided_at := old.decided_at; end if;
-- ---------------------------------------------------------------------------
alter table public.brothers add column if not exists decided_by uuid;

comment on column public.brothers.decided_by is
  'auth.uid() of whoever last changed this row''s status. Stamped by tg_stamp_decided, never by a client. NULL = decided before upgrade46, or by the server (cron / service_role); such rows can never be undone by an officer.';

create or replace function public.tg_stamp_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.decided_at := null;               -- a brand-new row hasn't been decided yet
    new.decided_by := null;
  elsif new.status is distinct from old.status then
    new.decided_at := now();              -- a real approve/reject/revoke = a decision
    new.decided_by := auth.uid();         -- null when the server did it: sealed, not undoable
  else
    new.decided_at := old.decided_at;     -- ignore any client-supplied value
    new.decided_by := old.decided_by;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) undo_my_decision — reverse a decision the CALLER made, back to 'pending'.
--
--    Gated on members.approve rather than a permission of its own: this is the
--    correction path for a power he already holds, not a new power. A separate
--    switch would permit the state "can approve, cannot fix his own mistake",
--    which is precisely the behaviour this migration exists to remove.
--
--    Each clause is load-bearing:
--      * decided_by = auth.uid()  — HIS decision. NULL never matches, which
--        seals every pre-upgrade46 and every server-made decision.
--      * status in ('verified','rejected') — only a decided row can be undone.
--      * the role/role_scope clause — the upgrade45 guard, reused: a titled
--        profile is a dormant officer seat (my_officer_seat reads role +
--        role_scope + status), so moving one back to pending could strip a live
--        seat. That stays the webmaster's call.
-- ---------------------------------------------------------------------------
create or replace function public.undo_my_decision(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not (public.is_admin() or public.officer_can('members.approve')) then
    raise exception 'not allowed';
  end if;

  -- Mandatory: status is pinned by tg_guard_status for non-admins, so without
  -- this the UPDATE reports success and changes nothing. Transaction-local;
  -- PostgREST gives each RPC its own transaction. Cleared immediately after.
  perform set_config('zbxi.bypass', '1', true);

  update public.brothers
     set status = 'pending'
   where id = p_id
     and status in ('verified', 'rejected')
     and decided_by = auth.uid()          -- see §1: NULL never matches, by design
     and (role is null or role_scope is null or role_scope not in ('active', 'alumni'));
  get diagnostics n = row_count;

  perform set_config('zbxi.bypass', '', true);

  if n = 0 then
    raise exception 'you can only undo a decision you made yourself, on a brother who has no chapter title';
  end if;
  return 'pending';
end;
$$;

revoke all on function public.undo_my_decision(uuid) from public, anon;
grant execute on function public.undo_my_decision(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) my_recent_decisions — what the Undo button lists. Without it an officer
--    would have to remember an id to undo anything.
--
--    d_locked tells the UI not to OFFER Undo on a titled profile, rather than
--    letting him press it and read a refusal. Same gate as the verb itself.
-- ---------------------------------------------------------------------------
create or replace function public.my_recent_decisions(p_limit int default 20)
returns table (
  d_id     uuid,
  d_name   text,
  d_status text,
  d_at     timestamptz,
  d_locked boolean      -- true = carries a chapter title; webmaster only
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.officer_can('members.approve')) then
    return;                              -- zero rows, not an error
  end if;
  return query
    select b.id,
           b.full_name,
           b.status,
           b.decided_at,
           (b.role is not null and b.role_scope in ('active', 'alumni'))
      from public.brothers b
     where b.decided_by = auth.uid()
       and b.status in ('verified', 'rejected')
     order by b.decided_at desc nulls last
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.my_recent_decisions(int) from public, anon;
grant execute on function public.my_recent_decisions(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) officer_update_brother — roster facts only.
--
--    FOUR columns. role, role_scope, status, user_id and roster_name are not
--    parameters; there is nothing to filter because there is nothing to pass.
--    And per the header, this function does NOT open zbxi.bypass, so
--    tg_guard_status independently pins all five even if this body is later
--    changed by mistake. Two locks, one of which is not in this file.
--
--    The cycle guard is not theoretical. A loop in big_id does not crash the
--    family tree — it is quieter than that: family-tree.js only ever recurses
--    from ROOTS (a row whose big_id is null or missing), so every brother in a
--    cycle has a big, is not a root, is unreachable from one, and SILENTLY
--    DISAPPEARS from the tree. admin.js familyOf() caps at 100 hops and returns
--    the wrong family line. Neither reports anything. Checked, not assumed.
-- ---------------------------------------------------------------------------
create or replace function public.officer_update_brother(
  p_id           uuid,
  p_full_name    text,
  p_pledge_class text,
  p_grad_year    int,
  p_big_id       uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n  int;
  nm text;
begin
  if not (public.is_admin() or public.officer_can('members.edit')) then
    raise exception 'not allowed';
  end if;

  nm := btrim(coalesce(p_full_name, ''));
  if char_length(nm) < 2 then
    raise exception 'a brother needs a name of at least 2 characters';
  end if;

  -- grad_year decides Active vs Alumni everywhere on the site, so a typo here
  -- silently reclassifies a brother. Wide enough never to block a real value.
  if p_grad_year is not null and (p_grad_year < 1900 or p_grad_year > 2100) then
    raise exception 'that graduation year does not look right';
  end if;

  if p_big_id is not null then
    if p_big_id = p_id then
      raise exception 'a brother cannot be his own big';
    end if;
    if not exists (select 1 from public.brothers b
                    where b.id = p_big_id and b.status = 'verified') then
      raise exception 'that big brother is not a verified brother';
    end if;
    -- Walk UP from the proposed big. If we reach p_id, then p_id is already an
    -- ancestor and this edit would close the loop. depth bound is required, not
    -- defensive: a pre-existing cycle upstream would otherwise never terminate.
    if exists (
      with recursive up as (
        select b.id, b.big_id, 1 as depth
          from public.brothers b
         where b.id = p_big_id
        union all
        select b.id, b.big_id, up.depth + 1
          from public.brothers b
          join up on b.id = up.big_id
         where up.depth < 400
      )
      select 1 from up where up.id = p_id
    ) then
      raise exception 'that would make the family tree loop back on itself';
    end if;
  end if;

  update public.brothers
     set full_name    = nm,
         pledge_class = nullif(btrim(coalesce(p_pledge_class, '')), ''),
         grad_year    = p_grad_year,
         big_id       = p_big_id
   where id = p_id
     and status in ('verified', 'pending');   -- never a rejected row
  get diagnostics n = row_count;

  if n = 0 then
    raise exception 'no such brother, or his record is not editable';
  end if;
  return nm;
end;
$$;

revoke all on function public.officer_update_brother(uuid, text, text, int, uuid) from public, anon;
grant execute on function public.officer_update_brother(uuid, text, text, int, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) activity_feed — the serious half of the audit log, read-only.
--
--    The action list is ACT_SERIOUS from admin.js, copied deliberately: that
--    set already means "destructive or permission-changing" and already drives
--    the red edge and the filter checkbox in the webmaster's own History tab.
--    Reusing it keeps one definition of "serious" instead of inventing a second.
--    Everyday noise (profile_updated, gallery_post, gallery_comment,
--    thread_created, reply_posted, poll/event/album creation) is excluded — the
--    owner asked for accountability, not surveillance of ordinary use.
--
--    Returns the actor's NAME, never the raw uid.
-- ---------------------------------------------------------------------------
create or replace function public.activity_feed(p_limit int default 100)
returns table (
  a_action text,
  a_detail text,
  a_actor  text,
  a_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.officer_can('history.view')) then
    return;                              -- zero rows, not an error
  end if;
  return query
    select l.action,
           l.detail,
           coalesce(
             (select x.full_name from public.brothers x
               where x.user_id = l.user_id limit 1),
             '(server)'),                -- same wording admin.js uses for a null actor
           l.created_at
      from public.activity_log l
     where l.action in (
             'member_deleted', 'member_approved', 'member_rejected', 'status_changed',
             'grant_enabled', 'grant_disabled', 'title_granted', 'title_removed',
             'event_deleted', 'poll_deleted', 'album_deleted', 'gallery_post_deleted')
     order by l.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

revoke all on function public.activity_feed(int) from public, anon;
grant execute on function public.activity_feed(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) invites — SELECT only, additive.
--
--    invites_admin_all (upgrade11) is `for all using (is_admin())` and is NOT
--    touched. SELECT policies OR together, so this grants reading and nothing
--    else; INSERT/UPDATE/DELETE remain admin-only, and the rows are actually
--    written by zbxi-invite under service_role either way.
--
--    invites is not a privilege-bearing table — it holds an email, a note, a
--    status and two timestamps — so a policy is the right instrument here,
--    where it would be the wrong one on brothers.
-- ---------------------------------------------------------------------------
drop policy if exists invites_officer_read on public.invites;
create policy invites_officer_read on public.invites
  for select using (public.officer_can('members.invite'));

-- ---------------------------------------------------------------------------
-- 7) Switch the three new permissions ON. The owner asked for all of them.
--    (No row for undo: it rides on members.approve, already enabled.)
-- ---------------------------------------------------------------------------
insert into public.officer_grants (seat, permission, enabled)
values ('alumni_president', 'members.invite', true),
       ('alumni_president', 'members.edit',   true),
       ('alumni_president', 'history.view',   true)
on conflict (seat, permission) do update set enabled = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- 8) Assertions — fail loudly rather than leave a half-applied privilege change.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'brothers'
                    and column_name = 'decided_by') then
    raise exception 'brothers.decided_by was not created; undo cannot work';
  end if;

  if pg_get_functiondef('public.tg_stamp_decided()'::regprocedure) not like '%decided_by%' then
    raise exception 'tg_stamp_decided() does not stamp decided_by';
  end if;

  select string_agg(p, ', ') into missing from unnest(
    array['members.invite', 'members.edit', 'history.view']) p
   where not exists (select 1 from public.officer_grants g
                      where g.seat = 'alumni_president' and g.permission = p and g.enabled);
  if missing is not null then
    raise exception 'these permissions are not enabled for alumni_president: %', missing;
  end if;

  -- THE STRUCTURAL ONE. officer_update_brother relies on tg_guard_status still
  -- pinning role/status/user_id/roster_name underneath it. Opening the bypass
  -- would remove that second lock silently, so it is asserted, not trusted.
  if pg_get_functiondef(
       'public.officer_update_brother(uuid,text,text,int,uuid)'::regprocedure
     ) like '%zbxi.bypass%' then
    raise exception 'officer_update_brother must never open zbxi.bypass — see the header of upgrade46';
  end if;

  -- Supabase's default privileges hand anon EXECUTE on every new public
  -- function, and `revoke from public` does not remove an explicit grant.
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in ('undo_my_decision', 'my_recent_decisions',
                            'officer_update_brother', 'activity_feed')
       and grantee = 'anon' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'anon can still execute one of the upgrade46 functions';
  end if;

  -- The dangerous table was not widened along the way.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'brothers'
                and (qual like '%officer_can%' or with_check like '%officer_can%')) then
    raise exception 'a brothers policy now references officer_can; upgrade46 deliberately does not do that';
  end if;

  -- And the invites WRITE path is still admin-only.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'invites'
                and cmd <> 'SELECT' and qual like '%officer_can%') then
    raise exception 'an invites write policy now references officer_can; only SELECT was meant to widen';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
