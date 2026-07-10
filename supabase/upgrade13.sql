-- ============================================================================
-- upgrade13.sql — lock chapter titles to admin-only (audit finding)
-- Applied via Supabase Management API (agent-run). Documented here for record.
--
-- Admin escalation was already impossible (admin = JWT email, no is_admin
-- column to flip). This closes the ONE adjacent hole the audit's live rogue-
-- brother test surfaced: a brother could set role='President',
-- role_scope='active' on his OWN row and appear on the public Active E-Board.
-- Titles are the webmaster's to assign (E-Board console tab), so the guard now
-- pins role + role_scope for non-admins exactly like status + user_id.
--
-- claim_profile()/release_profile() set zbxi.bypass, so they are unaffected.
-- ============================================================================

create or replace function public.tg_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admin, or a SECURITY DEFINER routine that opted in, may do anything.
  if public.is_admin() or coalesce(current_setting('zbxi.bypass', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status     := 'pending';   -- every new brother starts unverified
    new.role       := null;        -- titles are assigned by the webmaster only
    new.role_scope := null;
  else
    new.status     := old.status;      -- edits never change verification state
    new.user_id    := old.user_id;     -- and never re-point a row at another account
    new.role       := old.role;        -- brothers can't grant themselves a title
    new.role_scope := old.role_scope;  -- (current OR previous board)
  end if;
  return new;
end;
$$;
