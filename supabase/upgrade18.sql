-- ============================================================================
-- upgrade18 — close two authorization gaps found by security review
--
-- Both are DB-only. No client change is needed: the UI already only ever sends
-- the correct shape; these make the DATABASE enforce it, so a hand-crafted API
-- call can't do more than the screen allows.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) MEDIUM — a brother could file a chapter-title request naming ANOTHER
--    brother's brother_id (delta review, finding #1).
--
--    The old policy checked WHO was asking (user_id = auth.uid()) but never
--    checked WHOSE ROW the title would land on. So a brother could submit a
--    request that shows up in the admin queue as if a different brother asked,
--    and on Approve the admin's write (updateBrother(r.brother_id, …)) would
--    put the title on that innocent brother's profile.
--
--    Not a takeover — he still can't give HIMSELF anything (tg_guard_status
--    pins role/role_scope for non-admins, untouched) — but it's forgery, and
--    it only bites if the admin approves without looking. Close it: brother_id
--    must be null, or must be a row the caller actually owns.
-- ---------------------------------------------------------------------------
drop policy if exists title_req_own_insert on public.title_requests;
create policy title_req_own_insert on public.title_requests
  for insert with check (
    user_id = auth.uid()
    and status = 'pending'                       -- can't self-approve on the way in
    and public.is_approved_brother()             -- only verified brothers may ask
    and (
      brother_id is null
      or exists (
        select 1 from public.brothers b
        where b.id = brother_id and b.user_id = auth.uid()
      )
    )
  );


-- ---------------------------------------------------------------------------
-- 2) LOW — "respond to suggestions" was broader than its label (officer-console
--    review, finding #1).
--
--    sug_admin_update allows (is_admin() or officer_can('suggestions.respond'))
--    with NO column restriction. The Officer Console only ever sends
--    response/status/responded_at — but a hand-crafted call from an officer
--    could rewrite the member's own words (`body`) or reassign `author_user`,
--    which also controls who receives the "you got a reply" notification.
--
--    Pin the member's content for everyone except the admin. Same shape as the
--    tg_guard_status trigger already used on `brothers`.
-- ---------------------------------------------------------------------------
create or replace function public.tg_guard_suggestion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The admin keeps full latitude (he already had it). Everyone else — i.e. an
  -- officer holding suggestions.respond — may only write the REPLY fields.
  if not public.is_admin() then
    new.author_user := old.author_user;   -- can't reassign authorship (or the 🔔)
    new.body        := old.body;          -- can't rewrite what the brother wrote
    new.created_at  := old.created_at;    -- can't backdate it
  end if;
  return new;
end;
$$;

drop trigger if exists suggestions_guard on public.suggestions;
create trigger suggestions_guard
  before update on public.suggestions
  for each row execute function public.tg_guard_suggestion();
