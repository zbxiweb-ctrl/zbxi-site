-- upgrade41.sql — open the gallery to every brother
--
-- WHY: the gallery was a broadcast board, not a shared album. upgrade20 narrowed
-- posting to `is_admin() or officer_can('gallery.post')`, so of 358 verified
-- brothers exactly two accounts could post: the admin and the Alumni President.
-- And no UPDATE policy existed on gallery_posts at all, so a typo in a caption was
-- permanent for everyone including the admin.
--
-- AFTER: any approved brother may post, edit his own post, and delete his own post.
-- The admin and a seat holding 'gallery.moderate' keep the power to edit or delete
-- ANYONE's — same shape as polls (upgrade38), which brothers already own themselves.
--
-- Editing is deliberately limited to caption + album, and that limit is enforced by
-- COLUMN GRANTS, not by the UI and not by RLS. RLS can't restrict columns, so
-- without this a gallery moderator could re-point a post at a different image or
-- re-attribute it to another brother. See section 3.
--
-- Idempotent: safe to re-run.
--
-- ROLLBACK (re-lock the gallery): re-apply upgrade20's INSERT predicate
--   (author_user = auth.uid() and (public.is_admin() or public.officer_can('gallery.post')))
-- and re-insert the officer_grants row ('alumni_president','gallery.post',true).

-- 1) INSERT — back to the original upgrade3 predicate: any approved brother, and
--    only ever as himself (author_user = auth.uid()).
drop policy if exists gposts_member_insert on public.gallery_posts;
create policy gposts_member_insert on public.gallery_posts
  for insert with check (
    author_user = auth.uid()
    and (public.is_approved_brother() or public.is_admin())
  );

-- 2) UPDATE — new. Predicate mirrors gposts_own_delete (upgrade17) exactly, so
--    "who may edit this" and "who may delete this" read identically and can't
--    drift apart. WITH CHECK is spelled out rather than left to default: Postgres
--    reuses USING as the check when WITH CHECK is omitted, which happens to be the
--    same expression here, but relying on that is a trap for the next migration.
drop policy if exists gposts_own_update on public.gallery_posts;
create policy gposts_own_update on public.gallery_posts
  for update using      (author_user = auth.uid() or public.is_admin() or public.officer_can('gallery.moderate'))
          with check    (author_user = auth.uid() or public.is_admin() or public.officer_can('gallery.moderate'));

-- 3) Make "an edit may only touch the caption and the album" a fact of the
--    database. Supabase ships `grant all` to anon+authenticated, so today
--    `authenticated` may UPDATE every column of this table — including
--    author_user and image_path. RLS is row-level only and cannot narrow that.
--    Postgres checks column privileges BEFORE any policy runs, so this rejects a
--    crafted PATCH outright (42501) instead of relying on the client to behave.
--    anon loses UPDATE entirely; it has no update policy and never should.
revoke update on public.gallery_posts from anon, authenticated;
grant  update (caption, album_id) on public.gallery_posts to authenticated;

-- 4) Retire the now-meaningless 'gallery.post' grant. Every brother can post, so a
--    switch in Admin -> Officers labelled "Post to the gallery" would do nothing
--    while implying it does something — the worst kind of control to hand a buyer.
--    This DELETE is itself audited (log_grants -> 'grant_disabled').
delete from public.officer_grants where permission = 'gallery.post';

-- 5) Keep the audit trail whole. upgrade40 logs gallery INSERT and DELETE; editing
--    is a new write path and would otherwise be the one gallery action nobody could
--    see. The dispatcher is re-emitted in full (create or replace demands it) with
--    ONE branch changed — gallery_posts now distinguishes tg_op — because upgrade40
--    deliberately keeps a single writer for activity_log. Do not add a second.
create or replace function public.tg_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public          -- pinned: a definer fn without this is a hijack risk
as $$
declare
  rec        record;
  act        text;
  det        text;
  tgt        uuid;
  deleting   boolean := (tg_op = 'DELETE');
