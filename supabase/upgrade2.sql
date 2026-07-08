-- =============================================================================
-- Zeta Beta Xi — upgrade 2: registration visibility + profile claiming.
-- Run in the Supabase SQL editor AFTER schema.sql and upgrade.sql.
--  1) family_public view now exposes grad_year + registered (user_id set?)
--     so the site can split Active/Alumni and color-code the family tree.
--  2) claim_profile(target_id): a signed-in brother claims their existing
--     (imported) tree row -> links their account + goes to the pending queue
--     for admin approval. Prevents duplicate rows.
-- =============================================================================

-- 1) View with registration + grad year -----------------------------
drop view if exists public.family_public;
create view public.family_public as
  select id, full_name, big_id, pledge_class, role, grad_year,
         (user_id is not null) as registered
  from public.brothers
  where status = 'verified';

grant select on public.family_public to anon, authenticated;

-- 2) Claim RPC --------------------------------------------------------------
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
         status  = 'pending'          -- re-verified by the admin
   where id = target_id;

  return 'ok';
end;
$$;

grant execute on function public.claim_profile(uuid) to authenticated;

-- Verify: select * from family_public limit 1;  -- has grad_year + registered
