-- upgrade61.sql — an RSVP stops being one bit: how many are you bringing, and anything
-- the man at the door needs to know.
--
-- THE PROBLEM. event_rsvps is (event_id, user_id, created_at) and nothing else, so the
-- calendar can say "12 going" and cannot say how many people to cater for. For the Reunion
-- the digest already goes out of its way to handle, the brother hosting it needs a real
-- headcount — wives, kids, a partner in from out of town — and a list he can print and
-- stand at the door with.
--
-- ── THE TABLE COULD NOT EXPRESS A CHANGE AT ALL ──────────────────────────────────────
-- upgrade5 gave event_rsvps a SELECT, an INSERT and a DELETE policy. No UPDATE policy has
-- ever existed. So "I'm bringing two" was not a slow path or an awkward path — it was
-- impossible: the only way to change an RSVP was to delete it and make a new one. This adds
-- the missing UPDATE policy, scoped to your own row.
--
-- ── AND THE TABLE IS WIDE OPEN TO anon TODAY ─────────────────────────────────────────
-- Checked against information_schema before writing this, not assumed:
--     anon           -> DELETE, INSERT, SELECT, UPDATE
--     authenticated  -> DELETE, INSERT, SELECT, UPDATE
-- That is Supabase's `grant all` default, never narrowed since the table was created on
-- 2026-07-08. It is not exploitable today — every policy requires user_id = auth.uid() and
-- anon's auth.uid() is NULL — but the only thing between a signed-out visitor and this
-- table is one policy being careless about NULL. anon has no business writing here at all.
--
-- The narrowing on `authenticated` matters more now than it did before: without a column
-- list, the new UPDATE policy would let a brother PATCH event_id or user_id — re-pointing
-- his own RSVP row onto another brother, or onto another event. Postgres checks column
-- privileges BEFORE any policy runs, so the grant below refuses that outright (42501)
-- rather than relying on the browser to send only two fields.
--
-- Idempotent: safe to re-run.

-- ═══ 1) The two columns ══════════════════════════════════════════════════════════════
alter table public.event_rsvps
  add column if not exists guests int not null default 0;

alter table public.event_rsvps
  add column if not exists note text;

comment on column public.event_rsvps.guests is
  'How many people this brother is bringing BESIDES himself. 0 = just him. The door total '
  'is therefore count(*) + sum(guests) (upgrade61).';
comment on column public.event_rsvps.note is
  'One optional line for the door: "+ wife and 2 kids", "arriving late" (upgrade61).';

-- 20 is not a real limit on a family, it is a limit on a typo: a brother meaning to type 2
-- and hitting 22 should be told, and nobody brings 21 guests to a chapter meeting without
-- speaking to somebody first. Bounded on BOTH sides — a negative guest count would quietly
-- subtract from the headcount the host caters from.
alter table public.event_rsvps drop constraint if exists event_rsvps_guests_sane;
alter table public.event_rsvps add constraint event_rsvps_guests_sane
  check (guests >= 0 and guests <= 20);

-- `note is null or ...` is spelled out. A CHECK that evaluates to NULL PASSES, so a bare
-- length test would read as a guard on an empty note while being a guard on nothing.
alter table public.event_rsvps drop constraint if exists event_rsvps_note_len;
alter table public.event_rsvps add constraint event_rsvps_note_len
  check (note is null or char_length(note) <= 140);

-- ═══ 2) The UPDATE policy that never existed ═════════════════════════════════════════
-- Your own row, and only your own — in USING (which row you may touch) and in WITH CHECK
-- (what it may look like afterwards). Spelling out WITH CHECK rather than letting Postgres
-- reuse USING is the same discipline upgrade41 wrote down: they happen to be identical
-- here, and relying on that is a trap for the next migration.
--
-- The admin is deliberately NOT given a way to edit another brother's guest count. The door
-- list is a report; if a count is wrong the man who typed it fixes it, and nobody has to
-- wonder why their RSVP says something they did not write.
drop policy if exists rsvps_own_update on public.event_rsvps;
create policy rsvps_own_update on public.event_rsvps
  for update using       (user_id = auth.uid())
             with check  (user_id = auth.uid());

-- ═══ 3) Narrow the write surface ═════════════════════════════════════════════════════
revoke insert, update, delete on public.event_rsvps from anon;
revoke update on public.event_rsvps from authenticated;
grant  update (guests, note) on public.event_rsvps to authenticated;

-- ═══ 4) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare bad text; def text;
begin
  -- (a) anon cannot write here at all any more. It keeps SELECT, which RLS makes empty,
  --     consistently with every other table on this site.
  select string_agg(distinct privilege_type, ', ' order by privilege_type) into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'event_rsvps' and grantee = 'anon'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'event_rsvps: anon still holds % — a signed-out visitor must not write here', bad;
  end if;

  -- (b) A brother may change exactly two columns. event_id and user_id must stay out of
  --     this list or an RSVP becomes re-pointable at another event, or another brother.
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'event_rsvps'
     and privilege_type = 'UPDATE' and grantee = 'authenticated'
     and column_name not in ('guests', 'note');
  if bad is not null then
    raise exception 'event_rsvps: authenticated can UPDATE %; an RSVP edit touches guests + note only', bad;
  end if;
  if not has_column_privilege('authenticated', 'public.event_rsvps', 'guests', 'UPDATE') then
    raise exception 'authenticated cannot UPDATE guests — changing a guest count is broken';
  end if;

  -- (c) The UPDATE policy exists and is scoped to the brother's own row in BOTH halves.
  select qual || ' || ' || coalesce(with_check, '(no with check)') into def
    from pg_policies where schemaname = 'public' and tablename = 'event_rsvps' and policyname = 'rsvps_own_update';
  if def is null then
    raise exception 'rsvps_own_update is missing — a guest count cannot be changed at all';
  end if;
  if def not like '%auth.uid()%' or def like '%(no with check)%' then
    raise exception 'rsvps_own_update is not scoped to the brother''s own row in both halves: %', def;
  end if;

  -- (d) The guest bound really is a bound, on both sides.
  def := (select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.event_rsvps'::regclass and conname = 'event_rsvps_guests_sane');
  if def is null or def not like '%>= 0%' or def not like '%<= 20%' then
    raise exception 'event_rsvps_guests_sane is not bounded on both sides: %', coalesce(def, '(missing)');
  end if;

  -- (e) The note length check says out loud that NULL is allowed, rather than relying on
  --     a NULL comparison passing by accident.
  def := (select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.event_rsvps'::regclass and conname = 'event_rsvps_note_len');
  if def is null or def not ilike '%note is null%' then
    raise exception 'event_rsvps_note_len no longer states that NULL is allowed: %', coalesce(def, '(missing)');
  end if;
end $$;

notify pgrst, 'reload schema';