begin
  rec := coalesce(new, old);

  if tg_table_name = 'brothers' then
    if deleting then
      act := 'member_deleted'; det := rec.full_name; tgt := rec.id;
    elsif tg_op = 'INSERT' then
      act := 'profile_created'; det := rec.full_name; tgt := rec.id;
    elsif old.status is distinct from new.status then
      -- An approval used to log as a bare 'profile_updated', identical to a
      -- brother editing his own bio. Who was approved or rejected is the single
      -- most useful line in this table, so give it its own action.
      act := case new.status
               when 'verified' then 'member_approved'
               when 'rejected' then 'member_rejected'
               else 'status_changed'
             end;
      det := rec.full_name || ': ' || coalesce(old.status, '?') || ' → ' || coalesce(new.status, '?');
      tgt := rec.id;
    else
      act := 'profile_updated'; det := rec.full_name; tgt := rec.id;
    end if;

  elsif tg_table_name = 'gallery_posts' then
    -- upgrade41: brothers can now edit their own caption/album, so an edit is a
    -- real action and gets its own name rather than looking like a fresh post.
    act := case tg_op when 'INSERT' then 'gallery_post'
                      when 'UPDATE' then 'gallery_post_edited'
                      else 'gallery_post_deleted' end;
    det := left(coalesce(rec.caption, ''), 80); tgt := rec.id;

  elsif tg_table_name = 'gallery_comments' then
    act := 'gallery_comment'; det := left(rec.body, 80); tgt := rec.id;

  elsif tg_table_name = 'forum_threads' then
    act := 'thread_created'; det := left(rec.title, 80); tgt := rec.id;

  elsif tg_table_name = 'forum_replies' then
    act := 'reply_posted'; det := left(rec.body, 80); tgt := rec.id;

  elsif tg_table_name = 'events' then
    act := case tg_op when 'INSERT' then 'event_created'
                      when 'UPDATE' then 'event_updated'
                      else 'event_deleted' end;
    det := left(coalesce(rec.title, ''), 80); tgt := rec.id;

  elsif tg_table_name = 'polls' then
    act := case tg_op when 'INSERT' then 'poll_created'
                      when 'UPDATE' then 'poll_updated'
                      else 'poll_deleted' end;
    det := left(coalesce(rec.question, ''), 80); tgt := rec.id;

  elsif tg_table_name = 'officer_grants' then
    -- NOTE: officer_grants has no id column (PK is seat+permission), so target
    -- stays null here and the pair goes in detail. This is the privilege-change
    -- audit -- the highest-value rows in the table for whoever buys the site.
    act := case when deleting or not coalesce(rec.enabled, false)
                then 'grant_disabled' else 'grant_enabled' end;
    det := rec.seat || ' · ' || rec.permission;
    tgt := null;

  elsif tg_table_name = 'brother_titles' then
    act := case when deleting then 'title_removed' else 'title_granted' end;
    det := coalesce(rec.title, '') || case when coalesce(rec.term, '') <> ''
                                           then ' · ' || rec.term else '' end;
    tgt := rec.brother_id;   -- the brother is the entity affected, not the title row

  elsif tg_table_name = 'gallery_albums' then
    act := case tg_op when 'INSERT' then 'album_created'
                      when 'UPDATE' then 'album_renamed'
                      else 'album_deleted' end;
    det := coalesce(rec.name, ''); tgt := rec.id;

  else
    return coalesce(new, old);   -- unknown table: log nothing, block nothing
  end if;

  -- auth.uid() is NULL when the write comes from service_role (the zbxi-gallery
  -- edge function, or the Management API). Record the action anyway -- a delete
  -- with an unknown actor is still far more than no record at all. The console
  -- renders a null actor as "(server)".
  insert into public.activity_log (user_id, action, detail, target)
  values (auth.uid(), act, det, tgt);

  return coalesce(new, old);     -- AFTER triggers ignore this, but never return NULL
end;
$$;

-- The gallery trigger gains UPDATE. Every other trigger from upgrade40 is
-- unchanged and is not touched here.
drop trigger if exists log_gposts on public.gallery_posts;
create trigger log_gposts after insert or update or delete on public.gallery_posts
  for each row execute function public.tg_log_activity();

-- 6) Assert the two properties this migration exists to create, so a future
--    migration that quietly undoes either one fails right at this line.
do $$
declare bad text;
begin
  -- (a) authenticated may UPDATE caption and album_id, and nothing else.
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'gallery_posts'
     and privilege_type = 'UPDATE' and grantee = 'authenticated'
     and column_name not in ('caption', 'album_id');
  if bad is not null then
    raise exception 'gallery_posts: authenticated can still UPDATE %; an edit must only touch caption + album_id', bad;
  end if;

  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'gallery_posts'
     and privilege_type = 'UPDATE' and grantee = 'anon';
  if bad is not null then
    raise exception 'gallery_posts: anon can UPDATE %; signed-out visitors must never write here', bad;
  end if;

  -- (b) the retired grant has not crept back.
  if exists (select 1 from public.officer_grants where permission = 'gallery.post') then
    raise exception 'officer_grants still carries gallery.post; every brother can post now, so that switch is a lie';
  end if;
end $$;

-- Column privileges are part of PostgREST's cached schema; without this the API
-- keeps enforcing the old table-wide grant until it happens to reload.
notify pgrst, 'reload schema';
