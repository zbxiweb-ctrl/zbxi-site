-- upgrade43.sql — a brother may only supply the four columns a post is made of
--
-- WHY (security review of upgrade41, 2026-08-05):
--   upgrade41 narrowed UPDATE to (caption, album_id) but left INSERT at Supabase's
--   default `grant all`. So `created_at` was client-supplied, and a brother could
--   post with created_at = '3000-01-01' — galleryList() and the homepage teaser
--   both order by created_at desc, so his photo sits above everyone else's
--   permanently. Reproduced against the live site before writing this.
--
--   upgrade41 made that WORSE rather than better: because UPDATE on created_at is
--   now revoked, not even the admin could correct a bogus date from the website.
--   Narrowing INSERT is what closes the loop.
--
--   `id` was client-supplied too. Harmless on its own (uuid-typed, a collision
--   just errors) but it is the reason two `data-*` attributes in gallery.js were
--   relying on the column type to do their escaping; those are now esc()'d as well.
--
-- Also finishes a revoke upgrade41 left half-done: anon kept table-wide INSERT and
-- DELETE. Not exploitable — every gallery policy requires author_user = auth.uid()
-- and anon's auth.uid() is NULL — but a future policy that is careless about NULL
-- would be the only thing standing between the open internet and this table.
-- anon keeps SELECT, which is how every other table here is set up and which RLS
-- makes empty; narrowing that is a site-wide decision, not a gallery one.
--
-- Idempotent: safe to re-run.

-- The four columns assets/js/gallery.js:235 actually sends. Nothing else.
revoke insert on public.gallery_posts from anon, authenticated;
grant  insert (author_user, image_path, caption, album_id)
  on public.gallery_posts to authenticated;

revoke delete on public.gallery_posts from anon;

-- Assert the whole write surface in one place, INSERT + UPDATE + DELETE, so this
-- can't drift back a column at a time. Replaces the narrower UPDATE-only check in
-- upgrade41 (that one still stands; this is the superset).
do $$
declare bad text;
begin
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'gallery_posts'
     and privilege_type = 'INSERT' and grantee = 'authenticated'
     -- taken_year added by upgrade60 (2026-08-12): the optional year a photo was taken.
     -- Listed here as well so THIS file stays re-runnable in either order.
     and column_name not in ('author_user', 'image_path', 'caption', 'album_id', 'taken_year');
  if bad is not null then
    raise exception 'gallery_posts: authenticated can INSERT %; created_at/id must stay server-set', bad;
  end if;

  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'gallery_posts'
     and privilege_type = 'UPDATE' and grantee = 'authenticated'
     and column_name not in ('caption', 'album_id', 'taken_year');   -- taken_year: upgrade60
  if bad is not null then
    raise exception 'gallery_posts: authenticated can UPDATE %; an edit must only touch caption + album_id + taken_year', bad;
  end if;

  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'gallery_posts'
     and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'gallery_posts: anon holds % ; signed-out visitors must never write here', bad;
  end if;
end $$;

-- Prove the narrowed grant actually bites, rather than trusting it was applied.
-- Runs as the table owner, which is NOT subject to column grants, so this asserts
-- on the catalog rather than by attempting an insert.
do $$
begin
  if has_column_privilege('authenticated', 'public.gallery_posts', 'created_at', 'INSERT') then
    raise exception 'authenticated can still INSERT created_at — the pin-to-top bug is still open';
  end if;
  if not has_column_privilege('authenticated', 'public.gallery_posts', 'caption', 'INSERT') then
    raise exception 'authenticated cannot INSERT caption — posting is broken';
  end if;
end $$;

notify pgrst, 'reload schema';
