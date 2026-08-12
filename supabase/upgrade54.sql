-- upgrade54.sql — the admin account stops being reachable by an officer.
--
-- THE ASK, in the owner's words: "the alumni president can never delete or edit the webdev
-- (admin) account's details/functions/features/permissions … the admin reigns supreme."
--
-- ── WHAT WAS ALREADY SAFE (do not re-solve this) ──────────────────────────────────────
-- Admin identity cannot be escalated TO. `public.admin_email()` (upgrade14.sql:17) is a
-- FUNCTION BODY, not a row — no RLS to widen, no table grant to hold, no client path to it
-- at all. There is no `is_admin` column anywhere in the schema. `my_officer_seat()` reads
-- only brothers.role / role_scope / status, and tg_guard_status (upgrade45.sql:54) pins all
-- three for every non-admin. `officer_grants` is admin-write-only. An officer therefore
-- cannot promote himself and cannot grant himself a permission. That half is sound and has
-- been live-tested twice (2026-08-05, 2026-08-06 security reviews).
--
-- ── WHAT WAS NOT SAFE, AND IS WHY THIS FILE EXISTS ────────────────────────────────────
-- Not escalation — REACH. Two verbs let an officer write rows that belong to the admin:
--
--   (1) officer_update_brother (upgrade47.sql:110) has NO ROW SCOPE. Its WHERE is only
--       `id = p_id and status in ('verified','pending')`. upgrade47.sql:55-59 says so out
--       loud — "an officer may edit any verified or pending brother, including the
--       webmaster's own row … Left as-is by choice." That choice is now reversed.
--
--   (2) bt_officer_insert / _update / _delete (upgrade50.sql:176-187) are each a bare
--       `officer_can('eboard.manage')` with no row scope and no admin exclusion. An officer
--       could mint a fake title on the webmaster's record, delete a real one, or re-point an
--       existing row ONTO the admin by writing brother_id.
--
-- Both were LIVE, not theoretical: alumni_president holds members.edit AND eboard.manage
-- today, and the admin has exactly one brothers row. (Zero title rows, so there was nothing
-- to delete yet — but a fabricated one would have rendered on his profile card.)
--
-- ── THE SHAPE OF THE FIX ──────────────────────────────────────────────────────────────
-- One helper function, named once and reused, so "which row is the admin's" has a single
-- definition that a future migration cannot drift from. SECURITY DEFINER because the caller
-- is an officer who cannot necessarily SELECT the row he is being refused.
--
-- The admin himself is never blocked by any of this: every guard is written
-- `is_admin() or not is_admin_brother(...)`, so the webmaster keeps full control of his own
-- record. The officer keeps every legitimate power he has on every OTHER brother — that is
-- asserted at the bottom, because a lock that also breaks his real job is a bug, not a fix.

-- ═══ 1) The single definition of "this row belongs to the admin" ══════════════════════
create or replace function public.is_admin_brother(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.brothers b
     where b.id = p_id
       and lower(coalesce(b.email, '')) = lower(public.admin_email())
  )
$$;

revoke all on function public.is_admin_brother(uuid) from public, anon;
grant execute on function public.is_admin_brother(uuid) to authenticated;

comment on function public.is_admin_brother(uuid) is
  'True when this brothers row is the webmaster''s. The single source of truth for the '
  'admin-supremacy boundary (upgrade54) — officer verbs and brother_titles policies all '
  'consult this one function rather than re-deriving the rule.';

-- The browser needs to know WHICH roster row is the webmaster's so the officer console can
-- drop its Edit button and say why. It cannot work this out on its own: family_public — the
-- only brothers source an officer can read — exposes no email column (id, full_name, big_id,
-- pledge_class, role, role_term, role_scope, grad_year, registered), by design.
--
-- Disclosure check before adding this: it returns an id that is ALREADY in family_public for
-- every signed-in brother, and the row is literally named "WebDev". It reveals no address and
-- no new row — only which of the visible rows is the admin's. The alternative (one
-- is_admin_brother() round-trip per rendered row) would leak exactly the same fact more
-- slowly. Signed-in brothers only; anon has no execute.
create or replace function public.admin_brother_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id from public.brothers b
   where lower(coalesce(b.email, '')) = lower(public.admin_email())
   limit 1
$$;

revoke all on function public.admin_brother_id() from public, anon;
grant execute on function public.admin_brother_id() to authenticated;

-- ═══ 2) officer_update_brother — refuse the admin's row, loudly ═══════════════════════
-- Reproduced verbatim from upgrade47 except for the one new block marked below. The guard
-- is placed right after the permission gate, NOT folded into the UPDATE's WHERE: a row
-- count of 0 would surface as "no such brother, or his record is not editable", which is a
-- misleading thing to tell someone who is looking straight at the brother. He should be
-- told the rule.
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

  -- ▼ upgrade54: the admin-supremacy boundary. The webmaster editing his OWN record still
  --   passes (is_admin() short-circuits); an officer aimed at it is refused by name.
  if not public.is_admin() and public.is_admin_brother(p_id) then
    raise exception 'that record belongs to the site administrator and only he can edit it';
  end if;
  -- ▲

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

-- ═══ 3) brother_titles — an officer's eboard.manage stops at the admin's row ══════════
-- bt_admin_all (upgrade19.sql:40, FOR ALL is_admin()) is untouched, so the webmaster keeps
-- full control. These three only ever narrow the OFFICER's path.
--
-- On _update the exclusion goes in BOTH using and with check, and that is the whole point:
-- `using` stops him editing a row that already belongs to the admin, `with check` stops him
-- re-pointing somebody else's row ONTO the admin by writing brother_id. One without the
-- other is a hole that looks closed.
drop policy if exists bt_officer_insert on public.brother_titles;
create policy bt_officer_insert on public.brother_titles
  for insert with check (
    public.officer_can('eboard.manage')
    and not public.is_admin_brother(brother_id)
  );

