-- upgrade40.sql — an audit trail that covers deletions and privilege changes
--
-- WHY: a chapter event ("Gallery Update") disappeared and nothing in the database
-- could say who removed it or when. Every existing log_* trigger fires on INSERT
-- only (plus brothers UPDATE), so deletion -- the one thing an audit trail exists
-- for -- was invisible. Events, polls, officer grants, titles and albums weren't
-- logged at all, and there was no column identifying WHICH row an entry concerned.
--
-- Design: extend the ONE existing dispatcher, public.tg_log_activity(). No second
-- mechanism, and deliberately still NO insert policy on activity_log -- it can only
-- ever be written by this SECURITY DEFINER trigger, which is what makes the log
-- worth trusting. A client cannot forge or skip an entry.
--
-- Idempotent: safe to re-run.

-- 1) Identify the affected row. Additive and nullable, so existing rows and the
--    existing admin feed keep working untouched.
alter table public.activity_log add column if not exists target uuid;

-- 2) The dispatcher, rewritten to survive DELETE.
--    The old body referenced new.<col> on every branch; on a DELETE trigger `new`
--    is NULL and new.title would raise -- which, in a trigger, would BLOCK the
--    delete itself. Everything below reads from rec := coalesce(new, old).
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
    act := case when deleting then 'gallery_post_deleted' else 'gallery_post' end;
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

-- 3) Attach. Existing triggers are recreated so brothers/gallery_posts also catch
--    DELETE; the rest are new. drop-if-exists first so this file is re-runnable.
drop trigger if exists log_brothers on public.brothers;
create trigger log_brothers after insert or update or delete on public.brothers
  for each row execute function public.tg_log_activity();

drop trigger if exists log_gposts on public.gallery_posts;
create trigger log_gposts after insert or delete on public.gallery_posts
  for each row execute function public.tg_log_activity();

drop trigger if exists log_events on public.events;
create trigger log_events after insert or update or delete on public.events
  for each row execute function public.tg_log_activity();

drop trigger if exists log_polls on public.polls;
create trigger log_polls after insert or update or delete on public.polls
  for each row execute function public.tg_log_activity();

drop trigger if exists log_grants on public.officer_grants;
create trigger log_grants after insert or update or delete on public.officer_grants
  for each row execute function public.tg_log_activity();

drop trigger if exists log_titles on public.brother_titles;
create trigger log_titles after insert or delete on public.brother_titles
  for each row execute function public.tg_log_activity();

drop trigger if exists log_albums on public.gallery_albums;
create trigger log_albums after insert or update or delete on public.gallery_albums
  for each row execute function public.tg_log_activity();

-- Deliberately NOT audited: gallery_likes, poll_votes, event_rsvps,
-- reply_reactions, notifications, email_queue. High volume, no accountability
-- value -- logging them would bury the entries that actually matter.

-- 4) An audit log nobody can read is useless, and one anybody can write is worse.
--    activity_log keeps SELECT-for-admin only: no insert/update/delete policy
--    exists, so PostgREST refuses all three for every client role. Asserted here
--    so a future migration that loosens it fails loudly right at this line.
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'activity_log' and cmd <> 'SELECT';
  if n > 0 then
    raise exception 'activity_log has % non-SELECT policy(ies); the audit log must stay client-unwritable', n;
  end if;
end $$;
