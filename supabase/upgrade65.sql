-- upgrade65.sql — a tip about how to reach a brother becomes a task, not a note.
--
-- THE PROBLEM THIS SERVES. 359 brothers on the roster, 113 with accounts. That gap caps
-- every other feature on this site. The monthly digest already ends by asking for exactly
-- this information — "we have no way to reach them, reply and tell us" — and those replies
-- land in one inbox as loose prose and die there.
--
-- So a brother looking at a man who is not on the site gets a button, and what he types
-- lands in the suggestions queue the webmaster already works.
--
-- ── ONE COLUMN, NOT A NEW TABLE ──────────────────────────────────────────────────────
-- The insert policy, the "new suggestion" bell trigger, the unread badge and BOTH consoles'
-- Suggestions tabs already exist and already work. A parallel contact_tips table would
-- duplicate five working things to store one extra field. What the queue actually lacks is
-- a link to the brother the tip is ABOUT — without it the webmaster retypes every address
-- by hand, and a tip he has to retype is a note, not a task.
--
-- ── AND THE WRITE SURFACE GETS NARROWED WHILE WE ARE HERE ────────────────────────────
-- Checked against information_schema rather than assumed: `suggestions` still carries
-- Supabase's default `grant all`, column for column, to anon AND authenticated. So a
-- brother could insert a suggestion with `status = 'responded'` and a `response` he wrote
-- himself — putting words in the webmaster's mouth inside his own console. Not a breach,
-- but it is the same "born wide open" default that has now bitten this project four times,
-- and this migration is already touching this table's grants.
--
-- Idempotent: safe to re-run.

-- ═══ 1) The column ═══════════════════════════════════════════════════════════════════
alter table public.suggestions
  add column if not exists about_brother uuid references public.brothers(id) on delete set null;

comment on column public.suggestions.about_brother is
  'The brother this suggestion is ABOUT, when it is a contact tip — how to reach a man who '
  'has no account. NULL for an ordinary suggestion. on delete set null: losing the brother '
  'row must not silently delete the tip (upgrade65).';

create index if not exists suggestions_about_idx
  on public.suggestions (about_brother) where about_brother is not null;

-- ═══ 2) Narrow the write surface ═════════════════════════════════════════════════════
-- A brother supplies who he is, what he knows, and who it is about. Nothing else — the
-- status, the webmaster's response and the timestamps are the console's to write, and id
-- and created_at are the server's.
revoke insert, update, delete on public.suggestions from anon;
revoke insert, update          on public.suggestions from authenticated;
-- anon's SELECT returns zero rows anyway (sug_own_read needs author_user = auth.uid(), and
-- anon's is NULL) — but a grant that exists only because nobody revoked it is a grant a
-- future policy edit can wake up. Added after the security review of 6ede18f flagged it.
revoke select                  on public.suggestions from anon;

grant insert (author_user, body, about_brother) on public.suggestions to authenticated;
-- The responder is `authenticated` too — admin is a JWT-email check, not a Postgres role —
-- so the columns the console writes have to be granted to the same role. RLS
-- (sug_admin_update: is_admin() OR officer_can('suggestions.respond')) is what restricts
-- WHO may use them; this grant restricts WHAT they may touch.
grant update (status, response, responded_at) on public.suggestions to authenticated;

-- ═══ 3) Assertions ═══════════════════════════════════════════════════════════════════
do $$
declare bad text;
begin
  -- (a) THE ONE THAT WOULD ONLY FAIL ON THE LIVE SITE. A column added to a table whose
  --     INSERT grant is a COLUMN LIST is not writable until it is named in that list —
  --     every tip would 42501, and only for real brothers, never in a migration test.
  if not has_column_privilege('authenticated', 'public.suggestions', 'about_brother', 'INSERT') then
    raise exception 'authenticated cannot INSERT about_brother — every contact tip would be refused';
  end if;
  if not has_column_privilege('authenticated', 'public.suggestions', 'body', 'INSERT') then
    raise exception 'authenticated cannot INSERT body — filing any suggestion is broken';
  end if;

  -- (b) A brother cannot write his own answer. This is the narrowing.
  select string_agg(column_name, ', ' order by column_name) into bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'suggestions'
     and privilege_type = 'INSERT' and grantee = 'authenticated'
     and column_name not in ('author_user', 'body', 'about_brother');
  if bad is not null then
    raise exception 'suggestions: a brother can also INSERT %; status/response are the console''s to write', bad;
  end if;

  -- (c) …and the console can still answer.
  if not has_column_privilege('authenticated', 'public.suggestions', 'response', 'UPDATE')
  or not has_column_privilege('authenticated', 'public.suggestions', 'status', 'UPDATE') then
    raise exception 'the console can no longer respond to a suggestion — the grant was over-narrowed';
  end if;

  -- (d) about_brother is set once, at insert. Letting it be updated would let a tip be
  --     re-pointed at a different brother after the fact.
  if has_column_privilege('authenticated', 'public.suggestions', 'about_brother', 'UPDATE') then
    raise exception 'about_brother is updatable — a tip could be re-pointed at another brother';
  end if;

  -- (e) anon holds nothing here at all.
  select string_agg(distinct privilege_type, ', ') into bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'suggestions' and grantee = 'anon'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'suggestions: anon holds % — a signed-out visitor must not write here', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
