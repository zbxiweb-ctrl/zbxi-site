-- ============================================================================
-- upgrade17 — OFFICER CONSOLE permissions (Core-5)
--
-- Gives the two chapter Presidents a way to run day-to-day site tasks WITHOUT
-- the webmaster/Admin — but only the tasks the Admin has explicitly switched on.
-- Every officer power is an Admin-controlled toggle, OFF by default.
--
-- The security invariant from upgrade13 is preserved untouched:
--   * Admin identity stays `auth.jwt() email == admin_email()` — no is_admin
--     column exists, so admin cannot be escalated to.
--   * The tg_guard_status trigger still pins role/role_scope/status/user_id for
--     every non-admin, so an officer can NEVER assign a title or self-approve.
--   * `brothers` and `title_requests` policies are NOT modified here.
--
-- Officer powers exist ONLY as `or public.officer_can('<key>')` added to the RLS
-- of five SAFE tables (events, committees, awards, suggestions, gallery). No
-- dangerous table ever references officer_can, so there is no code path to one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) The grants table: which permission is enabled for which seat.
--    Admin-write-only; everyone signed in may read (the consoles + the account
--    menu need to know what is enabled to decide what to show).
-- ---------------------------------------------------------------------------
create table if not exists public.officer_grants (
  seat        text not null check (seat in ('active_president','alumni_president')),
  permission  text not null,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  primary key (seat, permission)
);

alter table public.officer_grants enable row level security;

-- Any signed-in user may READ the grant matrix…
drop policy if exists og_read on public.officer_grants;
create policy og_read on public.officer_grants
  for select using (auth.uid() is not null);

-- …but ONLY the admin may write it. An officer cannot grant himself anything.
drop policy if exists og_admin_write on public.officer_grants;
create policy og_admin_write on public.officer_grants
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.officer_grants to authenticated;
revoke all on public.officer_grants from anon;

-- ---------------------------------------------------------------------------
-- 2) Caller's seat, derived from his OWN trigger-pinned role/role_scope.
--    Because tg_guard_status forbids a non-admin from writing those columns,
--    a brother cannot spoof his way into a seat.
-- ---------------------------------------------------------------------------
create or replace function public.my_officer_seat()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when b.role = 'President' and b.role_scope = 'active' then 'active_president'
    when b.role = 'President' and b.role_scope = 'alumni' then 'alumni_president'
    else null
  end
  from public.brothers b
  where b.user_id = auth.uid() and b.status = 'verified'
  limit 1;
$$;

-- The single gate every safe-table policy consults.
create or replace function public.officer_can(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.officer_grants g
    where g.seat = public.my_officer_seat()
      and g.permission = perm
      and g.enabled
  );
$$;

grant execute on function public.my_officer_seat() to authenticated;
grant execute on function public.officer_can(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Amend the five SAFE tables. Each policy is recreated identically except
--    for an added `or public.officer_can('<key>')`. Delete-suggestion and every
--    dangerous policy are deliberately left alone.
-- ---------------------------------------------------------------------------

-- events.manage --------------------------------------------------------------
drop policy if exists events_admin_insert on public.events;
create policy events_admin_insert on public.events
  for insert with check (public.is_admin() or public.officer_can('events.manage'));

drop policy if exists events_admin_update on public.events;
create policy events_admin_update on public.events
  for update using (public.is_admin() or public.officer_can('events.manage'))
          with check (public.is_admin() or public.officer_can('events.manage'));

drop policy if exists events_admin_delete on public.events;
create policy events_admin_delete on public.events
  for delete using (public.is_admin() or public.officer_can('events.manage'));

-- committees.manage ----------------------------------------------------------
-- Read amended too: an officer must see ALL committees, not just ones he's in.
drop policy if exists comm_member_read on public.committees;
create policy comm_member_read on public.committees
  for select using (public.in_committee(id) or public.is_admin() or public.officer_can('committees.manage'));

drop policy if exists comm_admin_insert on public.committees;
create policy comm_admin_insert on public.committees
  for insert with check (public.is_admin() or public.officer_can('committees.manage'));

drop policy if exists comm_admin_update on public.committees;
create policy comm_admin_update on public.committees
  for update using (public.is_admin() or public.officer_can('committees.manage'))
          with check (public.is_admin() or public.officer_can('committees.manage'));

drop policy if exists comm_admin_delete on public.committees;
create policy comm_admin_delete on public.committees
  for delete using (public.is_admin() or public.officer_can('committees.manage'));

drop policy if exists cmem_member_read on public.committee_members;
create policy cmem_member_read on public.committee_members
  for select using (public.in_committee(committee_id) or public.is_admin() or public.officer_can('committees.manage'));

drop policy if exists cmem_admin_insert on public.committee_members;
create policy cmem_admin_insert on public.committee_members
  for insert with check (public.is_admin() or public.officer_can('committees.manage'));

drop policy if exists cmem_admin_delete on public.committee_members;
create policy cmem_admin_delete on public.committee_members
  for delete using (public.is_admin() or public.officer_can('committees.manage'));

-- awards.manage --------------------------------------------------------------
drop policy if exists awards_admin_insert on public.awards;
create policy awards_admin_insert on public.awards
  for insert with check (public.is_admin() or public.officer_can('awards.manage'));

drop policy if exists awards_admin_update on public.awards;
create policy awards_admin_update on public.awards
  for update using (public.is_admin() or public.officer_can('awards.manage'))
          with check (public.is_admin() or public.officer_can('awards.manage'));

drop policy if exists awards_admin_delete on public.awards;
create policy awards_admin_delete on public.awards
  for delete using (public.is_admin() or public.officer_can('awards.manage'));

-- suggestions.respond --------------------------------------------------------
-- Read amended so an officer can see suggestions to respond to them. UPDATE is
-- the "respond" action (writes response/responded_at/status). DELETE stays
-- Admin-only — sug_admin_delete is intentionally untouched.
drop policy if exists sug_own_read on public.suggestions;
create policy sug_own_read on public.suggestions
  for select using (author_user = auth.uid() or public.is_admin() or public.officer_can('suggestions.respond'));

drop policy if exists sug_admin_update on public.suggestions;
create policy sug_admin_update on public.suggestions
  for update using (public.is_admin() or public.officer_can('suggestions.respond'))
          with check (public.is_admin() or public.officer_can('suggestions.respond'));

-- gallery.moderate -----------------------------------------------------------
-- Only the DELETE (moderation) policies are widened. Reads already admit any
-- approved brother, which an officer is.
drop policy if exists gposts_own_delete on public.gallery_posts;
create policy gposts_own_delete on public.gallery_posts
  for delete using (author_user = auth.uid() or public.is_admin() or public.officer_can('gallery.moderate'));

drop policy if exists gcomments_own_delete on public.gallery_comments;
create policy gcomments_own_delete on public.gallery_comments
  for delete using (author_user = auth.uid() or public.is_admin() or public.officer_can('gallery.moderate'));
