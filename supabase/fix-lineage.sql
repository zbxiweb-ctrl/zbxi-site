-- =============================================================================
-- Zeta Beta Xi — one-off lineage repair (run once in the Supabase SQL editor).
-- Repairs the Pickard line after the claim/rename mix-up:
--   • "Johnathan" (the user's registered profile) -> little of Jordan Gannett
--   • Zander Purcell -> little of Johnathan (was dangling under "WebDev")
--   • Brayan Ortiz stays under Zander (unchanged)
--   • "WebDev" (the admin's profile — actually the old Conway roster row)
--     becomes a standalone profile: clearing roster_name means a future
--     "Disconnect" deletes it instead of resurrecting a duplicate Conway.
-- Safe to re-run.
-- =============================================================================

-- Johnathan under Jordan Gannett (also fixes grad year 23 -> 2023)
update public.brothers
   set big_id = 'e5e2a818-1ead-443d-ab51-bc81adcef043',   -- Jordan Gannett
       grad_year = 2023
 where id = '3184fe39-eca2-443c-85bc-0e981d60441a';        -- Johnathan (registered)

-- Zander Purcell under Johnathan
update public.brothers
   set big_id = '3184fe39-eca2-443c-85bc-0e981d60441a'     -- Johnathan
 where id = '95ba81d0-932a-47e4-8988-a415d7b409c9';        -- Zander Purcell

-- WebDev: standalone admin profile, no tree attachment to restore
update public.brothers
   set roster_name = null
 where id = '12b5abb1-fc9b-4693-a6ad-75d9435f4dc7';        -- WebDev (old Conway row)

-- Verify:
--   select full_name, big_id from public.brothers
--   where id in ('3184fe39-eca2-443c-85bc-0e981d60441a',
--                '95ba81d0-932a-47e4-8988-a415d7b409c9',
--                '39d4c32a-44af-472e-aac9-69e760200d21');
