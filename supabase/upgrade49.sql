-- upgrade49.sql — let a brother edit his own board post
--
-- WHY: forum_threads has had SELECT, INSERT and DELETE policies since upgrade3 and
-- NO UPDATE POLICY AT ALL. A brother could delete his post and re-write it, but a
-- typo in a thread title was permanent — for everyone, including the admin. The
-- Introductions composer makes this worse: the intro is the one post every brother
-- writes, it carries where he landed and what he's doing now, and it is exactly the
-- post that goes stale.
--
-- AFTER: a brother may edit the TITLE and BODY of any thread he authored. The admin
-- may too — same predicate as the existing delete policy, so "who may edit this" and
-- "who may delete this" cannot drift apart.
--
-- THE DANGEROUS PART, and why section 2 is not optional:
--   Adding an UPDATE policy WAKES A DORMANT GRANT. Supabase ships `grant all` to
--   anon and authenticated, and this table still carries it — measured before
--   writing this migration:
--       authenticated UPDATE -> author_user, body, category, committee_id,
--                               created_at, id, image_path, tag, title
--       anon          UPDATE -> the same nine columns
--   Those grants are harmless TODAY only because no UPDATE policy exists to let any
--   row through. The instant section 1 lands they become live, and an "edit" could
--   re-point image_path at another brother's photo, move a public thread into a
--   private committee via committee_id, or re-attribute it with author_user. RLS is
--   row-level and cannot restrict columns. Section 2 is the actual guard.
--
-- Idempotent: safe to re-run.
--
-- ROLLBACK: drop policy fthreads_own_update on public.forum_threads;
--           revoke update on public.forum_threads from authenticated;
--           drop trigger log_fthreads on public.forum_threads;
--           create trigger log_fthreads after insert on public.forum_threads
--             for each row execute function public.tg_log_activity();

-- 1) UPDATE — new. Predicate mirrors fthreads_own_delete (upgrade3) exactly.
--    WITH CHECK is spelled out rather than left to default: Postgres reuses USING as
--    the check when WITH CHECK is omitted, which happens to be the same expression
--    here, but relying on that is a trap for the next migration.
--
--    No committee test, deliberately: `author_user = auth.uid()` already limits this
--    to your own rows, and fthreads_member_read decides what you can see. A brother
--    who has left a committee editing his own old post there is not a threat model.
drop policy if exists fthreads_own_update on public.forum_threads;
create policy fthreads_own_update on public.forum_threads
  for update using      (author_user = auth.uid() or public.is_admin())
          with check    (author_user = auth.uid() or public.is_admin());

-- 2) Make "an edit may only touch the title and the body" a fact of the database.
--    Postgres checks column privileges BEFORE any policy runs, so a hand-crafted
--    PATCH carrying image_path or committee_id is rejected outright (42501) rather
--    than relying on the form to omit it.
--    anon loses UPDATE entirely: it has no update policy and never should.
revoke update on public.forum_threads from anon, authenticated;
grant  update (title, body) on public.forum_threads to authenticated;

-- 3) Keep the audit trail whole. log_fthreads has been AFTER INSERT only since
--    upgrade3, so editing would be the one board write nobody could see. The
--    dispatcher is re-emitted in full (create or replace demands it) from
--    upgrade41's version with ONE branch changed — forum_threads now distinguishes
--    tg_op — because upgrade40 deliberately keeps a single writer for activity_log.
--    Do not add a second.
--    DELETE is not added to the trigger here: nothing in this migration creates a
--    new delete path, and logging one is a separate change.
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
    -- upgrade49: editing your own thread is a new write path. Same shape as the
    -- gallery branch above, and for the same reason — an edit must not read as a
    -- fresh post in the console's history.
    act := case tg_op when 'INSERT' then 'thread_created'
                      when 'UPDATE' then 'thread_edited'
                      else 'thread_deleted' end;
    det := left(coalesce(rec.title, ''), 80); tgt := rec.id;

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

-- The board trigger gains UPDATE. Every other trigger from upgrade40/41 is unchanged
-- and is not touched here.
drop trigger if exists log_fthreads on public.forum_threads;
create trigger log_fthreads after insert or update on public.forum_threads
  for each row execute function public.tg_log_activity();

-- 4) Assert the properties this migration exists to create, so a future migration
--    that quietly undoes one fails right at this line.
do $$
declare bad text;
begin
  -- (a) authenticated may UPDATE title and body, and nothing else. This is the one
  --     that matters: image_path, committee_id, category and author_user are all
  --     ways to turn "fix my typo" into something else entirely.
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'forum_threads'
     and privilege_type = 'UPDATE' and grantee = 'authenticated'
     and column_name not in ('title', 'body');
  if bad is not null then
    raise exception 'forum_threads: authenticated can still UPDATE %; an edit must only touch title + body', bad;
  end if;

  -- (b) anon cannot UPDATE anything. Signed-out visitors must never write here.
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'forum_threads'
     and privilege_type = 'UPDATE' and grantee = 'anon';
  if bad is not null then
    raise exception 'forum_threads: anon can UPDATE %; signed-out visitors must never write here', bad;
  end if;

  -- (c) the edit is actually logged. Without this the audit gap reopens silently.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.forum_threads'::regclass
       and tgname = 'log_fthreads'
       and pg_get_triggerdef(oid) ilike '%UPDATE%'
  ) then
    raise exception 'log_fthreads does not fire on UPDATE; thread edits would go unrecorded';
  end if;
end $$;

-- Column privileges are part of PostgREST's cached schema; without this the API
-- keeps enforcing the old table-wide grant until it happens to reload.
notify pgrst, 'reload schema';
