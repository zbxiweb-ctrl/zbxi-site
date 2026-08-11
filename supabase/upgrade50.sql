-- upgrade50.sql — Executive Boards become a place you can go, term by term.
--
-- WHY: "Previous Executive Board" was a strip at the bottom of the Alumni page, and it
-- showed whoever had a `brothers.role` — including a Philanthropy Chair and a Pledge
-- Master standing beside real presidents. `brothers` holds ONE role per man, so it can
-- never record a brother who was Secretary in 2019 and President in 2021, and its term
-- is free text ('Spring 2024', 'Fall 2013', bare '2023', 'Vice President' with no hyphen).
--
-- WHAT ALREADY EXISTED, and why this migration is small: brother_titles (upgrade19) is
-- ALREADY the multi-title history — 21 rows, richer than brothers.role (Johnathan Conway
-- has three positions; Robert Steinwachs' Fall 2004 seat appears nowhere else), already
-- rendered on the profile card, already fed by the title-request approval flow. It has
-- everything a board needs except the board itself. So:
--
--   * ONE new table, `eboards` — the per-term board record. It exists to give a term an
--     identity independent of its text, which is what makes merging two single-semester
--     stubs into one two-semester board possible at all.
--   * ONE new column, `brother_titles.board_id`. A title row IS a seat.
--
-- No second seats table. The boards page and the profile card read the same rows, so a
-- term corrected in one place is corrected in both.
--
-- OFFICER TITLE vs CHAIR is DERIVED, not stored: a title in the canonical four is an
-- officer, anything else is a chair. One rule, one place, no column to backfill and no
-- second definition to drift. Section 3 normalises the spellings so the rule can work.
--
-- ── THE SECURITY QUESTION, answered before it is asked ────────────────────────────────
-- This grants the alumni president write access to a table of TITLES, and titles are how
-- this site decides who is an officer. So: can he promote himself?
--
--   No. my_officer_seat() reads brothers.role + brothers.role_scope and nothing else —
--   verified against the live definition while writing this, and asserted in section 8.
--   brother_titles has never been in the privilege path and this migration does not put
--   it there. A row here claiming anyone was President grants exactly zero power.
--
-- What he CAN do is write a false line of chapter history. That is vandalism, not
-- escalation, it is what the admin is deliberately handing him, and log_titles records
-- every one of them under his name (section 6 closes the UPDATE gap in that trigger).
--
-- ── THE DORMANT GRANT, which is the actual dangerous part ─────────────────────────────
-- brother_titles still carries Supabase's default table-wide grants. Measured before
-- writing this:
--     authenticated INSERT/UPDATE -> brother_id, created_at, id, scope, sort, term, title
--     anon          INSERT/UPDATE -> the same seven
-- They are harmless TODAY only because the one write policy is bt_admin_all (is_admin()),
-- so no row gets through. Section 5 adds officer write policies — and the instant it does,
-- those grants are live for that officer. RLS is row-level and cannot restrict columns,
-- so section 5 locks the columns FIRST. Exactly the upgrade49 trap, same fix.
--
-- Idempotent: safe to re-run. Section 7 is guarded on board_id being unset, so re-running
-- after you have merged boards by hand will NOT recreate the stubs you deleted.
--
-- ROLLBACK:
--   alter table public.brother_titles drop column board_id;
--   drop table public.eboards;
--   drop policy bt_officer_insert on public.brother_titles;
--   drop policy bt_officer_update on public.brother_titles;
--   drop policy bt_officer_delete on public.brother_titles;
--   delete from public.officer_grants where permission = 'eboard.manage';
--   drop trigger log_titles on public.brother_titles;
--   create trigger log_titles after insert or delete on public.brother_titles
--     for each row execute function public.tg_log_activity();

-- ═══ 1) The board record ═══════════════════════════════════════════════════════════════
-- A board is a term, a scope, and whatever the chapter wants to remember about it.
-- `rank` is generated so the page can order chronologically in one indexed column:
-- Fall 2023 (4047) precedes Spring 2024 (4048) precedes Fall 2024 (4049), which is the
-- academic year, not the calendar year. Getting that wrong by sorting on year alone is
-- how Spring lands before the Fall it followed.
create table if not exists public.eboards (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null default 'active' check (scope in ('active', 'alumni')),
  start_sem  text not null check (start_sem in ('Fall', 'Spring')),
  start_year int  not null check (start_year between 1993 and 2100),
  end_sem    text check (end_sem in ('Fall', 'Spring')),   -- null => a one-semester board
  end_year   int  check (end_year between 1993 and 2100),
  note       text,
  photo_url  text,
  rank       int generated always as
               (start_year * 2 + case when start_sem = 'Fall' then 1 else 0 end) stored,
  created_at timestamptz not null default now()
);
create index if not exists eboards_rank_idx on public.eboards (rank desc);

