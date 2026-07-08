-- =============================================================================
-- Zeta Beta Xi — upgrade 7: members-only lockdown + board reactions/photos.
-- Applied 2026-07-08 via the Management API.
-- =============================================================================

-- 1) Privacy: the public can no longer read names/lineage. Any SIGNED-IN
-- account still can (needed for the claim flow and big-brother dropdowns);
-- full profile details remain approved-brothers-only as before.
revoke select on public.family_public from anon;

-- 2) Reply reactions (👍 ❤️ 😂) -------------------------------------------------
create table if not exists public.reply_reactions (
  reply_id   uuid not null references public.forum_replies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('up','heart','laugh')),
  created_at timestamptz not null default now(),
  primary key (reply_id, user_id, kind)
);

alter table public.reply_reactions enable row level security;

drop policy if exists rreact_member_read on public.reply_reactions;
create policy rreact_member_read on public.reply_reactions
  for select using (public.is_approved_brother() or public.is_admin());
drop policy if exists rreact_member_insert on public.reply_reactions;
create policy rreact_member_insert on public.reply_reactions
  for insert with check (user_id = auth.uid() and (public.is_approved_brother() or public.is_admin()));
drop policy if exists rreact_own_delete on public.reply_reactions;
create policy rreact_own_delete on public.reply_reactions
  for delete using (user_id = auth.uid());

-- 3) Photo attachments on threads (stored in the private 'gallery' bucket) -----
alter table public.forum_threads add column if not exists image_path text;
