-- =============================================================================
-- Zeta Beta Xi — upgrade 4: admin roster management.
-- Lets the admin console INSERT brothers directly (single "Add brother" and
-- bulk "Add pledge class"). Applied 2026-07-08 via the Management API.
-- =============================================================================

-- Admin can insert roster rows (unclaimed brothers: user_id = null).
drop policy if exists brothers_admin_insert on public.brothers;
create policy brothers_admin_insert on public.brothers
  for insert with check (public.is_admin());
