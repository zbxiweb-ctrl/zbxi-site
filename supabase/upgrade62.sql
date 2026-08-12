-- upgrade62.sql — SECURITY. The three roster views were WRITEABLE, and writing through
-- one of them bypassed every RLS policy on public.brothers.
--
-- ── WHAT WAS WRONG, IN PLAIN ENGLISH ─────────────────────────────────────────────────
-- The family tree, the roster and the member directory are "views" — saved questions that
-- read from the brothers table. They are supposed to be read-only windows. They were not.
-- Any signed-in brother could DELETE another brother's entire record by sending the delete
-- to the window instead of to the table, and none of the rules that protect the table would
-- run. Proven on a fixture row inside a rolled-back transaction before writing this:
--
--     delete from public.family_public where id = <fixture>   ->  1 row   (it worked)
--     delete from public.brothers      where id = <fixture>   ->  0 rows  (RLS refused)
--
-- Same brother, same row, same second. The window was the way in.
--
-- ── WHY IT HAPPENED ──────────────────────────────────────────────────────────────────
-- Two Postgres behaviours meeting, neither wrong on its own:
--   1. A single-table projection view is AUTOMATICALLY UPDATABLE. No one wrote an INSERT,
--      UPDATE or DELETE rule for these; Postgres supplies them. (pg_relation_is_updatable
--      returned 28 = INSERT|UPDATE|DELETE for all three.)
--   2. Supabase's default privileges grant `all` on every new relation in `public` to anon
--      and authenticated — and a VIEW is a relation. `create view` re-applies them.
-- And the view runs with its OWNER's rights (security_invoker is off), which is the whole
-- point — it is how a brother sees 359 names in a table he may only read one row of. That
-- same property is what makes a WRITE through it unstoppable by RLS.
--
-- ── WHAT WAS AND WASN'T REACHABLE ────────────────────────────────────────────────────
-- Verified against the live API rather than assumed:
--   • anon (the published key) DELETE on family_public   -> 42501 permission denied.
--     anon has no SELECT on this view (upgrade7 revoked it), and a filtered write needs
--     SELECT on the filtered column. So the signed-out case was closed BY ACCIDENT — by a
--     revoke made years ago for a different reason. That is not a lock, that is luck.
--   • anon DELETE on roster_detail -> 204 ACCEPTED (it matched zero rows only because that
--     view's WHERE contains is_approved_brother()). Again: gated by the question the view
--     asks, not by a privilege.
--   • A signed-in brother on family_public -> the row was deleted.
-- So: not a privilege-escalation path (tg_guard_status still pins status/role/user_id on
-- UPDATE, and nobody can mint a verified brother this way), but a straight destruction and
-- lineage-rewrite path for anyone with an account.
--
-- ── THE FIX, AND WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────
-- Revoke the three write verbs. Nothing else. In particular this does NOT set
-- security_invoker on the views: that would make brothers' own RLS apply to the read, and
-- since brothers is readable only by its owner and the admin, the family tree and every
-- roster page would go blank for all 359 men. The read behaviour is correct and stays.
--
-- Nothing in the site ever wrote through a view — every write goes to public.brothers via
-- upsertProfile or an officer RPC. Checked before revoking.
--
-- ── THE TRAP FOR WHOEVER EDITS THIS NEXT ─────────────────────────────────────────────
-- These revokes must run AFTER any `create view`. A `drop view` + `create view` re-applies
-- Supabase's default grants, silently re-opening the hole — so a migration that recreates
-- one of these views must re-run this revoke at the end of the same file.
-- And `revoke ... from public` is a no-op here: the grants are held by anon and
-- authenticated by name, so they must be revoked by name.
--
-- Idempotent: safe to re-run.

revoke insert, update, delete on public.family_public    from public, anon, authenticated;
revoke insert, update, delete on public.roster_detail    from public, anon, authenticated;
revoke insert, update, delete on public.member_directory from public, anon, authenticated;

-- ═══ Assertions ══════════════════════════════════════════════════════════════════════
do $$
declare v text; bad text;
begin
  foreach v in array array['family_public', 'roster_detail', 'member_directory'] loop
    -- (a) No write verb survives, for either role. This is the whole migration.
    select string_agg(distinct grantee || ':' || privilege_type, ', ') into bad
      from information_schema.table_privileges
     where table_schema = 'public' and table_name = v
       and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
    if bad is not null then
      raise exception 'view % is still writeable (%) — a projection view must be read-only', v, bad;
    end if;

    -- (b) And the site still works. Over-revoking here would blank the family tree, every
    --     roster page and the gallery author chips — a silent, total outage that looks
    --     exactly like a data loss. Assert the read survives, not just that the write died.
    if not has_table_privilege('authenticated', 'public.' || v, 'SELECT') then
      raise exception 'view % lost SELECT for authenticated — the roster and family tree just went blank', v;
    end if;
  end loop;

  -- (c) anon's read grants are left EXACTLY as they were. family_public has had no anon
  --     SELECT since upgrade7; the other two keep theirs and return nothing to a signed-out
  --     caller because their own WHERE gates on is_approved_brother(). Changing that is a
  --     site-wide decision, not part of closing a write hole.
  if has_table_privilege('anon', 'public.family_public', 'SELECT') then
    raise exception 'anon regained SELECT on family_public — upgrade7 revoked it deliberately';
  end if;
end $$;

notify pgrst, 'reload schema';
