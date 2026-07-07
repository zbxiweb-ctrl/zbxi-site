-- =============================================================================
-- Zeta Beta Xi — privacy tiering + admin delete upgrade.
-- Run this in the Supabase SQL editor AFTER the original schema.sql.
-- Effect: the public can see brother NAMES + lineage (for the family tree/roster)
-- but NOT profile details. Full details are visible only to signed-in APPROVED
-- brothers (and the admin). Also adds a delete permission for the admin.
-- =============================================================================

-- 1) Helper: is the current user an approved (verified) brother? -------------
-- SECURITY DEFINER so it reads the table bypassing RLS (prevents policy recursion).
create or replace function public.is_approved_brother()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.brothers
    where user_id = auth.uid() and status = 'verified'
  );
$$;

grant execute on function public.is_approved_brother() to anon, authenticated;

-- 2) Public view: names + lineage only (NO major/hometown/bio/quote/linkedin) --
create or replace view public.family_public as
  select id, full_name, big_id, pledge_class, role
  from public.brothers
  where status = 'verified';

grant select on public.family_public to anon, authenticated;

-- 3) Rewrite base-table read policies ----------------------------------------
-- Remove the old "anyone can read all columns of verified rows" policy.
drop policy if exists brothers_public_read on public.brothers;

-- Approved brothers (and via later policies, the admin/owner) can read the FULL
-- detail of every verified brother.
drop policy if exists brothers_brother_read on public.brothers;
create policy brothers_brother_read on public.brothers
  for select using (status = 'verified' and public.is_approved_brother());

-- (Own-row read/insert/update and admin read/update remain from schema.sql.)

-- 4) Admin can delete rows (for the admin console's Delete action) ------------
drop policy if exists brothers_admin_delete on public.brothers;
create policy brothers_admin_delete on public.brothers
  for delete using (auth.jwt() ->> 'email' = 'zbxi.web@gmail.com');

-- Done. Verify:
--   • anon: select from family_public  -> returns names (ok)
--   • anon: select major from brothers  -> returns nothing (blocked)
--   • signed-in verified brother: select * from brothers -> full details
