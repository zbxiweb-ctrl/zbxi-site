-- =============================================================================
-- Zeta Beta Xi — Supabase schema. Paste into the Supabase SQL editor and run.
-- Then set ADMIN_EMAIL below (2 places) to the email that approves brothers.
-- Finally create a public Storage bucket named  brother-photos.
-- =============================================================================

-- 1) Table -------------------------------------------------------------------
create table if not exists public.brothers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,  -- null = admin-added alum/placeholder
  full_name    text not null,
  pledge_class text,
  grad_year    int,
  major        text,
  big_id       uuid references public.brothers(id) on delete set null,
  hometown     text,
  bio          text,
  quote        text,
  linkedin     text,
  photo_url    text,
  role         text,
  status       text not null default 'pending' check (status in ('pending','verified','rejected')),
  created_at   timestamptz not null default now(),
  unique (user_id)
);

create index if not exists brothers_status_idx on public.brothers (status);
create index if not exists brothers_big_idx     on public.brothers (big_id);

-- 2) Row-Level Security ------------------------------------------------------
alter table public.brothers enable row level security;

-- Public can read only VERIFIED brothers (feeds roster + family tree)
drop policy if exists brothers_public_read on public.brothers;
create policy brothers_public_read on public.brothers
  for select using (status = 'verified');

-- A signed-in brother can read their own row (even while pending)
drop policy if exists brothers_own_read on public.brothers;
create policy brothers_own_read on public.brothers
  for select using (auth.uid() = user_id);

-- A signed-in brother can insert their own row
drop policy if exists brothers_own_insert on public.brothers;
create policy brothers_own_insert on public.brothers
  for insert with check (auth.uid() = user_id);

-- A signed-in brother can update their own row
drop policy if exists brothers_own_update on public.brothers;
create policy brothers_own_update on public.brothers
  for update using (auth.uid() = user_id);

-- ADMIN can read and update ALL rows (approve / reject).
drop policy if exists brothers_admin_read on public.brothers;
create policy brothers_admin_read on public.brothers
  for select using (auth.jwt() ->> 'email' = 'zbxi.web@gmail.com');

drop policy if exists brothers_admin_update on public.brothers;
create policy brothers_admin_update on public.brothers
  for update using (auth.jwt() ->> 'email' = 'zbxi.web@gmail.com');

-- 3) Storage: brother-photos -------------------------------------------------
-- Create the bucket in the dashboard (Storage → New bucket → name: brother-photos, Public: ON),
-- OR run:
insert into storage.buckets (id, name, public)
values ('brother-photos', 'brother-photos', true)
on conflict (id) do nothing;

-- Anyone can read photos; signed-in users can upload to their own folder (uid/...).
drop policy if exists photos_public_read on storage.objects;
create policy photos_public_read on storage.objects
  for select using (bucket_id = 'brother-photos');

drop policy if exists photos_own_write on storage.objects;
create policy photos_own_write on storage.objects
  for insert with check (
    bucket_id = 'brother-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists photos_own_update on storage.objects;
create policy photos_own_update on storage.objects
  for update using (
    bucket_id = 'brother-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4) (Optional) seed real alumni lineage here later, e.g.:
-- insert into public.brothers (full_name, pledge_class, grad_year, status)
-- values ('Founding Father Name', 'Fall 1993', 1996, 'verified');