alter table public.eboards enable row level security;

-- Read: the same audience as the roster it describes. brother_titles' own read policy is
-- (is_approved_brother() or is_admin()) — matched exactly, so a board can never be
-- visible to someone who cannot see the men on it.
drop policy if exists eboards_read on public.eboards;
create policy eboards_read on public.eboards
  for select using (public.is_approved_brother() or public.is_admin());

drop policy if exists eboards_manage_insert on public.eboards;
create policy eboards_manage_insert on public.eboards
  for insert with check (public.is_admin() or public.officer_can('eboard.manage'));

drop policy if exists eboards_manage_update on public.eboards;
create policy eboards_manage_update on public.eboards
  for update using       (public.is_admin() or public.officer_can('eboard.manage'))
          with check     (public.is_admin() or public.officer_can('eboard.manage'));

drop policy if exists eboards_manage_delete on public.eboards;
create policy eboards_manage_delete on public.eboards
  for delete using (public.is_admin() or public.officer_can('eboard.manage'));

-- REVOKE FIRST. A new table does NOT start empty: Supabase ships
--   alter default privileges in schema public grant all on tables to anon, authenticated
-- so `eboards` was born with full-column INSERT/UPDATE for BOTH roles — including id
-- and created_at — the moment it was created. Granting narrowly on top of that is a
-- no-op that reads like a lock; it was one here until this revoke was added, and only
-- the post-migration audit caught it. Exactly the upgrade49 trap, on a brand-new table.
--
-- anon keeps SELECT only, and the read policy still gates every row. authenticated
-- keeps the seven real columns because the ADMIN is authenticated too — is_admin()
-- reads the JWT email, it does not change the Postgres role.
revoke insert, update, delete on public.eboards from anon, authenticated;
grant  select on public.eboards to anon, authenticated;
grant  insert (scope, start_sem, start_year, end_sem, end_year, note, photo_url)
  on public.eboards to authenticated;
grant  update (scope, start_sem, start_year, end_sem, end_year, note, photo_url)
  on public.eboards to authenticated;
grant  delete on public.eboards to authenticated;

-- ═══ 2) A title row becomes a seat ═════════════════════════════════════════════════════
-- ON DELETE SET NULL, deliberately: deleting a board must never delete the record that a
-- brother held the office. The title survives, unassigned, and can be attached elsewhere.
alter table public.brother_titles
  add column if not exists board_id uuid references public.eboards(id) on delete set null;
create index if not exists brother_titles_board_idx on public.brother_titles (board_id);

-- ═══ 3) Normalise the four officer titles ══════════════════════════════════════════════
-- The officer/chair split is derived from the title text, so the text has to be reliable.
-- Live data carried 'Vice President' (Blake, Caleb, Thomas — no hyphen, so it matched
-- nothing) and 'Philanthropy chair' (lowercase c). Only the four officer spellings are
-- forced; chair titles stay exactly as written, because a chapter invents its own and
-- nothing downstream depends on their casing.
update public.brother_titles
   set title = 'Vice-President'
 where lower(btrim(title)) in ('vice president', 'vice-president')
   and title <> 'Vice-President';
update public.brother_titles
   set title = initcap(btrim(title))
 where lower(btrim(title)) in ('president', 'treasurer', 'secretary')
   and title <> initcap(btrim(title));

-- ═══ 4) The permission ═════════════════════════════════════════════════════════════════
-- Ships ENABLED: the alumni president is the reason this feature exists. The admin can
-- revoke it in the Officers grid, and the row is what that toggle writes.
insert into public.officer_grants (seat, permission, enabled)
values ('alumni_president', 'eboard.manage', true)
on conflict (seat, permission) do nothing;

