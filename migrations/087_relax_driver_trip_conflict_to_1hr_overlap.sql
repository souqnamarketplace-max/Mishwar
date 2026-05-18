-- ════════════════════════════════════════════════════════════════════════
-- 087_relax_driver_trip_conflict_to_1hr_overlap.sql
-- ════════════════════════════════════════════════════════════════════════
--
-- Replaces the same-calendar-day driver-trip conflict trigger from
-- mig 062 with a TIME-aware 1-hour-overlap check.
--
-- ─── THE PROBLEM WITH THE OLD RULE ────────────────────────────────────
--
-- Migration 062 blocked ANY two trips by the same driver on the same
-- calendar date, regardless of time:
--
--   ❌ 7 AM Ramallah → Nablus           (Tuesday)
--   ❌ 2 PM Nablus → Ramallah   ← blocked, same Tuesday
--   ❌ 6 PM Ramallah → Jericho  ← blocked, same Tuesday
--
-- That's too strict for real Palestinian rideshare patterns:
--   - Return trips on the same day are normal (drop off, come back)
--   - Some drivers do 2-3 short runs per day (Ramallah ↔ Nablus is
--     ~90 km, drivers genuinely do morning + evening)
--   - The conservative blanket-block prevented legitimate flows and
--     forced drivers to use a different account or skip the platform
--
-- ─── THE NEW RULE ────────────────────────────────────────────────────
--
-- Two trips conflict only when they're scheduled within ONE HOUR of
-- each other (same driver, same date). This gives the driver enough
-- buffer to drop off + turn around without preventing same-day routing.
--
--   ✅ 7 AM trip + 8 AM trip      → 1 hour exactly, allowed
--   ❌ 7 AM trip + 7:30 AM trip   → 30 min overlap, BLOCKED
--   ❌ 7 AM trip + 7:59 AM trip   → 59 min overlap, BLOCKED
--   ✅ 7 AM trip + 9 AM trip      → 2 hours, allowed
--   ✅ 7 AM trip + 11 PM trip     → 16 hours apart, allowed
--
-- The 60-minute window mirrors the buffer Mishwaro already uses in
-- the change_trip_time RPC (mig 048's ≤60-min adjustment limit), so
-- the rule is internally consistent.
--
-- ─── EDGE CASES ──────────────────────────────────────────────────────
--
-- 1. NULL or empty-string time on either side
--    Conservative: treat as conflict. We can't safely say "no
--    conflict" when we don't know when the existing trip departs.
--    Legacy rows from before mig 052 enforced non-empty time may
--    have NULL/empty here.
--
-- 2. Cross-midnight times on the same calendar date
--    Not a real concern — the date filter constrains both rows to
--    the same calendar day, and TIME comparisons within a 24h day
--    are unambiguous.
--
-- 3. UPDATE path (not INSERT)
--    Still skipped, matching mig 062's behavior. Trip-time updates
--    go through the change_trip_time RPC which has its own gate
--    (≤60-min delta from original). Conflict checks on UPDATEs
--    would require extra work for limited benefit — change_trip_time's
--    constraint prevents large time shifts that could introduce
--    conflicts.
--
-- 4. Admin override
--    Admins still bypass the check (same contract as mig 062 + 044).
--    Necessary for support tickets and seed data.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_driver_trip_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_role    TEXT := public.auth_user_role();
  v_conflict_count INTEGER;
  v_conflict_time  TEXT;
BEGIN
  -- Admin override — same contract as mig 062 + 044.
  IF v_caller_role = 'admin' THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Same-day, 1-hour-overlap check.
  --
  -- Status filter excludes:
  --   - cancelled  → driver pulled the trip
  --   - completed  → already happened, doesn't conflict with future
  --   - expired    → auto-expired by mig 012 cron
  --
  -- The time-overlap predicate has two parts joined by OR:
  --
  --   (A) Either time is NULL/empty → can't compare safely, block.
  --       NULLIF(time, '') collapses both NULL and '' to NULL.
  --
  --   (B) Absolute difference between the two times, expressed in
  --       seconds, is < 3600 (1 hour). EXTRACT(EPOCH FROM time1 -
  --       time2) gives seconds; ABS() handles the case where the new
  --       trip is earlier or later than the existing one symmetrically.
  --
  -- Order matters: condition (A) is checked first so the cast in (B)
  -- never runs on a NULL value (which would error in some pg versions).
  SELECT COUNT(*), MIN(time)
  INTO v_conflict_count, v_conflict_time
  FROM public.trips
  WHERE driver_email = NEW.driver_email
    AND status IN ('confirmed', 'in_progress')
    AND id <> NEW.id
    AND date = NEW.date
    AND (
      NULLIF(time, '') IS NULL
      OR NULLIF(NEW.time, '') IS NULL
      OR ABS(EXTRACT(EPOCH FROM (
           NULLIF(time, '')::time - NULLIF(NEW.time, '')::time
         ))) < 3600
    );

  IF v_conflict_count > 0 THEN
    -- Include the conflicting time in the error so the frontend can
    -- show the driver WHICH existing trip is causing the conflict.
    -- The Arabic translation in src/lib/errors.js extracts this via
    -- regex and renders a more helpful message.
    RAISE EXCEPTION 'trip conflict — driver already has an active trip at % on % within 1 hour',
      COALESCE(v_conflict_time, '?'), NEW.date
      USING ERRCODE = '42501',
            HINT = 'Pick a time at least 1 hour before or after your existing trip.';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.check_driver_trip_conflict() FROM PUBLIC;

-- Trigger redefinition — DROP + CREATE so re-runs are clean. Function
-- handle stays the same, so existing trigger linkages survive the
-- CREATE OR REPLACE on the function alone, but we recreate the trigger
-- explicitly for clarity and to ensure no pinning to an old function
-- OID.
DROP TRIGGER IF EXISTS prevent_driver_trip_conflict ON public.trips;
CREATE TRIGGER prevent_driver_trip_conflict
  BEFORE INSERT ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.check_driver_trip_conflict();

COMMIT;

-- ─── VERIFICATION QUERIES (run manually in SQL editor) ────────────────
--
--   -- Function + trigger present:
--   SELECT proname FROM pg_proc WHERE proname = 'check_driver_trip_conflict';
--   SELECT tgname FROM pg_trigger WHERE tgname = 'prevent_driver_trip_conflict' AND NOT tgisinternal;
--   -- Expect 1 row each.
--
--   -- Smoke test (replace UUIDs with real ones from your DB):
--   -- 1. Verify a 30-minute-apart insert is BLOCKED:
--   --    Pre: driver has confirmed trip at '09:00' on '2026-05-25'.
--   --    Try: INSERT a new trip at '09:30' on '2026-05-25'.
--   --    Expect: ERROR 42501 'trip conflict ... within 1 hour'.
--   --
--   -- 2. Verify a 90-minute-apart insert is ALLOWED:
--   --    Pre: same as above.
--   --    Try: INSERT a new trip at '10:30' on '2026-05-25'.
--   --    Expect: success.
--
--   -- Distribution of times in conflicting rows (if any):
--   SELECT driver_email, date, array_agg(time ORDER BY time)
--     FROM public.trips
--    WHERE status IN ('confirmed', 'in_progress')
--    GROUP BY driver_email, date
--    HAVING count(*) > 1;
--   -- This shows existing same-day clusters that mig 062 would have
--   -- blocked but mig 087 may allow if they're >1hr apart. No action
--   -- required — informational only.
