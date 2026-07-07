# Roster / family-tree data

Source of the family tree. Transcribed from the 10 family-line docs (one per founding father).

- **`roster.txt`** — the human-readable, editable source. One line per brother:
  `Full Name | Pledge Class | Big`. Blank Big = big is the previous line (linear
  chain); `-` = founder/root; a name = a branch (that brother's big).
- **`build-import.mjs`** — resolves the big→little links, de-dupes, and writes the SQL.
  Re-run with `node build-import.mjs` after editing `roster.txt`.
- **`roster-import.sql`** — the generated import. Run it once in the Supabase SQL editor.
  Safe to re-run (it clears prior imported rows — `user_id is null` — first).

## Result
322 brothers · 10 founding-father roots · 312 big→little links · 0 unresolved.

## Judgment calls / things to verify
1. **"Easy-E" → Eric Dziekonski** (Serrano line). The doc said "Right Branch off Easy-E";
   inferred from the pledge timeline. Yuriy Shinder is placed as Eric Dziekonski's little.
2. **Two-bigs collapsed to one.** Steven Byron (Lohrman) had two bigs in the doc
   (Zahan Mistry + David Parmon); the tree supports one big, so he sits under Zahan Mistry,
   and the duplicated sub-tree under David Parmon was collapsed (David Parmon is kept, in his
   own spot under Ryan Gorman).
3. **Debrothered brothers kept** as historical nodes (Julian Ponirakis, Payton Rodger,
   Kevin O'Neill); their lines chain through them. Say the word to remove them or re-link.
4. **Glenn Jones** — doc said "Placeholder Pledge Class"; stored as "Class unknown".
5. **Diego Sanchez** (Michalski, Gamma Mu '23) placed after Evan Brown in a chain; if they're
   twins (both Robert Liddell's littles), it's a one-line fix.
6. **Calderon's two littles** — the doc labeled both branches "First Little"; treated as two
   separate littles (Elijah Hall + Konstantinos Klentos).
7. **Spelling kept as-in-doc**, e.g. "Johnathon Conway" (Pickard line).

To fix any of these: edit `roster.txt`, re-run `build-import.mjs`, re-run the SQL.
