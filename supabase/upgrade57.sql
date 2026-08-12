-- upgrade57.sql — take anon's write grants off gallery_albums.
--
-- Found by the Push 3 security review. Not exploitable: `anon` matches no write policy on
-- this table (galbums_manage_* all require is_admin() or officer_can('gallery.albums')),
-- so a signed-out request gets nothing today. But the table still carries the grants
-- Supabase's default privileges hand out on CREATE — `anon=arwdm` — which means the only
-- thing standing between a signed-out visitor and the gallery's section list is one RLS
-- policy. That is the same dormant pattern upgrade49, upgrade50 and upgrade52 each had to
-- clean up after the fact. This is the fourth table; take it off before it matters.
--
-- `authenticated` KEEPS its write grants, deliberately and for the same reason as
-- officer_grants and site_settings: the admin signs in as `authenticated` like everyone
-- else, so revoking there would lock the webmaster out of his own album manager. RLS is
-- the gate; this only removes a grant nobody legitimate uses.

revoke insert, update, delete on public.gallery_albums from anon;

do $$
declare n int;
begin
  -- (a) anon holds no write grant any more.
  select count(*) into n
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'gallery_albums'
     and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if n <> 0 then
    raise exception 'anon still holds % write grants on gallery_albums', n;
  end if;

  -- (b) anon can still READ. The gallery is brothers-only by POLICY, and the read grant
  --     is what lets that policy do the refusing rather than a bare permission error.
  if not has_table_privilege('anon', 'public.gallery_albums', 'select') then
    raise exception 'anon lost SELECT on gallery_albums — the members-only refusal should come from RLS, not a grant';
  end if;

  -- (c) authenticated keeps write, because the ADMIN is authenticated.
  if not has_table_privilege('authenticated', 'public.gallery_albums', 'insert') then
    raise exception 'authenticated lost INSERT on gallery_albums — that locks the webmaster out of his own album manager';
  end if;
end $$;

notify pgrst, 'reload schema';
