-- ═══════════════════════════════════════════════════════════════════════════
-- MISHWAR — Migration 001: Driver Linkage + Multi-Stop Trips
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor AFTER supabase-production.sql.
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS guards everywhere).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1) Add driver_id UUID to trips ──────────────────────────────────────────
-- Why: links trips to auth.users(id) with referential integrity. The existing
-- driver_email/driver_name/driver_phone columns become a denormalized cache
-- (kept for query speed — avoids a JOIN on every list view).
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trips_driver_id ON public.trips(driver_id);

-- ─── 2) Add stops JSONB to trips (multi-stop support) ────────────────────────
-- Format: [{"city":"سلفيت","location":"دوار البلدية","time":"10:30","price_from_origin":25,"seats_picked_up":0}, ...]
-- A direct trip has stops = []. A multi-stop trip lists the intermediate cities
-- in order; the final destination remains in to_city/to_location.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS stops JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Constraint: stops must be a JSON array (defensive — JSONB itself is loose)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trips_stops_is_array'
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_stops_is_array CHECK (jsonb_typeof(stops) = 'array');
  END IF;
END $$;

-- ─── 3) GIN index on stops for fast "trip passes through city X" search ──────
CREATE INDEX IF NOT EXISTS idx_trips_stops_gin
  ON public.trips USING GIN (stops jsonb_path_ops);

-- ─── 4) dropoff_stop_index in bookings (passenger picks where to get off) ────
-- NULL = passenger goes all the way to to_city (default).
-- 0..N-1 = passenger gets off at that stop index (0 = first intermediate stop).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS dropoff_stop_index INTEGER
    CHECK (dropoff_stop_index IS NULL OR dropoff_stop_index >= 0);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS dropoff_city TEXT;  -- denormalized city name for receipts/queries

-- ─── 5) Backfill driver_id on existing trips by matching driver_email ────────
UPDATE public.trips t
SET driver_id = u.id
FROM auth.users u
WHERE t.driver_id IS NULL
  AND t.driver_email IS NOT NULL
  AND lower(u.email) = lower(t.driver_email);

-- ─── 6) Helper: trips_with_via — view that exposes intermediate cities flatly ─
-- Useful for queries / dashboards. Can be queried like a normal table.
CREATE OR REPLACE VIEW public.trips_with_via AS
SELECT
  t.*,
  COALESCE(
    ARRAY(SELECT (jsonb_array_elements(t.stops)->>'city')::text),
    ARRAY[]::text[]
  ) AS via_cities,
  jsonb_array_length(t.stops) AS stops_count
FROM public.trips t;

GRANT SELECT ON public.trips_with_via TO anon, authenticated;

-- ─── 7) Trigger: keep driver_email/driver_name in sync if driver profile changes
-- Optional convenience — when a driver updates their profile, future trips
-- auto-pick up the new info. Skipped here because the denormalized columns
-- intentionally snapshot the driver state at trip creation time.

-- ─── 8) Notify PostgREST so schema cache refreshes ───────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ─── Sanity checks (run after the migration) ────────────────────────────────
-- SELECT count(*) AS total_trips, count(driver_id) AS trips_with_driver_id FROM public.trips;
-- SELECT count(*) AS multi_stop_trips FROM public.trips WHERE jsonb_array_length(stops) > 0;
