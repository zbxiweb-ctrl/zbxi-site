-- =============================================================================
-- Zeta Beta Xi — upgrade 6: e-board scopes, polls, suggestions, committees.
-- Applied 2026-07-08 via the Management API.
-- =============================================================================

-- 1) E-board scope on brothers + public view --------------------------------
alter table public.brothers add column if not exists role_scope text
  check (role_scope in ('active','alumni','previous'));

drop view if exists public.family_public;
create view public.family_public as
  select id, full_name, big_id, pledge_class, role, role_term, role_scope, grad_year,
         (user_id is not null) as registered
  from public.brothers
  where status = 'verified';

grant select on public.family_public to anon, authenticated;

-- 2) Polls (admin-created; brothers vote) --------------------------------------
create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  options    jsonb not null,          -- array of option strings
  closes_at  timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  choice     int not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists polls_member_read on public.polls;
create policy polls_member_read on public.polls
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists polls_admin_insert on public.polls;
create policy polls_admin_insert on public.polls
  for insert with check (public.is_admin());
drop policy if exists polls_admin_update on public.polls;
create policy polls_admin_update on public.polls
  for update using (public.is_admin());
drop policy if exists polls_admin_delete on public.polls;
create policy polls_admin_delete on public.polls
  for delete using (public.is_admin());

drop policy if exists pvotes_member_read on public.poll_votes;
create policy pvotes_member_read on public.poll_votes
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists pvotes_member_insert on public.poll_votes;
create policy pvotes_member_insert on public.poll_votes
  for insert with check (
    user_id = auth.uid() and (public.is_approved_brother() or public.is_admin())
    and exists (select 1 from public.polls p where p.id = poll_id
                and (p.closes_at is null or p.closes_at > now()))
  );
drop policy if exists pvotes_member_update on public.poll_votes;
create policy pvotes_member_update on public.poll_votes
  for update using (
    user_id = auth.uid()
    and exists (select 1 from public.polls p where p.id = poll_id
                and (p.closes_at is null or p.closes_at > now()))
  );

-- 3) Suggestion dropbox ---------------------------------------------------------
create table if not exists public.suggestions (
  id           uuid primary key default gen_random_uuid(),
  author_user  uuid not null references auth.users(id) on delete cascade,
  body         text not null,
  status       text not null default 'new' check (status in ('new','responded','archived')),
  response     text,
  responded_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.suggestions enable row level security;

drop policy if exists sug_own_read on public.suggestions;
create policy sug_own_read on public.suggestions
  for select using (author_user = auth.uid() or public.is_admin());
drop policy if exists sug_member_insert on public.suggestions;
create policy sug_member_insert on public.suggestions
  for insert with check (author_user = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists sug_admin_update on public.suggestions;
create policy sug_admin_update on public.suggestions
  for update using (public.is_admin());
drop policy if exists sug_admin_delete on public.suggestions;
create policy sug_admin_delete on public.suggestions
  for delete using (public.is_admin());

-- Notify the admin on a new suggestion; notify the author on a response.
create or replace function public.tg_notify_suggestion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid;
begin
  if tg_op = 'INSERT' then
    select id into admin_uid from auth.users where email = 'zbxi.web@gmail.com';
    if admin_uid is not null then
      insert into public.notifications (recipient, kind, payload)
      values (admin_uid, 'suggestion',
              jsonb_build_object('actor', public.member_name(new.author_user), 'text', left(new.body, 90)));
    end if;
  elsif tg_op = 'UPDATE' and new.response is not null
        and (old.response is distinct from new.response) then
    insert into public.notifications (recipient, kind, payload)
    values (new.author_user, 'suggestion_reply',
            jsonb_build_object('text', left(new.response, 90)));
  end if;
  return new;
end;
$$;

drop trigger if exists notify_suggestion on public.suggestions;
create trigger notify_suggestion after insert or update on public.suggestions
  for each row execute function public.tg_notify_suggestion();

-- 4) Committees (private groups with their own Board space) ----------------------
create table if not exists public.committees (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.committee_members (
  committee_id uuid not null references public.committees(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (committee_id, user_id)
);

-- Helper: is the current user a member of committee cid? (definer: avoids
-- RLS recursion when used inside other tables' policies.)
create or replace function public.in_committee(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.committee_members
    where committee_id = cid and user_id = auth.uid()
  );
$$;

grant execute on function public.in_committee(uuid) to anon, authenticated;

alter table public.committees enable row level security;
alter table public.committee_members enable row level security;

drop policy if exists comm_member_read on public.committees;
create policy comm_member_read on public.committees
  for select using (public.in_committee(id) or public.is_admin());
drop policy if exists comm_admin_insert on public.committees;
create policy comm_admin_insert on public.committees
  for insert with check (public.is_admin());
drop policy if exists comm_admin_update on public.committees;
create policy comm_admin_update on public.committees
  for update using (public.is_admin());
drop policy if exists comm_admin_delete on public.committees;
create policy comm_admin_delete on public.committees
  for delete using (public.is_admin());

drop policy if exists cmem_member_read on public.committee_members;
create policy cmem_member_read on public.committee_members
  for select using (public.in_committee(committee_id) or public.is_admin());
drop policy if exists cmem_admin_insert on public.committee_members;
create policy cmem_admin_insert on public.committee_members
  for insert with check (public.is_admin());
drop policy if exists cmem_admin_delete on public.committee_members;
create policy cmem_admin_delete on public.committee_members
  for delete using (public.is_admin());

-- Seed the auto-managed officers committee (id is looked up by name in code).
insert into public.committees (name)
select 'E-Board Officers'
where not exists (select 1 from public.committees where name = 'E-Board Officers');

-- 5) Committee-private board threads ---------------------------------------------
alter table public.forum_threads add column if not exists committee_id uuid
  references public.committees(id) on delete cascade;

drop policy if exists fthreads_member_read on public.forum_threads;
create policy fthreads_member_read on public.forum_threads
  for select using (
    (committee_id is null and (public.is_approved_brother() or public.is_admin()))
    or (committee_id is not null and (public.in_committee(committee_id) or public.is_admin()))
  );
drop policy if exists fthreads_member_insert on public.forum_threads;
create policy fthreads_member_insert on public.forum_threads
  for insert with check (
    author_user = auth.uid() and (
      (committee_id is null and (public.is_approved_brother() or public.is_admin()))
      or (committee_id is not null and (public.in_committee(committee_id) or public.is_admin()))
    )
  );

-- Replies inherit visibility via the thread (subquery runs under the caller's
-- rights against forum_threads RLS).
drop policy if exists freplies_member_read on public.forum_replies;
create policy freplies_member_read on public.forum_replies
  for select using (exists (select 1 from public.forum_threads t where t.id = thread_id));
drop policy if exists freplies_member_insert on public.forum_replies;
create policy freplies_member_insert on public.forum_replies
  for insert with check (
    author_user = auth.uid()
    and exists (select 1 from public.forum_threads t where t.id = thread_id)
  );
