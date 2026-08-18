-- upgrade68.sql — crowning a Brother of the Month becomes an audited action.
--
-- WHY. upgrade67 gave the alumni president a switch that decides a chapter-wide award, and
-- the 📜 History tab — the logbook of serious actions — said nothing about it. Today that is
-- harmless because spotlight.manage is granted to nobody. The moment it is granted, "did I
-- pick that, or did he?" would have no answer.
--
-- ── A DEDICATED TRIGGER, NOT A BRANCH IN THE SHARED ONE ──────────────────────────────
-- tg_log_activity() switches on tg_table_name and ends with `else return coalesce(new,
-- old)` — an unknown table logs NOTHING, so a bare trigger on botm_cycles would be silent
-- rather than wrong. Adding the branch means re-emitting a ~120-line function that eight
-- other tables depend on, and dropping one branch by accident would silently stop auditing
-- something else. So botm_cycles gets its own trigger function, the same way tg_notify_tag
-- did in upgrade60. Smaller blast radius, and this file cannot break another table's audit.
--
-- ── AND THE OUTGOING WINNER IS KEPT ──────────────────────────────────────────────────
-- crown_botm(..., p_force := true) lets the webmaster overturn a settled month. That
-- overwrote winner_brother in place, so who ACTUALLY won was gone — the one thing a
-- rewrite destroys and the one thing a logbook cannot reconstruct from the row.
--
-- Idempotent: safe to re-run.

-- ═══ 1) Remember who was displaced ═══════════════════════════════════════════════════
alter table public.botm_cycles
  add column if not exists prev_winner uuid references public.brothers(id) on delete set null;

comment on column public.botm_cycles.prev_winner is
  'The winner this month had BEFORE it was overturned. Written by crown_botm; null on a '
  'first crowning. Exists so that overturning a settled month is recoverable (upgrade68).';

-- ═══ 2) crown_botm keeps the man it displaces ════════════════════════════════════════
-- Re-emitted whole rather than patched: this is upgrade67's function with one added
-- assignment. Everything else — the closed-and-unsettled guard, the admin-only p_force,
-- the officer/admin attribution — is unchanged and must stay that way.
create or replace function public.crown_botm(p_cycle uuid, p_brother uuid, p_force boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare is_adm boolean := public.is_admin();
begin
  if not (is_adm or public.officer_can('spotlight.manage')) then
    raise exception 'not allowed';
  end if;
  if p_force and not is_adm then
    raise exception 'only the webmaster can overturn a settled month';
  end if;
  if not exists (
    select 1 from public.brothers b
     where b.id = p_brother and b.status = 'verified' and b.user_id is not null
  ) then
    raise exception 'that brother is not eligible';
  end if;

  update public.botm_cycles
     -- The bare column on the right is the OLD value inside an UPDATE, which is exactly
     -- the man being displaced. Null on a first crowning, which is correct.
     set prev_winner    = winner_brother,
         winner_brother = p_brother,
         winner_source  = case when is_adm then 'admin' else 'officer' end,
         crowned_at     = now(),
         crowned_by     = auth.uid()
   where id = p_cycle
     and (p_force or (winner_brother is null and closes_at <= now()));
  if not found then
    raise exception 'that month is either still open for voting or already settled';
  end if;

  return 'ok';
end $$;

revoke all on function public.crown_botm(uuid, uuid, boolean) from public, anon;
grant execute on function public.crown_botm(uuid, uuid, boolean) to authenticated;

-- ═══ 3) The audit line ═══════════════════════════════════════════════════════════════
create or replace function public.tg_log_botm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  act text;
  det text;
  who text;
  was text;
begin
  -- Opening a month is the cron doing its job, not a decision. Only a CROWNING is worth a
  -- line, or the log fills with noise and stops being read.
  if new.winner_brother is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.winner_brother is not distinct from new.winner_brother then
    return new;                    -- `is not distinct from`: null-safe, unlike <>
  end if;

  select b.full_name into who from public.brothers b where b.id = new.winner_brother;

  if tg_op = 'UPDATE' and old.winner_brother is not null then
    select b.full_name into was from public.brothers b where b.id = old.winner_brother;
    act := 'botm_overturned';
    det := to_char(new.period, 'Mon YYYY') || ': ' || coalesce(who, '?')
        || ' (was ' || coalesce(was, '?') || ')';
  else
    act := 'botm_crowned';
    det := to_char(new.period, 'Mon YYYY') || ': ' || coalesce(who, '?')
        || ' · ' || coalesce(new.winner_source, '?');
  end if;

  -- auth.uid() is NULL when the cron settles a month unattended; the console renders that
  -- as "(server)", which is the honest answer rather than a fabricated actor.
  insert into public.activity_log (user_id, action, detail, target)
  values (auth.uid(), act, det, new.winner_brother);

  return new;
