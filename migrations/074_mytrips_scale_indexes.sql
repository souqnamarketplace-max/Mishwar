-- ════════════════════════════════════════════════════════════════════════
-- Migration 074 — Index for /my-trips driver hot path
-- ════════════════════════════════════════════════════════════════════════
--
-- The /my-trips page loads a driver's posted trips via:
--   SELECT * FROM trips
--    WHERE driver_email = $1
--    ORDER BY created_at DESC
--    LIMIT 25;
--
-- Before this migration there was no index on driver_email, so this is
-- a full-table seq scan every time a driver opens the page. At 1k trips
-- total it's fast enough; at 100k it noticeably stalls (~150ms+).
--
-- The companion booking query (passenger side) is already indexed by
-- migration 056: idx_bookings_passenger_created (passenger_email, created_at DESC).
-- This is the symmetric driver-side index.
--
-- Composite (driver_email, created_at DESC) so the planner can:
--   1. Seek directly to the driver's rows
--   2. Read them in already-sorted order without a separate sort step
--   3. LIMIT 25 stops as soon as 25 rows are returned
--
-- DESC order on created_at matters because the existing index ordering
-- direction lets Postgres use a forward index scan instead of a backward
-- scan. Backward scans are technically allowed but the planner sometimes
-- chooses a sort+seq-scan instead, which is worse.
--
-- Pattern matches existing migration 056 conventions (no CONCURRENTLY
-- since the table is small; idempotent IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE INDEX IF NOT EXISTS idx_trips_driver_created
  ON public.trips (driver_email, created_at DESC);

-- ─── Bonus: a (driver_email, date) index for the date-range filter ───
-- /my-trips can now filter by trip date (the new UX from frontend mig
-- alongside this). The query becomes:
--   WHERE driver_email = $1 AND date >= $2 AND date <= $3
-- With this index the planner can do a single bitmap-and on both
-- predicates. Without it, it would seq-scan all driver trips and
-- filter in memory — fine for 100 trips, slow at 10k.
CREATE INDEX IF NOT EXISTS idx_trips_driver_date
  ON public.trips (driver_email, date DESC);

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_idx1 BOOLEAN;
  v_idx2 BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'trips'
       AND indexname  = 'idx_trips_driver_created'
  ) INTO v_idx1;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'trips'
       AND indexname  = 'idx_trips_driver_date'
  ) INTO v_idx2;

  IF NOT v_idx1 THEN RAISE EXCEPTION 'MIGRATION 074 FAILED — idx_trips_driver_created missing'; END IF;
  IF NOT v_idx2 THEN RAISE EXCEPTION 'MIGRATION 074 FAILED — idx_trips_driver_date missing'; END IF;

  RAISE NOTICE 'MIGRATION 074 OK — driver_email + date indexes in place for /my-trips at scale';
END;
$$;
