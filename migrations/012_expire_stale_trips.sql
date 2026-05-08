-- =============================================================================
-- Migration 012 — Auto-expire stale trips + one-time backfill
-- =============================================================================
--
-- WHY: Trips currently sit in status='confirmed' indefinitely after their
-- date passes, because the only paths that flip them to 'completed' are:
--   - Driver manually clicks "complete" in their dashboard (most don't)
--   - Driver was actively GPS-tracking the trip (rare opt-in)
--
-- Result: stale 'confirmed' trips with past dates pollute the home page
-- (FeaturedTrips), passenger favorites, search, and any other surface
-- that filters by status alone. Passengers see a "Tomorrow" trip that
-- was actually weeks ago and trust evaporates.
--
-- The client-side fix (FeaturedTrips, Favorites, etc. now filter via
-- isTripExpired() helper) hides the issue from passengers immediately,
-- but the database stays polluted. This migration:
--
--   1) Backfills — flips every existing stale 'confirmed' trip whose
--      date+time was more than 30 minutes ago to 'completed'.
--      Idempotent: re-running just no-ops on already-completed rows.
--
--   2) Adds a daily pg_cron job (`expire-stale-trips`) that runs the
--      same logic going forward. Without this, every new 'confirmed'
--      trip eventually becomes the same problem.
--
-- The 30-minute buffer matches the existing isTripCompleted() helper
-- in src/lib/tripScheduling.js — we treat a trip as "completed" only
-- after start_time + 30min has elapsed, so an in-progress trip that
-- the driver hasn't manually completed yet doesn't get prematurely
-- closed.
-- =============================================================================

BEGIN;

-- ─── 1) Function used by both the backfill and the cron job ──────────────

CREATE OR REPLACE FUNCTION public.expire_stale_trips()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- A trip is "stale" if status='confirmed' AND its scheduled departure
  -- is more than 30 minutes in the past. We compute the departure as
  -- (date || ' ' || time)::timestamp and add the 30-min buffer to be
  -- forgiving of trips that are running late but haven't been manually
  -- marked complete yet.
  --
  -- The CASE on time handles trips where time is NULL or malformed —
  -- those use just the date, treated as midnight, which after the
  -- 30-min buffer means trips for "yesterday" or earlier always expire.
  WITH expired AS (
    UPDATE public.trips
       SET status = 'completed',
           updated_at = NOW()
     WHERE status = 'confirmed'
       AND date IS NOT NULL
       AND (
         (date || ' ' || COALESCE(NULLIF(time, ''), '00:00:00'))::TIMESTAMP
         + INTERVAL '30 minutes'
       ) < NOW()
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM expired;

  RETURN COALESCE(v_count, 0);
END $$;

REVOKE ALL ON FUNCTION public.expire_stale_trips() FROM PUBLIC, anon, authenticated;
-- Only postgres role + cron can invoke. Admins running it manually from
-- the SQL editor inherit postgres privileges.

-- ─── 2) Backfill existing stale trips immediately ────────────────────────

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  v_count := public.expire_stale_trips();
  RAISE NOTICE 'Migration 012 backfill: flipped % stale confirmed trips to completed', v_count;
END $$;

COMMIT;

-- =============================================================================
-- After applying, schedule the daily cron job (one-time):
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--
--   SELECT cron.schedule(
--     'expire-stale-trips',
--     '15 0 * * *',  -- 00:15 UTC daily (~02:15 Asia/Jerusalem)
--     $cron$ SELECT public.expire_stale_trips() $cron$
--   );
--
--   -- Verify:
--   SELECT * FROM cron.job WHERE jobname = 'expire-stale-trips';
--
-- Run on demand:
--
--   SELECT public.expire_stale_trips();  -- returns count of trips flipped
--
-- =============================================================================
-- Verification queries
-- =============================================================================
--
-- 1) After applying, count any remaining stale 'confirmed' trips:
--
--    SELECT COUNT(*) FROM public.trips
--    WHERE status = 'confirmed'
--      AND (date || ' ' || COALESCE(NULLIF(time, ''), '00:00:00'))::TIMESTAMP
--          + INTERVAL '30 minutes' < NOW();
--    Expected: 0
--
-- 2) Spot-check that the function actually runs:
--
--    SELECT public.expire_stale_trips();
--    Expected: 0 (everything was just backfilled)
-- =============================================================================
