-- ============================================================================
-- upgrade47 — fixes found reviewing upgrade46, before it was pushed.
--
-- 1) 🟠 THE REAL ONE. upgrade46 gave officers `invites_officer_read`, a plain
--    SELECT policy. RLS is ROW-level, not COLUMN-level, so it handed them every
--    column of the table — including `invites.token`.
--
--    That token is not a reference number, it is a credential: zbxi-claim.ts
--    takes a token, resolves it to the invited email, and creates an ALREADY
--    CONFIRMED auth account for that address with a caller-chosen password. So
--    an officer holding a token could stand up a working account that genuinely
--    is some.brother@gmail.com without ever seeing that inbox — and, since he
--    also holds members.approve, verify it himself. That was never one of the
--    four powers this was meant to grant.
--
--    VERIFIED, not inferred: an Alumni President's JWT against the live
--    PostgREST returned `token` as a 36-char uuid on every row of the exact
--    `select('*')` the Invite tab runs. Measured exposure at the time of the
--    fix: 3 invite rows, 0 of them still usable (zbxi-claim requires
--    accepted_at is null AND created_at > now() - 30 days), so nothing was
--    reachable in practice — it would have become reachable the first time an
--    officer sent an invite.
--
--    The mistake upstream was a factual one, and it is worth naming: upgrade46
--    justified using a policy with "invites is not a privilege-bearing table —
--    it holds an email, a note, a status and two timestamps". That sentence
--    omitted `token`. The workspace's own rule (narrow SECURITY DEFINER verb,
--    never a widened policy, when the table carries power) was correct and was
--    skipped on a wrong premise about the schema.
--
--    NOT DONE, deliberately: the review also recommended re-emitting
--    `confirm_invited()` with expiry + single-use guards. That function DOES
--    NOT EXIST on this database (checked pg_proc: only invite_status and
--    tg_invite_accepted match '%invit%'). Creating it would have ADDED a new
--    anon-callable, token-consuming surface, not removed one.
--
-- 2) 🔵 The audit gap. tg_log_activity classes any brothers UPDATE that does not
--    change status as 'profile_updated' — identical to a brother editing his own
--    bio — and upgrade46's activity_feed() filters that out as everyday noise.
--    So `members.edit`, described in the admin console as "the widest power on
--    this page; every change is logged", produced nothing in the History tab
--    that upgrade46 built to police exactly these powers. It now logs its own
--    action, 'record_edited', which IS in the feed.
--
-- 3) 🔵 The audit named the actor with brothers.full_name — a field a brother
--    can rewrite on his own profile, and which an officer with members.edit can
--    now rewrite for ANYONE. Prefer roster_name, which tg_guard_status pins.
--
-- NOT FIXED HERE (reported to the owner instead, both out of this change's scope):
--   * claim_profile() and release_profile() (upgrade12) open zbxi.bypass and
--     never clear it. Harmless today — set_config(..., true) dies at COMMIT and
--     each PostgREST RPC is its own transaction — but it means the guard is off
--     for anything else that runs later in the SAME transaction. Fixing working
--     upgrade12 code is not this change's business.
--   * officer_update_brother has no row scope: an officer may edit any verified
--     or pending brother, including the webmaster's own row and a titled one.
--     No privilege escalation (it cannot write role/role_scope/status/user_id),
--     and narrowing it would stop an officer fixing a typo in a titled brother's
--     name. Left as-is by choice.
--
-- ROLLBACK:
--   drop function public.officer_invites_list();
--   create policy invites_officer_read on public.invites
--     for select using (public.officer_can('members.invite'));   -- reopens the token
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Replace the policy with a verb that CANNOT return the token.
--    invites_admin_all (upgrade11, FOR ALL, is_admin()) is untouched — the
--    webmaster keeps his direct table access.
-- ---------------------------------------------------------------------------
drop policy if exists invites_officer_read on public.invites;

create or replace function public.officer_invites_list()
returns table (
  i_email    text,
  i_sent_at  timestamptz,
  i_accepted timestamptz,
  i_error    text,
  i_created  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.officer_can('members.invite')) then
    return;                      -- zero rows, not an error
  end if;
  return query
    select i.email, i.sent_at, i.accepted_at, i.error, i.created_at
      from public.invites i
     order by i.created_at desc;
end;
$$;

revoke all on function public.officer_invites_list() from public, anon;
grant execute on function public.officer_invites_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Make an officer's roster edit visible in the audit feed.
--    Logged INSIDE the verb because that is the only place that knows the edit
--    came from an officer rather than from a brother touching his own profile.
--    is_admin() is excluded so the webmaster's own edits keep their existing
--    'profile_updated' line and nothing double-logs.
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
  was text;
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
    -- Walk UP from the proposed big. If we reach p_id, this edit closes a loop.
    -- A loop does not crash the tree, it is quieter than that: family-tree.js
    -- only recurses from ROOTS, so everyone in a cycle silently vanishes from it.
    -- depth bound is required, not defensive: a pre-existing cycle upstream
    -- would otherwise never terminate.
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

  -- captured before the write so the log line can say what it was
  select coalesce(b.roster_name, b.full_name) into was
    from public.brothers b where b.id = p_id;

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

  if not public.is_admin() then
    insert into public.activity_log (user_id, action, detail, target)
    values (auth.uid(), 'record_edited',
            case when was is distinct from nm then was || ' → ' || nm else nm end,
            p_id);
  end if;

  return nm;
end;
$$;

revoke all on function public.officer_update_brother(uuid, text, text, int, uuid) from public, anon;
grant execute on function public.officer_update_brother(uuid, text, text, int, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) activity_feed: carry 'record_edited', and name the actor with a field he
--    cannot rewrite. roster_name is pinned by tg_guard_status (upgrade45), so a
--    past action keeps the name it was done under.
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
             (select coalesce(x.roster_name, x.full_name) from public.brothers x
               where x.user_id = l.user_id limit 1),
             '(server)'),
           l.created_at
      from public.activity_log l
     where l.action in (
             'member_deleted', 'member_approved', 'member_rejected', 'status_changed',
             'record_edited',
             'grant_enabled', 'grant_disabled', 'title_granted', 'title_removed',
             'event_deleted', 'poll_deleted', 'album_deleted', 'gallery_post_deleted')
     order by l.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

revoke all on function public.activity_feed(int) from public, anon;
grant execute on function public.activity_feed(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  -- The token must be unreachable through the officer path, by construction.
  if pg_get_functiondef('public.officer_invites_list()'::regprocedure) like '%token%' then
    raise exception 'officer_invites_list must never select invites.token';
  end if;

  -- And no policy may hand the table to an officer again.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'invites'
                and qual like '%officer_can%') then
    raise exception 'an invites policy still references officer_can; officers must go through officer_invites_list()';
  end if;

  -- The admin keeps his direct read.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'invites'
                    and policyname = 'invites_admin_all') then
    raise exception 'invites_admin_all was lost; the webmaster can no longer read invites';
  end if;

  if pg_get_functiondef('public.activity_feed(int)'::regprocedure) not like '%record_edited%' then
    raise exception 'activity_feed does not carry record_edited; officer edits stay invisible';
  end if;

  if pg_get_functiondef(
       'public.officer_update_brother(uuid,text,text,int,uuid)'::regprocedure) like '%zbxi.bypass%' then
    raise exception 'officer_update_brother must never open zbxi.bypass — see upgrade46 header';
  end if;

  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in ('officer_invites_list', 'officer_update_brother', 'activity_feed')
       and grantee = 'anon' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'anon can still execute one of the upgrade47 functions';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
