-- ============================================================================
-- upgrade16 — brother-photos becomes PRIVATE (signed URLs)
--
-- The 2026-07-12 security review flagged that `brother-photos` was public=true:
-- a brother's headshot was readable by anyone on the internet who had (or
-- guessed) the URL, with no login. The `gallery` bucket was already private and
-- correct; this brings photos in line with it.
--
-- After this, photo_url on `brothers` holds a STORAGE PATH ("<uid>/123.jpg"),
-- not a URL. The client signs those paths at the data boundary (supabase-client),
-- so every render site keeps working unchanged.
-- ============================================================================

-- 1) Flip the bucket private. Public URLs stop resolving immediately.
update storage.buckets set public = false where id = 'brother-photos';

-- 2) Reads now require an approved brother or the admin — mirroring `gallery`.
--    Plus: a brother can always read his OWN photo even while his profile is
--    still pending review (otherwise his own editor/avatar would break, and the
--    admin needs to see the photo of the very brother he's reviewing).
drop policy if exists photos_public_read on storage.objects;
drop policy if exists photos_member_read on storage.objects;
create policy photos_member_read on storage.objects
  for select using (
    bucket_id = 'brother-photos'
    and (
      public.is_approved_brother()
      or public.is_admin()
      or (storage.foldername(name))[1] = (auth.uid())::text
    )
  );

-- (Uploads/updates were already correctly restricted to the user's own folder:
--  photos_own_write / photos_own_update. Left untouched.)

-- 3) Migrate the 4 existing rows: public URL -> storage path.
--    Only rewrites values that actually point at this bucket; any other value is
--    left alone (the client skips anything that still looks like a full URL).
update public.brothers
   set photo_url = regexp_replace(photo_url, '^.*/brother-photos/', '')
 where photo_url is not null
   and photo_url like '%/brother-photos/%';
