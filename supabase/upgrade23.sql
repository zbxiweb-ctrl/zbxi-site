-- upgrade23.sql — Show a pending brother's signup (login) email in the admin queue.
--
-- Why: vetting a new account before approval needs the email he actually signed
-- up with. That address lives in auth.users.email (keyed to brothers.user_id)
-- and the browser can't read the auth schema under RLS. brothers.email (the
-- profile contact field) is NOT a substitute: the majority path claim_profile()
-- never captures it, so it's usually blank at approval time.
--
-- Safety: mirrors admin_reset_2fa (upgrade21) — SECURITY DEFINER, search_path
-- pinned, EXECUTE revoked from public and granted only to authenticated, and the
-- body returns nothing unless the caller is the admin (public.is_admin()). So a
-- non-admin — or a raw SQL / Management connection with no JWT — gets zero rows.
-- No schema or RLS change.
--
-- Rollback:  drop function public.admin_pending_emails();

create or replace function public.admin_pending_emails()
returns table (uid uuid, login_email text)   -- distinct names dodge plpgsql column ambiguity
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;                                    -- non-admins get nothing
  end if;
  return query
    select b.user_id, u.email
    from public.brothers b
    join auth.users u on u.id = b.user_id
    where b.status = 'pending';
end;
$$;

revoke all on function public.admin_pending_emails() from public;
grant execute on function public.admin_pending_emails() to authenticated;
