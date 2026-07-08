-- =============================================================================
-- Zeta Beta Xi — upgrade 5: event RSVPs + site settings (announcement banner).
-- Applied 2026-07-08 via the Management API.
-- =============================================================================

-- 1) Event RSVPs (members only) ------------------------------------------------
create table if not exists public.event_rsvps (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.event_rsvps enable row level security;

drop policy if exists rsvps_member_read on public.event_rsvps;
create policy rsvps_member_read on public.event_rsvps
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists rsvps_member_insert on public.event_rsvps;
create policy rsvps_member_insert on public.event_rsvps
  for insert with check (user_id = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists rsvps_own_delete on public.event_rsvps;
create policy rsvps_own_delete on public.event_rsvps
  for delete using (user_id = auth.uid() or public.is_admin());

-- 2) Site settings (announcement banner etc.) -----------------------------------
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists settings_public_read on public.site_settings;
create policy settings_public_read on public.site_settings
  for select using (true);
drop policy if exists settings_admin_insert on public.site_settings;
create policy settings_admin_insert on public.site_settings
  for insert with check (public.is_admin());
drop policy if exists settings_admin_update on public.site_settings;
create policy settings_admin_update on public.site_settings
  for update using (public.is_admin());
drop policy if exists settings_admin_delete on public.site_settings;
create policy settings_admin_delete on public.site_settings
  for delete using (public.is_admin());
