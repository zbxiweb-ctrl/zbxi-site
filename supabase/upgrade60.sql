-- upgrade60.sql — the gallery learns WHEN a photo was taken, and WHO is in it.
--
-- Two features, one migration, because they touch the same table and ship together.
--
-- ── 1) taken_year ────────────────────────────────────────────────────────────────────
-- created_at is the UPLOAD date. The day an alum digitises a shoebox of 1997 formals they
-- all land above last week's tailgate, and thirty years of chapter history reads backwards.
-- One optional YEAR fixes that. Deliberately a year and not a date: nobody knows the day a
-- 1997 photo was taken, and the upload date already covers anything recent. A month can be
-- added later if a brother ever asks for one — none has.
--
-- The grid ORDER is unchanged (owner's call). The year drives a decade filter, which is how
-- an archive gets browsed; it does not silently re-sort photos anyone has already seen.
--
-- ── 2) gallery_tags ──────────────────────────────────────────────────────────────────
-- Thirty years of photos are searchable by nothing but album name and upload date. Tagging
-- is what turns them into an index of the chapter.
--
-- THE DESIGN CHOICE THAT MATTERS: a tag points at a BROTHERS row, not at an auth account.
-- 246 of the 359 verified brothers never signed up, and they are exactly the men in the old
-- photos. Tagging only account-holders would index the last two years and nothing before it.
-- A brother with no account simply gets no notification — there is nowhere to send it.
--
-- ── WHY THE GRANTS COME FIRST, EVERY TIME ────────────────────────────────────────────
-- A new Supabase table is born with `grant all` to anon AND authenticated. A narrow grant
-- written afterwards is an ADDITIVE no-op — it grants nothing that wasn't already there and
-- reads like a lock while being none. So: revoke from all three roles first, then grant the
-- three verbs this table actually needs, then assert the result against the catalog.
--
-- ── AND THE OTHER TRAP: A POLICY SEES ONLY WHAT ITS CALLER SEES ──────────────────────
-- The first version of the insert policy checked `exists (select 1 from brothers …)`. It
-- passed every test run as the table owner and refused EVERY tag from EVERY brother on the
-- live site, because `brothers` is readable only by its own owner and the admin. The rule
-- now reads family_public — see the note on that policy. Written down because it is
-- invisible: the migration applies cleanly and the feature is simply dead.
--
-- Idempotent: safe to re-run.

-- ═══ 1) taken_year ═══════════════════════════════════════════════════════════════════
alter table public.gallery_posts
  add column if not exists taken_year int;

comment on column public.gallery_posts.taken_year is
  'The year the PHOTO was taken, when a brother knows it. NULL = unknown; created_at is '
  'the upload date and always exists. Drives the decade filter in the gallery (upgrade60).';

-- `taken_year is null or ...` is spelled out rather than implied. A CHECK that evaluates to
-- NULL PASSES, so an unqualified bound would look like a guard on an undated photo while
-- being one on nothing. NULL is legal here and says so out loud.
-- The upper bound is a fixed literal, not current_date: Postgres rejects a non-IMMUTABLE
-- function in a CHECK, and the "not in the future" limit is enforced by the year dropdown,
-- which is built from the current year and offers nothing beyond it.
alter table public.gallery_posts drop constraint if exists gallery_posts_taken_year_sane;
alter table public.gallery_posts add constraint gallery_posts_taken_year_sane
  check (taken_year is null or (taken_year >= 1990 and taken_year <= 2100));

-- THE PART THAT IS EASY TO FORGET. upgrade43 replaced Supabase's table-wide INSERT with a
-- COLUMN list — (author_user, image_path, caption, album_id) — so a brand-new column is not
-- writable from a browser by default. Without these two lines the year dropdown would 42501
-- on every save, and only on the live site.
grant insert (taken_year), update (taken_year) on public.gallery_posts to authenticated;

-- ═══ 2) gallery_tags ═════════════════════════════════════════════════════════════════
create table if not exists public.gallery_tags (
  post_id    uuid not null references public.gallery_posts(id) on delete cascade,
  brother_id uuid not null references public.brothers(id)      on delete cascade,
  tagged_by  uuid not null references auth.users(id)           on delete cascade,
  created_at timestamptz not null default now(),
  -- The same man cannot be tagged twice in one photo. This is the dedupe, and it is why
  -- the browser does not need one: a double-tap is refused by the primary key.
  primary key (post_id, brother_id)
);

comment on table public.gallery_tags is
  'Who is in a photo. Points at brothers.id (the ROSTER), not auth.users — the men in the '
  'old photos mostly have no account. Tagged by any approved brother (upgrade60).';