-- ═══ 5) Officer write access — columns FIRST, then policies ════════════════════════════
-- Order matters. Adding the policies below without this revoke would, for the length of
-- one migration, let a granted officer PATCH `id` or `created_at` on any title row.
--
-- authenticated keeps the seven real columns because the ADMIN is `authenticated` too —
-- is_admin() reads the JWT email, it does not change the Postgres role. Revoking these
-- outright would break the admin console's own title editor. `id` and `created_at` are
-- withheld from everyone.
--
-- anon loses write entirely. It has no write policy and never should; this closes the
-- dormant grant permanently rather than leaving it one policy away from live.
revoke insert, update on public.brother_titles from anon, authenticated;
revoke delete on public.brother_titles from anon;
grant insert (brother_id, title, term, scope, sort, board_id)
  on public.brother_titles to authenticated;
grant update (brother_id, title, term, scope, sort, board_id)
  on public.brother_titles to authenticated;

-- bt_admin_all (FOR ALL, is_admin()) is left exactly as it is. These are additional
-- permissive policies — Postgres ORs them — so the admin's path is untouched and an
-- officer's is new. Three separate policies rather than one FOR ALL: a future migration
-- that wants to take DELETE back can drop one line.
drop policy if exists bt_officer_insert on public.brother_titles;
create policy bt_officer_insert on public.brother_titles
  for insert with check (public.officer_can('eboard.manage'));

drop policy if exists bt_officer_update on public.brother_titles;
create policy bt_officer_update on public.brother_titles
  for update using       (public.officer_can('eboard.manage'))
          with check     (public.officer_can('eboard.manage'));

drop policy if exists bt_officer_delete on public.brother_titles;
create policy bt_officer_delete on public.brother_titles
  for delete using (public.officer_can('eboard.manage'));

-- ═══ 6) Close the audit gap this migration opens ═══════════════════════════════════════
-- log_titles has been AFTER INSERT OR DELETE since upgrade19. That was complete when the
-- only writer was the admin adding and removing rows. Section 5 creates an UPDATE path
-- for someone who is not the admin, so an edit — re-terming a seat, moving it to another
-- board, renaming the office — would be the one title write nobody could see.
-- tg_log_activity()'s brother_titles branch already handles it; only the trigger was narrow.
drop trigger if exists log_titles on public.brother_titles;
create trigger log_titles after insert or update or delete on public.brother_titles
  for each row execute function public.tg_log_activity();

-- ═══ 7) Build the boards from the history already on file ══════════════════════════════
-- Guarded on board_id is null throughout, so this is a one-time seed that re-running
-- cannot duplicate — and cannot resurrect a stub you deleted after merging it.
-- A view, not a temp table: the seed runs in two statements (see below) and both need
-- the same reading of "which title rows are history". Defining it once is what keeps
-- them from disagreeing.
--
-- Skipped: titles that describe a seat someone is SITTING IN right now — matched on
-- office AND board, both. That pairing is load-bearing: Johnathan Conway's Spring 2021
-- ACTIVE presidency is real history even though he holds the ALUMNI president seat
-- today. Matching on the office alone would have erased it.
--
-- 'previous' is not a board — it means "no longer sitting" — so it resolves to the
-- active board, where an undergraduate officer served. Only an explicit 'alumni' makes
-- an alumni board.
--
-- A bare '2023' (John Cassar) has no semester and becomes FALL 2023. That is a GUESS,
-- the only one in this migration; the report says so and one click fixes it.
-- security_invoker is not decoration: a plain Postgres view runs as its OWNER and so
-- BYPASSES RLS on the table beneath it. This one is dropped four statements later, but
-- if the migration ever fails in between it would be left sitting in `public` as an
-- RLS-free window onto brother_titles. One keyword closes that.
create or replace view public._upgrade50_seed with (security_invoker = on) as
  select t.id,
         case when t.term ilike 'spring%' then 'Spring' else 'Fall' end     as sem,
         substring(t.term from '((?:19|20)\d{2})')::int                     as yr,
         case when t.scope = 'alumni' then 'alumni' else 'active' end       as sc
    from public.brother_titles t
   where t.board_id is null
     and t.term is not null
     and t.term ~ '(19|20)\d{2}'
     and not exists (
       select 1 from public.brothers b
        where b.id = t.brother_id
          and b.role_scope in ('active', 'alumni')
          and b.role = t.title
          and b.role_scope is not distinct from t.scope);

-- Two statements, not one. A data-modifying CTE and the statement around it share a
-- snapshot, so an UPDATE joining to boards INSERTed in its own WITH clause would match
-- nothing and silently attach zero seats. Insert, commit the statement, then attach.
insert into public.eboards (scope, start_sem, start_year)
select distinct s.sc, s.sem, s.yr
  from public._upgrade50_seed s
 where not exists (
   select 1 from public.eboards e
    where e.scope = s.sc and e.start_sem = s.sem and e.start_year = s.yr);

