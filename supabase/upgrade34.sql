-- upgrade34.sql — Stop non-digest sends from resetting the digest's "since" window.
--
-- Why: zbxi-digest picks its "what's new since" watermark by reading the newest
-- digest_log row with test=false (upgrade11.sql created the table for exactly that
-- purpose). But TWO other functions write digest_log rows with test=false:
--   * zbxi-email     — every ad-hoc blast from the console composer
--   * zbxi-pending   — the approval-queue alert, which runs on a 5-MINUTE cron
-- So a single brother signing up moves the watermark to minutes ago, and the next
-- monthly digest truthfully reports that nothing has happened. The digest has never
-- actually run to completion (see the encodeURIComponent bug fixed in the same
-- commit), which is why nobody noticed.
--
-- Fix: label each row with what wrote it, and have the digest read only its own.
-- A column rather than matching on the note text — note is human copy and would
-- drift — and rather than writing pending rows as test=true, which would be a lie
-- that corrupts the admin's log view.
--
-- Rollback:
--   drop index if exists public.digest_log_kind_sent_idx;
--   alter table public.digest_log drop column if exists kind;

begin;

-- Default 'digest' is correct for every pre-existing row EXCEPT the two kinds
-- backfilled below, and it keeps old function versions working during the deploy
-- window (an insert that omits kind still lands as a digest row).
alter table public.digest_log
  add column if not exists kind text not null default 'digest';

-- Backfill from the note prefixes each writer has always used. This is the only
-- signal the historical rows carry, and it is exact — both prefixes are literals
-- in the edge functions (zbxi-email.ts "composed: ", zbxi-pending.ts "pending alert: ").
update public.digest_log set kind = 'compose' where note like 'composed:%'      and kind = 'digest';
update public.digest_log set kind = 'pending' where note like 'pending alert:%' and kind = 'digest';

-- The digest's watermark lookup is (kind, test) ordered by sent_at desc.
create index if not exists digest_log_kind_sent_idx
  on public.digest_log (kind, sent_at desc);

commit;

-- No RLS change needed: digest_log_admin_read (upgrade11.sql) is a table-level
-- SELECT policy, so a new column is covered by it and widens nothing.
--
-- Expected, and NOT a bug: the first digest after this lands may cover a longer
-- window than a month — whatever has happened since the last genuine digest row,
-- or 30 days if there has never been one.
