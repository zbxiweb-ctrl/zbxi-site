-- upgrade53.sql — a digest note has to be READ before it can be sent.
--
-- WHY: upgrade52 gave the digest a "New on the site" section, but somebody still had to
-- write it, and the owner does not want that job. The arrangement now is that the agent
-- files a note whenever it ships something brothers would notice — which means the agent
-- would be writing, in the owner's name, to 113 brothers.
--
-- So every note starts as a DRAFT and the digest cannot see it. The owner approves it in
-- Admin → Events, editing the wording first if he wants to. Notes he types himself arrive
-- approved, because he wrote them.
--
-- THE POINT OF DOING IT IN THE QUERY, NOT IN TYPESCRIPT: the digest's fetch gains
-- `status=eq.approved`, so an unapproved note is never retrieved at all. "Nothing he has
-- not read reaches a brother" becomes a property of what the function can see, rather than
-- a filter someone could later reorder, forget, or optimise away.
--
-- Idempotent: safe to re-run.
-- ROLLBACK: alter table public.digest_notes drop column status;
--           (and drop `status=eq.approved` from zbxi-digest's query, or nothing sends)

alter table public.digest_notes
  add column if not exists status text not null default 'draft';

-- Added separately so a re-run does not trip over an existing constraint.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'digest_notes_status_check') then
    alter table public.digest_notes
      add constraint digest_notes_status_check check (status in ('draft', 'approved'));
  end if;
end $$;

-- Anything that predates this column was written under the old rules, where being in the
-- table meant being queued. Defaulting those to 'draft' would silently bury content the
-- owner already intended to send.
update public.digest_notes set status = 'approved'
 where status = 'draft' and created_at < '2026-08-12'::date;

-- The digest's only query. Partial index matching its exact predicate.
drop index if exists digest_notes_unsent_idx;
create index if not exists digest_notes_sendable_idx
  on public.digest_notes (created_at)
  where sent_at is null and status = 'approved';

-- status joins the writable columns; id and created_at stay locked (upgrade52).
grant insert (title, body, link, status)          on public.digest_notes to authenticated;
grant update (title, body, link, sent_at, status) on public.digest_notes to authenticated;

do $$
declare n_draft int; n_approved int; probe uuid;
begin
  -- (a) THE assertion: a draft must be invisible to the digest's real predicate, and
  --     visible the moment it is approved. Written against the same conditions the
  --     function's PostgREST filter compiles to — `status=eq.approved&sent_at=is.null`.
  insert into public.digest_notes (title, status) values ('__upgrade53 probe__', 'draft')
    returning id into probe;

  select count(*) into n_draft from public.digest_notes
   where id = probe and status = 'approved' and sent_at is null;
  if n_draft <> 0 then
    raise exception 'a DRAFT note is visible to the digest — it could reach brothers unread';
  end if;

  update public.digest_notes set status = 'approved' where id = probe;
  select count(*) into n_approved from public.digest_notes
   where id = probe and status = 'approved' and sent_at is null;
  if n_approved <> 1 then
    raise exception 'an APPROVED note is invisible to the digest — nothing would ever send';
  end if;

  delete from public.digest_notes where id = probe;

  -- (b) The column cannot hold a third state. A typo'd status that is neither draft nor
  --     approved would be silently unsendable, which looks exactly like "the agent never
  --     filed anything".
  begin
    insert into public.digest_notes (title, status) values ('__bad status__', 'pending');
    delete from public.digest_notes where title = '__bad status__';
    raise exception 'digest_notes.status accepted an unknown value';
  exception when check_violation then
    null;  -- expected
  end;

  -- (c) anon still cannot write. upgrade52 revoked this; a grant added above must not
  --     have widened it.
  if has_table_privilege('anon', 'public.digest_notes', 'INSERT')
     or has_table_privilege('anon', 'public.digest_notes', 'UPDATE') then
    raise exception 'anon can write digest_notes';
  end if;
end $$;

notify pgrst, 'reload schema';
