-- ============================================================================
-- upgrade15 — Chapter-title REQUESTS
--
-- Brothers may now ask for a chapter title (an official E-Board seat, or a
-- "random"/forgotten historical one they type themselves). They still CANNOT
-- write `role` / `role_scope` on their own row — the `tg_guard_status` trigger
-- from upgrade13 (added after a live audit found a brother could self-assign an
-- E-Board title straight onto the public board) is deliberately NOT touched here.
--
-- The only path to a title is: brother inserts a REQUEST row -> admin approves ->
-- the admin (is_admin()) writes role/role_term/role_scope on `brothers`.
-- ============================================================================

create table if not exists public.title_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  brother_id  uuid references public.brothers(id) on delete set null,
  title       text not null,
  term        text not null,                       -- 'Fall 2019'
  note        text,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,

  constraint title_requests_status_ck check (status in ('pending','approved','rejected')),
  constraint title_requests_title_ck  check (char_length(btrim(title)) between 2 and 60),
  -- Enforce the "Season Year" shape in the DATABASE, not just the dropdowns, so a
  -- crafted request can't smuggle junk (or markup) into a title that gets rendered.
  constraint title_requests_term_ck   check (term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'),
  constraint title_requests_note_ck   check (note is null or char_length(note) <= 300)
);

-- Anti-spam: one open request at a time. He must wait for a decision before asking again.
create unique index if not exists title_requests_one_pending
  on public.title_requests (user_id) where status = 'pending';

create index if not exists title_requests_status_idx on public.title_requests (status, created_at desc);

alter table public.title_requests enable row level security;

-- A brother sees and creates only his OWN requests…
drop policy if exists title_req_own_read on public.title_requests;
create policy title_req_own_read on public.title_requests
  for select using (user_id = auth.uid());

drop policy if exists title_req_own_insert on public.title_requests;
create policy title_req_own_insert on public.title_requests
  for insert with check (
    user_id = auth.uid()
    and status = 'pending'                          -- can't self-approve on the way in
    and public.is_approved_brother()                -- only verified brothers may ask
  );

-- …and cannot edit or delete it afterwards (no policy = no UPDATE/DELETE for him),
-- so he can't flip his own request to 'approved'.

-- The admin sees everything and is the only one who can decide.
drop policy if exists title_req_admin_read on public.title_requests;
create policy title_req_admin_read on public.title_requests
  for select using (public.is_admin());

drop policy if exists title_req_admin_update on public.title_requests;
create policy title_req_admin_update on public.title_requests
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists title_req_admin_delete on public.title_requests;
create policy title_req_admin_delete on public.title_requests
  for delete using (public.is_admin());

grant select, insert, update, delete on public.title_requests to authenticated;
revoke all on public.title_requests from anon;

-- Ping the admin's bell on a new request (same shape as tg_notify_suggestion).
create or replace function public.tg_notify_title_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid;
begin
  if tg_op = 'INSERT' then
    select id into admin_uid from auth.users where email = public.admin_email();
    if admin_uid is not null then
      insert into public.notifications (recipient, kind, payload)
      values (admin_uid, 'title_request',
              jsonb_build_object(
                'actor', public.member_name(new.user_id),
                'title', new.title,
                'term',  new.term));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists title_requests_notify on public.title_requests;
create trigger title_requests_notify
  after insert on public.title_requests
  for each row execute function public.tg_notify_title_request();
