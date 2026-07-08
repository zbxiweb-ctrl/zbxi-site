-- =============================================================================
-- Zeta Beta Xi — upgrade 3: members platform.
-- Run in the Supabase SQL editor AFTER schema.sql, upgrade.sql and upgrade2.sql.
--
--  1) New profile columns (occupation, city, phone, contact prefs, skills,
--     structured e-board title term) + roster_name (immutable tree name).
--  2) One-off fix: restores the "Johnathon Conway" roster name.
--  3) release_profile(): disconnect an account from its tree row (row returns
--     to the public tree as claimable, personal details wiped).
--  4) claim_profile(): now snapshots roster_name at claim time.
--  5) Private gallery  (posts / likes / comments + private storage bucket).
--  6) Discussion board (threads / replies, incl. the Opportunities job board).
--  7) Events           (public + members-only, admin-managed).
--  8) In-site notifications (likes, comments, replies, approvals, new pending).
--  9) Activity log + admin_stats() for the leadership dashboard.
-- =============================================================================

-- 0) Helper: is the current user the admin? ----------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'zbxi.web@gmail.com';
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- 1) New brothers columns ------------------------------------------------------
alter table public.brothers add column if not exists occupation    text;
alter table public.brothers add column if not exists email         text;   -- shared with brothers only (RLS)
alter table public.brothers add column if not exists city          text;
alter table public.brothers add column if not exists phone         text;
alter table public.brothers add column if not exists contact_prefs text;   -- csv: email,phone,linkedin
alter table public.brothers add column if not exists skills        text;
alter table public.brothers add column if not exists role_term     text;   -- e.g. 'Fall 2019'
alter table public.brothers add column if not exists roster_name   text;   -- immutable tree name

-- 2) One-off fix + roster_name backfill ---------------------------------------
-- Restore the roster name on the row that was claimed + renamed by the admin
-- account (so the backfill below snapshots the CORRECT name).
update public.brothers
   set full_name = 'Johnathon Conway'
 where user_id = (select id from auth.users where email = 'zbxi.web@gmail.com');

update public.brothers set roster_name = full_name where roster_name is null;

-- 3) release_profile(): disconnect my account from the family tree ------------
create or replace function public.release_profile()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.brothers%rowtype;
begin
  if auth.uid() is null then
    return 'error: not signed in';
  end if;
  select * into r from public.brothers where user_id = auth.uid();
  if not found then
    return 'error: no profile linked to this account';
  end if;

  if r.roster_name is not null then
    -- Claimed roster row: restore the tree name, wipe personal details, and
    -- put the row back in the public tree as claimable.
    update public.brothers
       set user_id = null,
           full_name = r.roster_name,
           status = 'verified',
           grad_year = null, major = null, hometown = null, city = null,
           occupation = null, phone = null, email = null, contact_prefs = null,
           skills = null, linkedin = null, quote = null, bio = null,
           photo_url = null, role = null, role_term = null
     where id = r.id;
  else
    -- Self-created row (never in the imported tree): just remove it.
    delete from public.brothers where id = r.id;
  end if;

  return 'ok';
end;
$$;

grant execute on function public.release_profile() to authenticated;

-- 4) claim_profile(): snapshot roster_name at claim time ----------------------
create or replace function public.claim_profile(target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return 'error: not signed in';
  end if;
  if exists (select 1 from public.brothers where user_id = auth.uid()) then
    return 'error: your account already has a profile';
  end if;
  if not exists (select 1 from public.brothers where id = target_id and user_id is null) then
    return 'error: that profile is not claimable';
  end if;

  update public.brothers
     set user_id = auth.uid(),
         status  = 'pending',                              -- re-verified by the admin
         roster_name = coalesce(roster_name, full_name)    -- release_profile() restores this
   where id = target_id;

  return 'ok';
end;
$$;

grant execute on function public.claim_profile(uuid) to authenticated;

-- 4b) Member directory: resolves user_id -> display name/photo for author
-- chips in the gallery/board. Only returns rows to APPROVED brothers.
drop view if exists public.member_directory;
create view public.member_directory as
  select user_id, full_name, photo_url, role, role_term, pledge_class
  from public.brothers
  where user_id is not null
    and status in ('verified', 'pending')
    and public.is_approved_brother();

