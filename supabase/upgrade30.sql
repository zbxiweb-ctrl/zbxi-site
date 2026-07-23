-- upgrade30.sql — Gallery ALBUMS (admin-managed) + posts get an album.
--
-- Why: the gallery is one flat grid; the chapter wants photos organized into
-- albums (Reunions, Pledge Classes, E-board, Miscellaneous, ...). The list is
-- admin-managed from the console; brothers pick an album when posting.
--
-- Model: a tiny lookup table + a nullable FK on gallery_posts. Deleting an
-- album SET NULLs its posts — the UI shows null-album posts under the
-- Miscellaneous chip, so nothing is ever lost or hidden.
--
-- RLS: brothers read the list (they need it to post/filter); ONLY the admin
-- writes it. gallery_posts policies are unchanged — the FK alone validates
-- album_id, and albums are not sensitive data.

create table if not exists public.gallery_albums (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort       int  not null default 100,
  created_at timestamptz not null default now()
);

insert into public.gallery_albums (name, sort) values
  ('Reunions',       10),
  ('Pledge Classes', 20),
  ('E-board',        30),
  ('Miscellaneous',  90)
on conflict (name) do nothing;

alter table public.gallery_posts
  add column if not exists album_id uuid references public.gallery_albums(id) on delete set null;

alter table public.gallery_albums enable row level security;

drop policy if exists galbums_member_read on public.gallery_albums;
create policy galbums_member_read on public.gallery_albums
  for select using (public.is_approved_brother() or public.is_admin());

drop policy if exists galbums_admin_insert on public.gallery_albums;
create policy galbums_admin_insert on public.gallery_albums
  for insert with check (public.is_admin());

drop policy if exists galbums_admin_update on public.gallery_albums;
create policy galbums_admin_update on public.gallery_albums
  for update using (public.is_admin());

drop policy if exists galbums_admin_delete on public.gallery_albums;
create policy galbums_admin_delete on public.gallery_albums
  for delete using (public.is_admin());
