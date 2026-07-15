-- upgrade21.sql — Admin can reset (remove) a brother's 2FA.
--
-- Why: a brother who enables 2FA and loses his authenticator can neither log in
-- (login needs a code) nor self-disable it (turn-off needs a code). The admin
-- needs a way to clear his authenticator so he can log in with just his password
-- and set 2FA up again. Deleting from auth.mfa_factors needs elevated privilege
-- the browser admin console doesn't have, so this SECURITY DEFINER function does
-- it — but only after checking the caller is the admin.
--
-- Safety: gated on public.is_admin() (jwt email == admin_email()); search_path
-- pinned; EXECUTE revoked from public and granted only to authenticated (and the
-- body re-checks is_admin anyway). Returns the number of factors removed.

create or replace function public.admin_reset_2fa(target uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare removed integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  -- challenges reference factors; clear them first in case the FK isn't cascade.
  delete from auth.mfa_challenges
    where factor_id in (select id from auth.mfa_factors where user_id = target);
  delete from auth.mfa_factors where user_id = target;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.admin_reset_2fa(uuid) from public;
grant execute on function public.admin_reset_2fa(uuid) to authenticated;