end $$;

revoke all on function public.tg_log_botm() from public, anon, authenticated;

drop trigger if exists log_botm on public.botm_cycles;
create trigger log_botm
  after insert or update on public.botm_cycles
  for each row execute function public.tg_log_botm();

-- ═══ 4) …and the History tab has to be allowed to SHOW it ═══════════════════════════
-- THE STEP THAT IS EASY TO MISS, AND WAS MISSED ONCE BEFORE. activity_feed() has an
-- allow-list of actions, and a crowning was not on it — so the log row would exist, the
-- trigger would be "working", and the History tab would show nothing forever. That is
-- exactly the bug upgrade47 had to fix for record_edited. Re-emitted whole with the two
-- new actions added; every existing action is preserved verbatim.
create or replace function public.activity_feed(p_limit integer default 100)
returns table(a_action text, a_detail text, a_actor text, a_at timestamp with time zone)
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
             'event_deleted', 'poll_deleted', 'album_deleted', 'gallery_post_deleted',
             -- upgrade68: who decided a chapter-wide award, and who they displaced.
             'botm_crowned', 'botm_overturned')
     order by l.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

-- ═══ 5) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare n int; bad text;
begin
  -- (a) The trigger exists and fires on both paths a crowning can arrive by.
  select count(*) into n from pg_trigger
   where tgrelid = 'public.botm_cycles'::regclass and tgname = 'log_botm' and not tgisinternal;
  if n <> 1 then
    raise exception 'log_botm is missing — crowning would go unrecorded';
  end if;

  -- (b) crown_botm still keeps the displaced man. Losing this line is silent: the crowning
  --     still works, and only the history is gone.
  if pg_get_functiondef('public.crown_botm(uuid,uuid,boolean)'::regprocedure)
       not like '%prev_winner    = winner_brother%' then
    raise exception 'crown_botm no longer records prev_winner — an overturn would erase the old winner';
  end if;

  -- (c) …and it still refuses to touch an open or settled month. upgrade67's guard must
  --     survive this file's re-emit of the same function.
  if pg_get_functiondef('public.crown_botm(uuid,uuid,boolean)'::regprocedure)
       not like '%winner_brother is null and closes_at <= now()%' then
    raise exception 'crown_botm lost its closed-and-unsettled guard';
  end if;

  -- (d) The audit function must stay a TRIGGER function. The first version of this
  --     check ANDed the privilege test with "does it return something other than
  --     trigger" — which is false by construction, so the whole condition could never
  --     be true and the assertion was decoration. Split into two real checks.
  if exists (select 1 from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
              where nsp.nspname = 'public' and p.proname = 'tg_log_botm'
                and p.prorettype <> 'trigger'::regtype) then
    raise exception 'tg_log_botm no longer returns trigger — it is now a callable RPC';
  end if;
  if has_function_privilege('anon', 'public.tg_log_botm()', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.tg_log_botm()', 'EXECUTE') then
    raise exception 'tg_log_botm holds a caller EXECUTE grant';
  end if;

  -- (e) The feed can actually SHOW a crowning. A trigger that writes a row the console
  --     filters out is indistinguishable from a trigger that does not fire.
  if pg_get_functiondef('public.activity_feed(integer)'::regprocedure) not like '%botm_crowned%'
  or pg_get_functiondef('public.activity_feed(integer)'::regprocedure) not like '%botm_overturned%' then
    raise exception 'activity_feed does not list the crowning actions — History would stay empty';
  end if;
  -- …and the re-emit above did not drop an existing action on the way past.
  select string_agg(a, ', ') into bad from unnest(array[
    'member_deleted','member_approved','member_rejected','status_changed','record_edited',
    'grant_enabled','grant_disabled','title_granted','title_removed',
    'event_deleted','poll_deleted','album_deleted','gallery_post_deleted']) a
   where pg_get_functiondef('public.activity_feed(integer)'::regprocedure) not like '%' || a || '%';
  if bad is not null then
    raise exception 'activity_feed lost action(s): %', bad;
  end if;

  -- (f) prev_winner is not writable by a brother — it is evidence, not a field.
  select string_agg(distinct privilege_type, ', ') into bad from (
    select privilege_type from information_schema.table_privileges
     where table_schema='public' and table_name='botm_cycles' and grantee='authenticated'
    union all
    select privilege_type from information_schema.column_privileges
     where table_schema='public' and table_name='botm_cycles' and grantee='authenticated'
  ) x where privilege_type in ('INSERT','UPDATE','DELETE');
  if bad is not null then
    raise exception 'botm_cycles: authenticated holds % — the audit trail is editable', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