-- The "photos of one brother" lookup reads by brother_id, which is not the leading column
-- of the primary key.
create index if not exists gallery_tags_brother_idx on public.gallery_tags (brother_id);

alter table public.gallery_tags enable row level security;

-- Grants BEFORE policies — see the header. anon gets nothing at all: it cannot even read
-- this table, which is a step tighter than gallery_posts (where anon keeps a SELECT that RLS
-- makes empty). There is no reason for a signed-out visitor to learn who is in a photo he
-- cannot see.
revoke all on public.gallery_tags from public, anon, authenticated;
grant select, insert, delete on public.gallery_tags to authenticated;
-- No UPDATE, to anybody. A tag is not a thing you edit — it is added or removed. There is
-- deliberately no UPDATE policy either, so both layers say the same thing.

drop policy if exists gtags_member_read on public.gallery_tags;
create policy gtags_member_read on public.gallery_tags
  for select using (public.is_approved_brother() or public.is_admin());

-- Any approved brother may tag — the poster often does not know every face in a 1997 photo,
-- and an index built only by uploaders is an index of nothing. Always as himself
-- (tagged_by = auth.uid()), and only onto a VERIFIED roster row: a pending or rejected row
-- is not a brother yet and must not be nameable in the gallery.
--
-- ── THE TRAP, WRITTEN DOWN ───────────────────────────────────────────────────────────
-- "verified" is checked against family_public, NOT against brothers. A policy's subquery
-- runs with the CALLER's privileges, and `brothers` is readable only by its owner and the
-- admin (brothers_own_read / brothers_admin_read) — everyone else reads the roster through
-- a view. So `exists (select 1 from brothers …)` is FALSE for every ordinary brother, and
-- an insert policy built on it refuses every tag on the live site while passing every test
-- run as the table owner. Caught here by probing as a real brother before shipping.
--
-- family_public is the right object anyway: it bypasses RLS by design, it contains exactly
-- the verified brothers, and the rule now reads the way the feature is described —
-- you can tag anyone who appears on the family tree.
drop policy if exists gtags_member_insert on public.gallery_tags;
create policy gtags_member_insert on public.gallery_tags
  for insert with check (
    tagged_by = auth.uid()
    and (public.is_approved_brother() or public.is_admin())
    and exists (select 1 from public.family_public f where f.id = brother_id)
  );

-- Five ways a tag comes off, and each one is somebody with a real claim to it:
--   the brother who added it        — his own mistake to undo
--   the brother who IS tagged       — the most important one. "That isn't me" / "take me off
--                                     this" must never require finding whoever tagged him.
--   the brother who posted the photo
--   the admin
--   an officer with gallery.moderate — the same seat that already moderates posts+comments
--
-- Both subqueries below read tables the caller genuinely CAN read, which is why they work
-- where the insert check could not: brothers_own_read lets a brother see his own row (and
-- only his own — which is exactly the row this asks about), and gposts_member_read lets any
-- approved brother see every post.
drop policy if exists gtags_remove on public.gallery_tags;
create policy gtags_remove on public.gallery_tags
  for delete using (
    tagged_by = auth.uid()
    or public.is_admin()
    or public.officer_can('gallery.moderate')
    or exists (select 1 from public.brothers b       where b.id = brother_id and b.user_id = auth.uid())
    or exists (select 1 from public.gallery_posts p  where p.id = post_id    and p.author_user = auth.uid())
  );

-- ═══ 3) "You were tagged" — a bell, not an email ═════════════════════════════════════
-- claim_notify_mail (upgrade59) only ever mails connect_request and mentor_request, so this
-- kind is bell-only by construction and no email code changes. That is the right call: a
-- tag is pleasant, not urgent, and a photo-heavy weekend must not become an inbox.
create or replace function public.tg_notify_tag()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tagged_user uuid;
begin
  select user_id into tagged_user from public.brothers where id = new.brother_id;
  -- No account -> nowhere to send it, and that is the majority of the roster. Never notify
  -- the man who did the tagging about his own tag.
  if tagged_user is not null and tagged_user <> new.tagged_by then
    insert into public.notifications (recipient, kind, payload)
    values (tagged_user, 'photo_tag',
            jsonb_build_object('post_id', new.post_id,
                               'actor',   public.member_name(new.tagged_by)));
  end if;
  return new;
end;
$$;

drop trigger if exists notify_tag on public.gallery_tags;
create trigger notify_tag after insert on public.gallery_tags
  for each row execute function public.tg_notify_tag();

-- NOT added to activity_log, deliberately. upgrade40 keeps ONE writer for that table and
-- says so; adding a branch means re-emitting the whole dispatcher for something already
-- visible on the photo itself. Recorded here so a later session does not "fix" the omission.