drop policy if exists bt_officer_update on public.brother_titles;
create policy bt_officer_update on public.brother_titles
  for update using       (public.officer_can('eboard.manage')
                          and not public.is_admin_brother(brother_id))
          with check     (public.officer_can('eboard.manage')
                          and not public.is_admin_brother(brother_id));

drop policy if exists bt_officer_delete on public.brother_titles;
create policy bt_officer_delete on public.brother_titles
  for delete using (
    public.officer_can('eboard.manage')
    and not public.is_admin_brother(brother_id)
  );

-- ═══ 4) site_settings — take the write grant back off anon ════════════════════════════
-- Found by reading information_schema rather than the migration files: anon holds
-- INSERT, UPDATE and DELETE on site_settings. upgrade5 created the table and never revoked
-- Supabase's default privileges (`alter default privileges in schema public grant all on
-- tables to anon, authenticated`), so a table born in 2026 is still carrying them. Nothing
-- is exploitable today — RLS has no permissive write policy for anon — but a settings table
-- writable by a signed-out visitor at the grant layer is one careless policy from being
-- writable in fact. This is the same trap upgrade49, upgrade50 and upgrade52 each hit.
revoke insert, update, delete on public.site_settings from anon;

-- ── WHY `authenticated` KEEPS ITS WRITE ON site_settings AND officer_grants ───────────
-- Because THE ADMIN IS `authenticated`. Admin is a JWT-email check (is_admin()), not a
-- Postgres role — the webmaster signs in through the same client as everyone else and
-- arrives as `authenticated` like every brother. `revoke insert, update, delete on
-- public.officer_grants from authenticated` would therefore lock the webmaster out of the
-- permission matrix he is the only person allowed to use, and it would fail as a silently
-- broken console rather than a loud error. RLS is the real gate on both tables and it is
-- correct: officer_grants is `is_admin()` for write, site_settings likewise.
-- LEFT AS-IS DELIBERATELY. Do not "tidy" this in a later migration.

-- ═══ 5) Assertions — every one of these is a claim this file would be wrong without ════
do $$
declare
  admin_id uuid;
  n int;
begin
  -- (a) The helper actually finds the admin. If the webmaster has no brothers row this
  --     whole migration is inert, and that is worth failing loudly over rather than
  --     shipping a boundary that silently protects nobody.
  select b.id into admin_id from public.brothers b
   where lower(coalesce(b.email, '')) = lower(public.admin_email());
  if admin_id is null then
    raise exception 'no brothers row matches admin_email() — the admin boundary would protect nothing';
  end if;
  if not public.is_admin_brother(admin_id) then
    raise exception 'is_admin_brother() does not recognise the admin row';
  end if;
  if public.admin_brother_id() is distinct from admin_id then
    raise exception 'admin_brother_id() disagrees with is_admin_brother() — the console would guard the wrong row';
  end if;
  -- anon must not be able to ask. It is a small fact, but it is not a public one.
  if has_function_privilege('anon', 'public.admin_brother_id()', 'execute') then
    raise exception 'anon can execute admin_brother_id()';
  end if;

  -- (b) …and does NOT fire on an ordinary brother. A helper that returned true for
  --     everyone would "pass" (a) and lock the officer out of his entire job.
  select b.id into admin_id from public.brothers b
   where b.status = 'verified'
     and lower(coalesce(b.email, '')) is distinct from lower(public.admin_email())
   limit 1;
  if admin_id is not null and public.is_admin_brother(admin_id) then
    raise exception 'is_admin_brother() returns true for an ordinary brother — the lock is far too wide';
  end if;

  -- (c) All three officer policies on brother_titles consult the helper. Catches the
  --     failure where one of the three is edited later and quietly loses its exclusion.
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'brother_titles'
     and policyname in ('bt_officer_insert', 'bt_officer_update', 'bt_officer_delete')
     and coalesce(qual, '') || coalesce(with_check, '') like '%is_admin_brother%';
  if n <> 3 then
    raise exception 'expected 3 brother_titles officer policies guarded by is_admin_brother, found %', n;
  end if;

  -- (d) bt_update carries the guard on BOTH sides. `using` alone still lets an officer
  --     re-point another brother's title row onto the admin.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'brother_titles'
       and policyname = 'bt_officer_update'
       and qual like '%is_admin_brother%' and with_check like '%is_admin_brother%'
  ) then
    raise exception 'bt_officer_update must guard both USING and WITH CHECK';
  end if;

  -- (e) The admin's own path is untouched.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'brother_titles' and policyname = 'bt_admin_all'
  ) then
    raise exception 'bt_admin_all is missing — the admin has lost his own write path';
  end if;

  -- (f) anon cannot write site_settings at the grant layer any more.
  select count(*) into n
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'site_settings'
     and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if n <> 0 then
    raise exception 'anon still holds % write grants on site_settings', n;
  end if;

  -- (g) …and authenticated still DOES, because the admin is authenticated. This assertion
  --     exists to fail a future migration that over-tidies section 4 and locks the
  --     webmaster out of his own console.
  select count(*) into n
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'officer_grants'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if n = 0 then
    raise exception 'authenticated lost UPDATE on officer_grants — the ADMIN signs in as authenticated, so this breaks the permission matrix';
  end if;
end $$;

notify pgrst, 'reload schema';
