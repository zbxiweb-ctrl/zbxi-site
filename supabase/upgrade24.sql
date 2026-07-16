-- upgrade24.sql — Add the real signup time to admin_pending_emails.
--
-- Why: the admin Pending queue showed brothers.created_at as "Signed up", but for
-- claimed roster rows that's the bulk roster-import time (identical for everyone).
-- The real signup time is auth.users.created_at. Return it too so the queue can
-- show a distinct, accurate timestamp per brother.
--
-- A RETURNS TABLE signature can't be changed by create-or-replace, so drop first,
-- then recreate. Same admin-only guard / hardening as upgrade23.
--
-- Rollback:  re-run upgrade23.sql (the two-column version).

drop function if exists public.admin_pending_emails();

create function public.admin_pending_emails()
returns table (uid uuid, login_email text, signed_up timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return;                                    -- non-admins get nothing
  end if;
  return query
    select b.user_id, u.email::text, u.created_at   -- email is varchar(255); cast to text
    from public.brothers b
    join auth.users u on u.id = b.user_id
    where b.status = 'pending';
end;
$$;

revoke all on function public.admin_pending_emails() from public;
grant execute on function public.admin_pending_emails() to authenticated;
