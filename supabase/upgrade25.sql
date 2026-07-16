-- upgrade25.sql — allow the 'introductions' board category.
--
-- The board defaulted to Chapter Business and split ~zero content across four
-- tabs, so every tab rendered an empty state. Introductions is the new landing
-- space: the one post every brother across 33 years can write without thinking.
--
-- Additive: every existing row already satisfies the widened constraint.
-- No RLS change — fthreads_member_read / fthreads_member_insert already gate on
-- is_approved_brother() + author_user = auth.uid(), and fthreads_own_delete on
-- owner-or-admin, so intros inherit the correct security for free.
--
-- WRAPPED IN A TRANSACTION ON PURPOSE. This constraint is not just data
-- validation — `category` is client-supplied (RLS never constrains it) and it
-- reaches innerHTML unescaped in board.js (catLabel fallthrough, thread-row
-- class). This enum is the gate that stops raw HTML getting in. A half-applied
-- drop-then-add would leave that gate off silently, with nothing looking broken.
-- begin/commit makes it all-or-nothing; `if exists` makes a re-run safe.
begin;
alter table public.forum_threads drop constraint if exists forum_threads_category_check;
alter table public.forum_threads add constraint forum_threads_category_check
  check (category = any (array['chapter','advice','social','opportunities','introductions']));
commit;
