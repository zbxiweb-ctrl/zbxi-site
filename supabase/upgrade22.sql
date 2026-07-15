-- upgrade22.sql — let an INVITED brother skip the second confirmation email.
--
-- With email verification on, a brother invited from the roster gets TWO emails:
-- the "claim your profile" invite AND a confirm-your-email. Redundant — the invite
-- link (sent to his inbox) already proves he controls the address. This function
-- lets the portal confirm his brand-new account using the invite token, so no
-- second email is needed. Mirrors the existing token-gated invite_status RPC.
--
-- Safety: the token is the proof (same as invite_status). Only touches an
-- UNCONFIRMED user whose email matches the invite. Grants nothing else — he's
-- still Pending until an admin approves. search_path pinned; EXECUTE limited.

create or replace function public.confirm_invited(tok uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare em text;
begin
  select lower(email) into em from public.invites where token = tok;
  if em is null then return false; end if;   -- unknown token -> do nothing
  update auth.users
     set email_confirmed_at = now()
   where lower(email) = em and email_confirmed_at is null;
  return true;
end;
$$;

revoke all on function public.confirm_invited(uuid) from public;
grant execute on function public.confirm_invited(uuid) to anon, authenticated;
