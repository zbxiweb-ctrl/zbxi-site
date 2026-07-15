-- upgrade20.sql — Restrict who can POST to the gallery.
--
-- Before: any approved brother could create a gallery post (gposts_member_insert
-- + gallery_own_write both checked is_approved_brother()).
-- After:  only the admin, or a seat with the NEW 'gallery.post' officer grant
-- switched on (offered to the Alumni President in Admin -> Officers). Ships with
-- the grant OFF, so until the admin flips it, only the admin can post.
--
-- Posting (INSERT) and moderating (DELETE) are separate policies; this touches
-- ONLY the two INSERT policies. Read + delete + comment/like policies are
-- unchanged, so viewing, deleting, commenting and liking still work as before.
-- 'gallery.post' is just a new permission value in the existing officer_grants
-- table (PK is (seat, permission); no schema change needed).
--
-- Rollback: recreate these two policies with the original predicate
--   (author_user = auth.uid() and (public.is_approved_brother() or public.is_admin()))
--   for the table, and (... and (public.is_approved_brother() or public.is_admin()))
--   for the storage bucket. See upgrade3.sql lines 176-178 and 212-218.

-- 1) gallery_posts INSERT
drop policy if exists gposts_member_insert on public.gallery_posts;
create policy gposts_member_insert on public.gallery_posts
  for insert with check (
    author_user = auth.uid()
    and (public.is_admin() or public.officer_can('gallery.post'))
  );

-- 2) storage.objects INSERT (the 'gallery' bucket)
drop policy if exists gallery_own_write on storage.objects;
create policy gallery_own_write on storage.objects
  for insert with check (
    bucket_id = 'gallery'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.is_admin() or public.officer_can('gallery.post'))
  );
