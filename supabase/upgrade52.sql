-- upgrade52.sql — the digest gets something to say, and the chapter gets somewhere to give.
--
-- TWO TABLES, one theme: content the site can carry that nobody has to remember to write.
--
-- (A) digest_notes — the monthly digest builds five sections from DATA (events, jobs, new
--     brothers, milestones, gallery) and has no way to say "the Executive Boards page
--     exists now". Everything shipped this month is invisible to the people it was built
--     for. A note is added when a thing ships; the next REAL digest sweeps up everything
--     unsent, renders it as the first section, and stamps it used. Nothing sends twice and
--     nobody writes a monthly summary from memory.
--
-- (B) donations — the alumni president's Venmo handle, so the alumni fund has a front door.
--
-- ── WHY donations IS ITS OWN TABLE AND NOT A site_settings KEY ────────────────────────
-- site_settings.settings_public_read is `using (true)` — WORLD readable. The Donations
-- page is brothers-only, so putting the handle there would publish it to the open internet
-- while the page that displays it stays behind a login. Different audience, different table.
--
-- ── WHY ONLY THE ADMIN MAY WRITE donations ────────────────────────────────────────────
-- This is a deliberate departure from every other officer power on this site. Everywhere
-- else, widening access to the seat-holder is the right instinct — the alumni president
-- manages events, gallery sections, invitations, and now past boards.
--
-- This column is a PAYMENT DESTINATION. Whoever can edit it decides where the chapter's
-- money lands. One compromised officer account should not be able to redirect donations,
-- and unlike a vandalised board record the damage is not undoable — the money is gone. So
-- the alumni president asks the admin, and the admin changes it. If that proves too slow,
-- it is one predicate to widen, done deliberately rather than by default.
--
-- Idempotent: safe to re-run.
-- ROLLBACK: drop table public.digest_notes; drop table public.donations;

-- ═══ 1) digest_notes ═══════════════════════════════════════════════════════════════════
create table if not exists public.digest_notes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (btrim(title) <> ''),
  body       text,
  link       text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz              -- null = still waiting for the next digest
);
-- The digest's only query: unsent, oldest first.
create index if not exists digest_notes_unsent_idx
  on public.digest_notes (created_at) where sent_at is null;

alter table public.digest_notes enable row level security;

drop policy if exists dnotes_read on public.digest_notes;
create policy dnotes_read on public.digest_notes
  for select using (public.is_approved_brother() or public.is_admin());

drop policy if exists dnotes_admin_write on public.digest_notes;
create policy dnotes_admin_write on public.digest_notes
  for all using (public.is_admin()) with check (public.is_admin());

-- ═══ 2) donations ══════════════════════════════════════════════════════════════════════
-- One row, enforced by the primary key: `id smallint default 1 check (id = 1)` means a
-- second insert collides rather than silently creating a rival config that half the page
-- might read.
create table if not exists public.donations (
  id           smallint primary key default 1 check (id = 1),
  active       boolean not null default false,   -- ships hidden; cannot go live empty
  handle       text,                             -- Venmo handle, no leading @
  display_name text,                             -- whose account it is — the trust anchor
  brother_id   uuid references public.brothers(id) on delete set null,
  blurb        text,
  supports     text[] not null default '{}',
  updated_at   timestamptz not null default now()
);
insert into public.donations (id) values (1) on conflict (id) do nothing;

alter table public.donations enable row level security;

drop policy if exists donations_read on public.donations;
create policy donations_read on public.donations
  for select using (public.is_approved_brother() or public.is_admin());

drop policy if exists donations_admin_write on public.donations;
create policy donations_admin_write on public.donations
  for all using (public.is_admin()) with check (public.is_admin());

-- ═══ 3) Grants — REVOKE FIRST ══════════════════════════════════════════════════════════
-- A new table is NOT born empty: Supabase ships
--   alter default privileges in schema public grant all on tables to anon, authenticated
-- so both tables just gained full-column INSERT/UPDATE/DELETE for both roles, including
-- their id and timestamp columns. Granting narrowly on top of that is a no-op that reads
-- like a lock — exactly the trap upgrade50 shipped with and the audit caught.
--
-- authenticated keeps write on the real columns because the ADMIN is `authenticated` too:
-- is_admin() reads the JWT email, it does not change the Postgres role. The RLS policies
-- above are what restrict it to the admin; these grants stop anyone from touching the
-- identity columns even if a policy is ever widened.
revoke insert, update, delete on public.digest_notes from anon, authenticated;
revoke insert, update, delete on public.donations    from anon, authenticated;
revoke select                 on public.donations    from anon;
revoke select                 on public.digest_notes from anon;

grant select on public.digest_notes to authenticated;
grant insert (title, body, link)        on public.digest_notes to authenticated;
grant update (title, body, link, sent_at) on public.digest_notes to authenticated;
grant delete on public.digest_notes to authenticated;

grant select on public.donations to authenticated;
grant update (active, handle, display_name, brother_id, blurb, supports, updated_at)
  on public.donations to authenticated;

-- ═══ 4) Assertions ═════════════════════════════════════════════════════════════════════
do $$
declare bad text;
begin
  -- (a) The handle must not be world-readable. This is the whole reason it is not a
  --     site_settings key; if anon regains SELECT the page's privacy is a fiction.
  if has_table_privilege('anon', 'public.donations', 'SELECT') then
    raise exception 'anon can SELECT donations — the Venmo handle would be public';
  end if;

  -- (b) Nobody may write the payment destination except through an is_admin() policy.
  --     Checked as a GRANT here; the policy is the second lock and is asserted live in
  --     the verification script under a real brother's identity.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'donations'
     and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'anon can % donations — a payment target must never be anon-writable', bad;
  end if;

  -- (c) Identity columns are not writable by anyone. `id` is what keeps donations to a
  --     single row; created_at is the note ordering the digest depends on.
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('donations', 'digest_notes')
     and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
     and column_name in ('id', 'created_at');
  if bad is not null then
    raise exception 'identity columns are writable: %', bad;
  end if;

  -- (d) Exactly one donations row, and the CHECK that keeps it that way.
  if (select count(*) from public.donations) <> 1 then
    raise exception 'donations must hold exactly one row, found %', (select count(*) from public.donations);
  end if;

  -- (e) It ships hidden. A page that went live with an empty handle would show brothers a
  --     blank place to send money.
  if exists (select 1 from public.donations where active and coalesce(btrim(handle), '') = '') then
    raise exception 'donations is active with no handle set';
  end if;
end $$;

notify pgrst, 'reload schema';