-- ═══ 4) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare bad text; n int;
begin
  -- (a) anon holds NOTHING on gallery_tags. Not select, not anything.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'gallery_tags' and grantee = 'anon';
  if bad is not null then
    raise exception 'gallery_tags: anon holds % — a signed-out visitor must not touch this table', bad;
  end if;

  -- (b) authenticated holds EXACTLY select, insert, delete. An UPDATE creeping back in is
  --     how "who is in this photo" quietly becomes editable to point at someone else.
  select string_agg(distinct privilege_type, ', ' order by privilege_type) into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'gallery_tags' and grantee = 'authenticated'
     and privilege_type not in ('SELECT', 'INSERT', 'DELETE');
  if bad is not null then
    raise exception 'gallery_tags: authenticated also holds % — a tag is added or removed, never edited', bad;
  end if;
  if not has_table_privilege('authenticated', 'public.gallery_tags', 'INSERT') then
    raise exception 'authenticated cannot INSERT gallery_tags — tagging is broken';
  end if;

  -- (c) RLS is on. A table with policies and RLS disabled is wide open and looks locked.
  if not (select relrowsecurity from pg_class where oid = 'public.gallery_tags'::regclass) then
    raise exception 'gallery_tags: row level security is OFF';
  end if;

  -- (d) All three policies are present, and there is no UPDATE policy.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'gallery_tags';
  if n <> 3 then
    raise exception 'gallery_tags: expected 3 policies (read/insert/delete), found %', n;
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='gallery_tags' and cmd = 'UPDATE') then
    raise exception 'gallery_tags: an UPDATE policy exists — a tag must not be editable';
  end if;

  -- (e) The tagged brother can always take himself off. This is the clause a later "tidy" is
  --     most likely to drop, and losing it means asking a stranger to untag you.
  if (select qual from pg_policies where schemaname='public' and tablename='gallery_tags' and policyname='gtags_remove')
     not ilike '%user_id = auth.uid()%' then
    raise exception 'gtags_remove no longer lets the tagged brother remove himself';
  end if;

  -- (e2) The insert check reads family_public, not brothers. Pointing it back at `brothers`
  --      refuses every tag from every ordinary brother — silently, and only on the live
  --      site, because the owner running a migration can read that table just fine.
  if (select with_check from pg_policies where schemaname='public' and tablename='gallery_tags' and policyname='gtags_member_insert')
     not ilike '%family_public%' then
    raise exception 'gtags_member_insert no longer checks family_public — ordinary brothers cannot read public.brothers, so tagging would be refused for everyone';
  end if;

  -- (f) The notification trigger exists.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.gallery_tags'::regclass and tgname = 'notify_tag') then
    raise exception 'notify_tag trigger missing — nobody would ever learn they were tagged';
  end if;

  -- (g) taken_year: NULL is explicitly allowed (a CHECK that evaluates to NULL passes, so
  --     this must be stated, not implied), and the bounds are real.
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.gallery_posts'::regclass and conname = 'gallery_posts_taken_year_sane')
     not ilike '%taken_year is null%' then
    raise exception 'gallery_posts_taken_year_sane no longer states that NULL is allowed';
  end if;

  -- (h) A brother can actually SAVE a year. Both verbs — the composer inserts it, the edit
  --     form updates it. This is the failure that would only appear on the live site.
  if not has_column_privilege('authenticated', 'public.gallery_posts', 'taken_year', 'INSERT') then
    raise exception 'authenticated cannot INSERT taken_year — dating a new photo is broken';
  end if;
  if not has_column_privilege('authenticated', 'public.gallery_posts', 'taken_year', 'UPDATE') then
    raise exception 'authenticated cannot UPDATE taken_year — dating an old photo is broken';
  end if;

  -- (i) The rest of gallery_posts is still locked. This supersedes upgrade43's identical
  --     check, widened by exactly one column — author_user and image_path stay un-writable,
  --     created_at and id stay server-set (upgrade43 fixed a real pin-to-top bug with that).
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'gallery_posts'
     and privilege_type = 'INSERT' and grantee = 'authenticated'
     and column_name not in ('author_user', 'image_path', 'caption', 'album_id', 'taken_year');
  if bad is not null then
    raise exception 'gallery_posts: authenticated can INSERT %; created_at/id must stay server-set', bad;
  end if;

  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'gallery_posts'
     and privilege_type = 'UPDATE' and grantee = 'authenticated'
     and column_name not in ('caption', 'album_id', 'taken_year');
  if bad is not null then
    raise exception 'gallery_posts: authenticated can UPDATE %; an edit touches caption, album and year only', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
