-- upgrade38.sql — brothers can author their own polls.
--
-- Why: the owner expected to be able to post a poll and could not. That was NOT
-- a bug — polls were built admin-only on purpose, in every layer: upgrade6.sql's
-- own section header says "Polls (admin-created; brothers vote)", the three write
-- policies are bare is_admin(), and board.js only emits "+ New poll" for the
-- admin. He is an officer (alumni_president), not the admin, so he correctly saw
-- nothing. Making this work is a feature, not a fix.
--
-- The blocker is that public.polls has NO author column at all — columns are
-- exactly (id, question, options, closes_at, created_at). "Edit your own poll"
-- was not expressible, so this needs a schema change and not a policy tweak.
--
-- Model, chosen by the owner: any approved brother creates and manages HIS OWN
-- poll; the admin and any seat holding the new `polls.moderate` grant can edit or
-- delete ANY poll. That grant ships DISABLED, exactly like gallery.moderate — no
-- officer silently gains moderation by holding a seat.
--
-- This mirrors the forum-thread ownership pattern already in the codebase rather
-- than inventing a new mechanism.
--
-- Voting is untouched: pvotes_member_insert/update (upgrade6.sql) already let
-- every approved brother vote, and always did.
--
-- Rollback:
--   drop policy if exists polls_member_insert on public.polls;
--   drop policy if exists polls_own_update   on public.polls;
--   drop policy if exists polls_own_delete   on public.polls;
--   create policy polls_admin_insert on public.polls for insert with check (public.is_admin());
--   create policy polls_admin_update on public.polls for update using (public.is_admin());
--   create policy polls_admin_delete on public.polls for delete using (public.is_admin());
--   alter table public.polls drop column if exists author_user;
--   -- and remove the polls.moderate row from officer_grants if it was ever toggled on.

begin;

-- 1) Who wrote it. ON DELETE SET NULL, deliberately NOT cascade: removing a
--    brother's login must not silently destroy chapter poll history and its
--    votes. An orphaned poll simply becomes admin/moderator-managed.
alter table public.polls
  add column if not exists author_user uuid references auth.users(id) on delete set null;

-- No backfill needed — verified live, there are zero existing polls. If that ever
-- changes, orphan rows are handled: author_user null just means "no owner", and
-- the policies below fall through to admin/moderator.

-- 2) INSERT — an approved brother may create a poll, and only as HIMSELF.
--    `author_user = auth.uid()` is what stops a brother posting a poll under
--    another brother's name.
drop policy if exists polls_admin_insert  on public.polls;
drop policy if exists polls_member_insert on public.polls;
create policy polls_member_insert on public.polls
  for insert to authenticated
  with check (
    author_user = auth.uid()
    and (public.is_approved_brother() or public.is_admin())
  );

-- 3) UPDATE — owner, admin, or a seat granted polls.moderate.
--    WITH CHECK is required IN ADDITION to USING. USING alone decides which rows
--    you may target; without WITH CHECK an owner could rewrite author_user to
--    another brother's id and hand off (or orphan) his own poll. The old
--    admin-only policy omitted it, which was harmless when only the admin could
--    pass USING — it stops being harmless the moment brothers qualify.
drop policy if exists polls_admin_update on public.polls;
drop policy if exists polls_own_update   on public.polls;
create policy polls_own_update on public.polls
  for update to authenticated
  using (
    author_user = auth.uid() or public.is_admin() or public.officer_can('polls.moderate')
  )
  with check (
    author_user = auth.uid() or public.is_admin() or public.officer_can('polls.moderate')
  );

-- 4) DELETE — same three. poll_votes cascades from polls (upgrade6.sql), so
--    removing a poll takes its votes with it.
drop policy if exists polls_admin_delete on public.polls;
drop policy if exists polls_own_delete   on public.polls;
create policy polls_own_delete on public.polls
  for delete to authenticated
  using (
    author_user = auth.uid() or public.is_admin() or public.officer_can('polls.moderate')
  );

-- 5) No officer_grants seeding here on purpose. Grant rows are created on demand
--    when the admin ticks the box in Admin -> Officers (Z.officerGrantSet), and
--    officer_can() returns false when no row exists — so `polls.moderate` is
--    OFF for everyone until it is deliberately turned on. The checkbox itself is
--    added to OFFICER_PERMS in admin.js.

commit;