update public.brother_titles t
   set board_id = e.id
  from public._upgrade50_seed s
  join public.eboards e
    on e.scope = s.sc and e.start_sem = s.sem and e.start_year = s.yr
 where t.id = s.id;

drop view public._upgrade50_seed;

-- Officers above chairs inside a board, and the four in rank order, so the page never
-- has to re-teach the hierarchy. Chairs land at 10.
update public.brother_titles
   set sort = coalesce(
        array_position(array['President', 'Vice-President', 'Treasurer', 'Secretary'], title), 10)
 where board_id is not null;

-- ═══ 8) Assert what this migration exists to guarantee ═════════════════════════════════
do $$
declare bad text; n int;
begin
  -- (a) THE one that matters. If a future migration ever teaches my_officer_seat() to
  --     read brother_titles, this feature turns into a self-promotion button and this
  --     line is what stops it shipping.
  if pg_get_functiondef('public.my_officer_seat()'::regprocedure) ilike '%brother_titles%' then
    raise exception 'my_officer_seat() now reads brother_titles — eboard.manage would become a privilege-escalation path';
  end if;

  -- (b) The BEHAVIOURAL proof of (a) is deliberately NOT here. This file runs through the
  --     Management API as superuser, where RLS is bypassed — a probe passing in this
  --     context would prove nothing about a real officer's session, which is the only
  --     thing anyone cares about. It also means writing a fake brother into `brothers`,
  --     tripping its triggers and leaving a probe in the audit log.
  --     It runs instead as a real signed-in request in the verification script, against
  --     fabricated fixture rows. See output/2026-08-10-zbxi-eboards/.

  -- (c) anon cannot write titles. This is the dormant grant; if it comes back, so does
  --     the hole that section 5 exists to close.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'brother_titles'
     and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE');
  if bad is not null then
    raise exception 'brother_titles: anon can still % — signed-out visitors must never write history', bad;
  end if;

  -- (d) Nobody may rewrite a row's identity or its timestamp.
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'brother_titles'
     and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and column_name in ('id', 'created_at');
  if bad is not null then
    raise exception 'brother_titles: authenticated can UPDATE %', bad;
  end if;

  -- (d2) The same two checks for eboards. Kept separate and explicit because this
  --      table is NEW, and a new table is exactly where the default-privileges trap
  --      is easiest to miss — it was missed here on the first pass.
  select coalesce(string_agg(distinct privilege_type, ', '), null) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'eboards'
     and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE');
  if bad is not null then
    raise exception 'eboards: anon can still % — default privileges were not revoked', bad;
  end if;

  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'eboards'
     and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
     and column_name in ('id', 'created_at', 'rank');
  if bad is not null then
    raise exception 'eboards: authenticated can write %; identity columns must never be writable', bad;
  end if;

  -- (e) Title edits are recorded. Without this the audit gap reopens silently the next
  --     time someone re-emits the trigger from an older migration.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.brother_titles'::regclass and tgname = 'log_titles'
       and pg_get_triggerdef(oid) ilike '%UPDATE%'
  ) then
    raise exception 'log_titles does not fire on UPDATE; title edits would go unrecorded';
  end if;

  -- (f) The four officer spellings are canonical, so the derived officer/chair split works.
  select string_agg(distinct title, ', ') into bad
    from public.brother_titles
   where lower(btrim(title)) in ('president', 'vice president', 'vice-president', 'treasurer', 'secretary')
     and title not in ('President', 'Vice-President', 'Treasurer', 'Secretary');
  if bad is not null then
    raise exception 'non-canonical officer titles remain: %', bad;
  end if;

  -- (g) Every board holds at least one seat. An empty board is a card that says nothing.
  select count(*) into n from public.eboards e
   where not exists (select 1 from public.brother_titles t where t.board_id = e.id);
  if n > 0 then
    raise notice 'upgrade50: % board(s) currently hold no seats (expected only if you emptied one by hand)', n;
  end if;

  -- (h) The permission exists and is on.
  if not exists (select 1 from public.officer_grants
                  where seat = 'alumni_president' and permission = 'eboard.manage' and enabled) then
    raise exception 'eboard.manage is not enabled for alumni_president';
  end if;
end $$;

-- Column privileges and new tables are both part of PostgREST's cached schema; without
-- this the API keeps enforcing the old grants and cannot see eboards at all.
notify pgrst, 'reload schema';
