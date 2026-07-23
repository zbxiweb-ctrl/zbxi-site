-- upgrade31.sql — Let the alumni president manage gallery sections (albums).
--
-- Why: albums were admin-write only (upgrade30). The chapter wants the ACTIVE
-- alumni president to create/rename/delete sections too, from the gallery page.
--
-- How: reuse the officer-permission model (upgrade17) — a new grant key
-- `gallery.albums`. The three gallery_albums WRITE policies now accept the admin
-- OR whoever currently holds the alumni-president seat with that grant enabled.
-- `officer_can()` already resolves the CURRENT seat holder, so "active" is
-- automatic; the grant ships OFF, so no one gains this power until the admin
-- flips it on in the Officers grid. SELECT policy is unchanged.
--
-- The permission is surfaced as a toggle in admin.js OFFICER_PERMS
-- ({ key:'gallery.albums', seats:['alumni_president'] }). Album CRUD stays a
-- direct table op from the client (supabase-client.js) — RLS is the enforcement.

drop policy if exists galbums_admin_insert on public.gallery_albums;
create policy galbums_manage_insert on public.gallery_albums
  for insert with check (public.is_admin() or public.officer_can('gallery.albums'));

drop policy if exists galbums_admin_update on public.gallery_albums;
create policy galbums_manage_update on public.gallery_albums
  for update using (public.is_admin() or public.officer_can('gallery.albums'));

drop policy if exists galbums_admin_delete on public.gallery_albums;
create policy galbums_manage_delete on public.gallery_albums
  for delete using (public.is_admin() or public.officer_can('gallery.albums'));

-- Protect the fallback bucket. Photos with no section (or whose section was
-- deleted) fold into "Miscellaneous", matched by NAME. Now that a president can
-- manage sections, guard that invariant server-side: nobody can delete or rename
-- Miscellaneous away (the consoles also hide those actions for it). SECURITY
-- DEFINER + pinned search_path, same discipline as the other triggers.
create or replace function public.tg_protect_misc_album()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.name = 'Miscellaneous' then
      raise exception 'The Miscellaneous section is the fallback bucket and cannot be deleted.';
    end if;
    return old;
  end if;
  if old.name = 'Miscellaneous' and new.name is distinct from 'Miscellaneous' then
    raise exception 'The Miscellaneous section is the fallback bucket and cannot be renamed.';
  end if;
  return new;
end $$;

drop trigger if exists protect_misc_album on public.gallery_albums;
create trigger protect_misc_album before update or delete on public.gallery_albums
  for each row execute function public.tg_protect_misc_album();
