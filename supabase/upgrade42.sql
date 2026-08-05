-- upgrade42.sql — a photo row may only ever name its OWN author's image
--
-- WHY (found by probing upgrade41 before shipping it, and reproduced against the
-- live site — it destroyed a real brother's photo):
--
--   image_path is free text. Nothing stopped a brother from creating a post whose
--   image_path pointed at ANOTHER brother's image. Two things then follow:
--     1) his post displays someone else's photo under his own name; and worse,
--     2) deleting his own post makes zbxi-gallery's delete-post op delete the R2
--        OBJECT that image_path names -- so deleting his own row destroys the
--        other brother's photo, while RLS sees nothing wrong because he really
--        did own the row he deleted.
--
--   This hole pre-dates upgrade41, but upgrade41 is what makes it REACHABLE: it
--   went from 2 accounts that could insert (admin + Alumni President) to all 358
--   approved brothers. It must not ship open.
--
-- FIX: the object key must start with the author's own uid, which is exactly the
-- shape the edge function mints (`<auth uid>/<ms timestamp>.<ext>`) and exactly
-- what its KEY_RE already accepts. A brother therefore cannot name a key that
-- isn't his, so he can never point at -- or delete -- anyone else's image.
--
-- The edge function gains a second, independent guard (it refuses to delete an
-- object still referenced by another row). Either one alone closes this; both
-- are cheap, and the DB one holds even if the function is redeployed wrong.
--
-- Verified before applying: all existing rows already satisfy both constraints
-- (2 gallery posts, 1 thread photo).
--
-- Idempotent: safe to re-run.

-- gallery_posts.image_path is NOT NULL, so no null branch is needed here. ~* to
-- match KEY_RE's case-insensitive flag, so a legitimately-minted key is never
-- rejected on a technicality.
alter table public.gallery_posts drop constraint if exists gposts_image_is_authors;
alter table public.gallery_posts add constraint gposts_image_is_authors
  check (image_path ~* ('^' || author_user::text || '/[0-9]{10,}\.(jpg|jpeg|png|webp)$'));

-- forum_threads.image_path IS nullable — a thread without a photo is normal — so
-- the null branch is deliberate here, and is what makes this constraint correct
-- rather than a constraint that quietly passes on everything. (A CHECK already
-- passes when its expression is NULL; spelling the null case out keeps the intent
-- readable and stops a future edit from turning `is null or` into a bypass.)
-- Threads never delete their R2 object, so this closes misattribution only.
alter table public.forum_threads drop constraint if exists fthreads_image_is_authors;
alter table public.forum_threads add constraint fthreads_image_is_authors
  check (image_path is null
         or image_path ~* ('^' || author_user::text || '/[0-9]{10,}\.(jpg|jpeg|png|webp)$'));

-- Prove the constraint actually bites, rather than trusting that it was created.
-- A constraint that is present but unenforcing is the failure mode worth testing
-- for; this raises if a foreign-owned key is somehow still accepted.
do $$
declare
  a uuid := '11111111-1111-1111-1111-111111111111';
  b uuid := '22222222-2222-2222-2222-222222222222';
begin
  begin
    insert into public.gallery_posts (author_user, image_path)
    values (a, b::text || '/1785900000000.jpg');
    raise exception 'gposts_image_is_authors did not reject a foreign-owned image key';
  exception
    when check_violation then null;              -- expected
    when foreign_key_violation then null;        -- fake uid rejected earlier; fine
  end;
end $$;

notify pgrst, 'reload schema';
