-- ============================================================================
-- upgrade19.sql — brother_titles (positions history) + brothers.decided_at
-- Applied via Supabase Management API (agent-run). Documented here for record.
--
-- 1) brother_titles: the FULL history of positions a brother has held (Treasurer
--    Spring '21, President Fall '21, Rush Chair Spring '22 …). brothers.role /
--    role_term / role_scope stays the HEADLINE (current) title that drives the
--    public E-Board + card subtitle — this table is additive history only.
--    Titles remain admin-granted, so writes are is_admin() only (same posture as
--    title_requests). Read matches where the list is shown: the members-only
--    profile detail (approved brother) or the admin.
--
-- 2) brothers.decided_at + stamp_decided trigger: records WHEN a brother was
--    approved/rejected (the queue only had created_at = signup time). The trigger
--    stamps it on any real status change and IGNORES client-supplied values, so a
--    non-admin cannot spoof it. Named `stamp_decided` so it fires AFTER
--    `guard_status` (alphabetical order) — by which point a non-admin's status is
--    already pinned to old, so no bogus stamp. tg_guard_status is NOT touched.
-- ============================================================================

-- 1) positions history --------------------------------------------------------
create table if not exists public.brother_titles (
  id          uuid primary key default gen_random_uuid(),
  brother_id  uuid not null references public.brothers(id) on delete cascade,
  title       text not null,
  term        text,
  scope       text check (scope in ('active','alumni','previous')),  -- null = historical / no board
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists brother_titles_bro_idx on public.brother_titles (brother_id, sort);

alter table public.brother_titles enable row level security;

drop policy if exists bt_read on public.brother_titles;
create policy bt_read on public.brother_titles
  for select using (public.is_approved_brother() or public.is_admin());

drop policy if exists bt_admin_all on public.brother_titles;
create policy bt_admin_all on public.brother_titles
  for all using (public.is_admin()) with check (public.is_admin());

-- one-time backfill: seed each brother's current headline title as history row 0
insert into public.brother_titles (brother_id, title, term, scope, sort)
  select id, role, role_term, nullif(role_scope, ''), 0
  from public.brothers
  where role is not null and role <> ''
    and not exists (select 1 from public.brother_titles t where t.brother_id = brothers.id);

-- 2) decision timestamp -------------------------------------------------------
alter table public.brothers add column if not exists decided_at timestamptz;

create or replace function public.tg_stamp_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.decided_at := null;               -- a brand-new row hasn't been decided yet
  elsif new.status is distinct from old.status then
    new.decided_at := now();              -- a real approve/reject/revoke = a decision
  else
    new.decided_at := old.decided_at;     -- ignore any client-supplied value
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_decided on public.brothers;
create trigger stamp_decided before insert or update on public.brothers
  for each row execute function public.tg_stamp_decided();
