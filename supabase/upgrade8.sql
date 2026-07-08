-- ============================================================================
-- upgrade8.sql — v9: all-day events, members-only calendar, awards showcase
-- Applied via Supabase Management API (agent-run). Documented here for record.
-- ============================================================================

-- 1) All-day events
alter table public.events add column if not exists all_day boolean not null default false;

-- 2) Calendar becomes members-only (was: is_public rows readable by anon)
drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select using (public.is_approved_brother() or public.is_admin());

-- 3) Awards showcase (Greek Excellence badges, admin-editable)
create table if not exists public.awards (
  id         uuid primary key default gen_random_uuid(),
  year_label text not null,
  pillar     text not null default 'other'
             check (pillar in ('community','service','leadership','responsibility','other')),
  title      text not null,
  note       text,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.awards enable row level security;

drop policy if exists awards_read on public.awards;
create policy awards_read on public.awards for select using (true);

drop policy if exists awards_admin_insert on public.awards;
create policy awards_admin_insert on public.awards for insert with check (public.is_admin());
drop policy if exists awards_admin_update on public.awards;
create policy awards_admin_update on public.awards for update using (public.is_admin());
drop policy if exists awards_admin_delete on public.awards;
create policy awards_admin_delete on public.awards for delete using (public.is_admin());

-- Seed the current 2024–25 badges (idempotent)
insert into public.awards (year_label, pillar, title, note, sort)
select v.year_label, v.pillar, v.title, v.note, v.sort
from (values
  ('2024–25','community','Greek Community Badge','Awarded by SUNY Geneseo for contribution to the Greek community.',1),
  ('2024–25','service','Service Badge','Recognizing chapter-wide philanthropy and volunteer hours.',2),
  ('2024–25','leadership','Leadership Excellence','For outstanding leadership across campus organizations.',3),
  ('2024–25','responsibility','Responsibility Badge','Awarded for accountability, conduct, and academic standing.',4)
) as v(year_label, pillar, title, note, sort)
where not exists (select 1 from public.awards where year_label = '2024–25');
