-- upgrade37.sql — pin brothers.unsubscribe_token against self-edit.
--
-- Why: a brother may update his own row (RLS policy brothers_own_update,
-- `auth.uid() = user_id`), and tg_guard_status pinned only status, user_id, role
-- and role_scope. unsubscribe_token was therefore writable by its owner — and
-- that value is interpolated raw into an <a href> AND into the List-Unsubscribe
-- mail header by zbxi-drain, which is a classic header-injection sink.
--
-- The blast radius is small: a brother can only corrupt the unsubscribe link in
-- his OWN email (the drainer substitutes each row's own URL, and no brother can
-- read another's token — brothers RLS is own-row-only and neither roster_detail
-- nor member_directory exposes the column). Flagged Low in the 2026-08-04 queue
-- review; closing it because it costs one line.
--
-- Safe to pin, checked before writing this: the column is written exactly ONCE,
-- by its `gen_random_uuid()` default in upgrade11.sql. Every other reference in
-- the codebase is a read — zbxi-digest.ts, zbxi-email.ts, and the lookup in
-- zbxi-unsubscribe.ts (which flips email_opt_out and never touches the token).
-- Nothing rotates it, so nothing legitimate breaks.
--
-- Note the admin / `zbxi.bypass` early-return above still applies, so the
-- webmaster and security-definer routines can still set the column if a rotation
-- is ever wanted.
--
-- Rollback: re-apply the function body without the unsubscribe_token line
--           (upgrade14.sql / whichever migration last defined tg_guard_status).

begin;

create or replace function public.tg_guard_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    new.unsubscribe_token := old.unsubscribe_token;  -- ends up in a mail header
  end if;
  return new;
end;
$function$;

commit;