grant select on public.member_directory to authenticated;

-- 5) Private gallery -----------------------------------------------------------
create table if not exists public.gallery_posts (
  id          uuid primary key default gen_random_uuid(),
  author_user uuid not null references auth.users(id) on delete cascade,
  image_path  text not null,          -- storage path inside the 'gallery' bucket
  caption     text,
  created_at  timestamptz not null default now()
);

create table if not exists public.gallery_likes (
  post_id    uuid not null references public.gallery_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.gallery_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.gallery_posts(id) on delete cascade,
  author_user uuid not null references auth.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists gallery_posts_created_idx  on public.gallery_posts (created_at desc);
create index if not exists gallery_likes_post_idx     on public.gallery_likes (post_id);
create index if not exists gallery_comments_post_idx  on public.gallery_comments (post_id);

alter table public.gallery_posts    enable row level security;
alter table public.gallery_likes    enable row level security;
alter table public.gallery_comments enable row level security;

-- Approved brothers see + create; delete own; admin deletes anything.
drop policy if exists gposts_member_read on public.gallery_posts;
create policy gposts_member_read on public.gallery_posts
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists gposts_member_insert on public.gallery_posts;
create policy gposts_member_insert on public.gallery_posts
  for insert with check (author_user = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists gposts_own_delete on public.gallery_posts;
create policy gposts_own_delete on public.gallery_posts
  for delete using (author_user = auth.uid() or public.is_admin());

drop policy if exists glikes_member_read on public.gallery_likes;
create policy glikes_member_read on public.gallery_likes
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists glikes_member_insert on public.gallery_likes;
create policy glikes_member_insert on public.gallery_likes
  for insert with check (user_id = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists glikes_own_delete on public.gallery_likes;
create policy glikes_own_delete on public.gallery_likes
  for delete using (user_id = auth.uid() or public.is_admin());

drop policy if exists gcomments_member_read on public.gallery_comments;
create policy gcomments_member_read on public.gallery_comments
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists gcomments_member_insert on public.gallery_comments;
create policy gcomments_member_insert on public.gallery_comments
  for insert with check (author_user = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists gcomments_own_delete on public.gallery_comments;
create policy gcomments_own_delete on public.gallery_comments
  for delete using (author_user = auth.uid() or public.is_admin());

-- Private storage bucket (images served via signed URLs to approved brothers).
insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', false)
on conflict (id) do nothing;

drop policy if exists gallery_member_read on storage.objects;
create policy gallery_member_read on storage.objects
  for select using (bucket_id = 'gallery' and (public.is_approved_brother() or public.is_admin()));

drop policy if exists gallery_own_write on storage.objects;
create policy gallery_own_write on storage.objects
  for insert with check (
    bucket_id = 'gallery'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.is_approved_brother() or public.is_admin())
  );

drop policy if exists gallery_own_delete on storage.objects;
create policy gallery_own_delete on storage.objects
  for delete using (
    bucket_id = 'gallery'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- 6) Discussion board ----------------------------------------------------------
create table if not exists public.forum_threads (
  id          uuid primary key default gen_random_uuid(),
  author_user uuid not null references auth.users(id) on delete cascade,
  category    text not null check (category in ('chapter','advice','social','opportunities')),
  tag         text check (tag in ('offering','seeking')),   -- opportunities only
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.forum_replies (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.forum_threads(id) on delete cascade,
  author_user uuid not null references auth.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists forum_threads_cat_idx    on public.forum_threads (category, created_at desc);
create index if not exists forum_replies_thread_idx on public.forum_replies (thread_id, created_at);

alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;

drop policy if exists fthreads_member_read on public.forum_threads;
create policy fthreads_member_read on public.forum_threads
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists fthreads_member_insert on public.forum_threads;
create policy fthreads_member_insert on public.forum_threads
  for insert with check (author_user = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists fthreads_own_delete on public.forum_threads;
create policy fthreads_own_delete on public.forum_threads
  for delete using (author_user = auth.uid() or public.is_admin());

drop policy if exists freplies_member_read on public.forum_replies;
create policy freplies_member_read on public.forum_replies
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists freplies_member_insert on public.forum_replies;
create policy freplies_member_insert on public.forum_replies
  for insert with check (author_user = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists freplies_own_delete on public.forum_replies;
create policy freplies_own_delete on public.forum_replies
  for delete using (author_user = auth.uid() or public.is_admin());

-- 7) Events ---------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  location    text,
  category    text not null default 'social'
              check (category in ('rush','philanthropy','reunion','meeting','social')),
  description text,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists events_starts_idx on public.events (starts_at);

alter table public.events enable row level security;

drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select using (is_public = true or public.is_approved_brother() or public.is_admin());
drop policy if exists events_admin_insert on public.events;
create policy events_admin_insert on public.events
  for insert with check (public.is_admin());
drop policy if exists events_admin_update on public.events;
create policy events_admin_update on public.events
  for update using (public.is_admin());
drop policy if exists events_admin_delete on public.events;
create policy events_admin_delete on public.events
  for delete using (public.is_admin());

-- 8) In-site notifications --------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  recipient  uuid not null references auth.users(id) on delete cascade,
  kind       text not null,     -- like | comment | reply | approved | new_pending
  payload    jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient, read, created_at desc);

alter table public.notifications enable row level security;

-- Owner reads + marks read; rows are only ever created by the triggers below.
drop policy if exists notif_own_read on public.notifications;
create policy notif_own_read on public.notifications
  for select using (recipient = auth.uid());
drop policy if exists notif_own_update on public.notifications;
create policy notif_own_update on public.notifications
  for update using (recipient = auth.uid());
drop policy if exists notif_own_delete on public.notifications;
create policy notif_own_delete on public.notifications
  for delete using (recipient = auth.uid());

-- Helper: display name for an auth user (falls back to 'A brother').
create or replace function public.member_name(uid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select full_name from public.brothers where user_id = uid limit 1),
    'A brother');
$$;

-- Trigger: someone liked your post.
create or replace function public.tg_notify_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_author uuid;
begin
  select author_user into post_author from public.gallery_posts where id = new.post_id;
  if post_author is not null and post_author <> new.user_id then
    insert into public.notifications (recipient, kind, payload)
    values (post_author, 'like',
            jsonb_build_object('post_id', new.post_id, 'actor', public.member_name(new.user_id)));
  end if;
  return new;
end;
$$;

drop trigger if exists notify_like on public.gallery_likes;
create trigger notify_like after insert on public.gallery_likes
  for each row execute function public.tg_notify_like();

-- Trigger: someone commented on your post.
create or replace function public.tg_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_author uuid;
begin
  select author_user into post_author from public.gallery_posts where id = new.post_id;
  if post_author is not null and post_author <> new.author_user then
    insert into public.notifications (recipient, kind, payload)
    values (post_author, 'comment',
            jsonb_build_object('post_id', new.post_id, 'actor', public.member_name(new.author_user),
                               'text', left(new.body, 90)));
  end if;
  return new;
end;
$$;

drop trigger if exists notify_comment on public.gallery_comments;
create trigger notify_comment after insert on public.gallery_comments
  for each row execute function public.tg_notify_comment();

-- Trigger: someone replied to your thread.
create or replace function public.tg_notify_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_author uuid;
  thread_title  text;
begin
  select author_user, title into thread_author, thread_title
    from public.forum_threads where id = new.thread_id;
  if thread_author is not null and thread_author <> new.author_user then
    insert into public.notifications (recipient, kind, payload)
    values (thread_author, 'reply',
            jsonb_build_object('thread_id', new.thread_id, 'actor', public.member_name(new.author_user),
                               'title', thread_title));
  end if;
  return new;
end;
$$;

drop trigger if exists notify_reply on public.forum_replies;
create trigger notify_reply after insert on public.forum_replies
  for each row execute function public.tg_notify_reply();

-- Trigger: profile entered the pending queue -> notify the admin.
-- Trigger: profile approved -> notify the brother.
create or replace function public.tg_notify_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select id into admin_uid from auth.users where email = 'zbxi.web@gmail.com';
    if admin_uid is not null then
      insert into public.notifications (recipient, kind, payload)
      values (admin_uid, 'new_pending', jsonb_build_object('name', new.full_name));
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'verified' and old.status = 'pending'
     and new.user_id is not null then
    insert into public.notifications (recipient, kind, payload)
    values (new.user_id, 'approved', jsonb_build_object('name', new.full_name));
  end if;
  return new;
end;
$$;

drop trigger if exists notify_status on public.brothers;
create trigger notify_status after insert or update on public.brothers
  for each row execute function public.tg_notify_status();

-- 9) Activity log + leadership stats ----------------------------------------------
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index if not exists activity_created_idx on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists activity_admin_read on public.activity_log;
create policy activity_admin_read on public.activity_log
  for select using (public.is_admin());

create or replace function public.tg_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'brothers' then
    insert into public.activity_log (user_id, action, detail)
    values (auth.uid(),
            case when tg_op = 'INSERT' then 'profile_created' else 'profile_updated' end,
            new.full_name);
  elsif tg_table_name = 'gallery_posts' then
    insert into public.activity_log (user_id, action, detail)
    values (auth.uid(), 'gallery_post', left(coalesce(new.caption, ''), 80));
  elsif tg_table_name = 'gallery_comments' then
    insert into public.activity_log (user_id, action, detail)
    values (auth.uid(), 'gallery_comment', left(new.body, 80));
  elsif tg_table_name = 'forum_threads' then
    insert into public.activity_log (user_id, action, detail)
    values (auth.uid(), 'thread_created', left(new.title, 80));
  elsif tg_table_name = 'forum_replies' then
    insert into public.activity_log (user_id, action, detail)
    values (auth.uid(), 'reply_posted', left(new.body, 80));
  end if;
  return new;
end;
$$;

drop trigger if exists log_brothers on public.brothers;
create trigger log_brothers after insert or update on public.brothers
  for each row execute function public.tg_log_activity();
drop trigger if exists log_gposts on public.gallery_posts;
create trigger log_gposts after insert on public.gallery_posts
  for each row execute function public.tg_log_activity();
drop trigger if exists log_gcomments on public.gallery_comments;
create trigger log_gcomments after insert on public.gallery_comments
  for each row execute function public.tg_log_activity();
drop trigger if exists log_fthreads on public.forum_threads;
create trigger log_fthreads after insert on public.forum_threads
  for each row execute function public.tg_log_activity();
drop trigger if exists log_freplies on public.forum_replies;
create trigger log_freplies after insert on public.forum_replies
  for each row execute function public.tg_log_activity();

-- Leadership dashboard aggregates (admin only).
create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'not authorized');
  end if;

  select jsonb_build_object(
    'total',      (select count(*) from public.brothers),
    'verified',   (select count(*) from public.brothers where status = 'verified'),
    'pending',    (select count(*) from public.brothers where status = 'pending'),
    'rejected',   (select count(*) from public.brothers where status = 'rejected'),
    'registered', (select count(*) from public.brothers where user_id is not null),
    'accounts',   (select count(*) from auth.users),
    'posts_30d',    (select count(*) from public.gallery_posts   where created_at > now() - interval '30 days'),
    'comments_30d', (select count(*) from public.gallery_comments where created_at > now() - interval '30 days'),
    'likes_30d',    (select count(*) from public.gallery_likes   where created_at > now() - interval '30 days'),
    'threads_30d',  (select count(*) from public.forum_threads   where created_at > now() - interval '30 days'),
    'replies_30d',  (select count(*) from public.forum_replies   where created_at > now() - interval '30 days'),
    'recent_signins', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'email', u.email,
               'name', public.member_name(u.id),
               'last_sign_in', u.last_sign_in_at) order by u.last_sign_in_at desc), '[]'::jsonb)
      from (select id, email, last_sign_in_at from auth.users
            where last_sign_in_at is not null
            order by last_sign_in_at desc limit 8) u),
    'recent_registrations', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', b.full_name, 'status', b.status) order by b.created_at desc), '[]'::jsonb)
      from (select full_name, status, created_at from public.brothers
            where user_id is not null
            order by created_at desc limit 8) b)
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_stats() to authenticated;

-- Done. Verify:
--   • select * from member_directory;              -- rows only if approved
--   • anon REST: events?is_public=eq.true          -- 200 []
--   • anon REST: gallery_posts                     -- 200 [] (RLS empty)
--   • select public.admin_stats();                 -- json (as admin)
