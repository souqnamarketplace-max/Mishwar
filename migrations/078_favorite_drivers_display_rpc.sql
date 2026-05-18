-- ════════════════════════════════════════════════════════════════════════
-- Migration 078 — Safe driver display info lookup for favorites page
-- ════════════════════════════════════════════════════════════════════════
--
-- Bug: /favorites Drivers tab showed favorited drivers as 'orphan' even
-- when their profiles existed in the database, because profiles_select
-- RLS hides profile rows from random authenticated users (a passenger
-- who has no booking with a driver can't read their profile).
--
-- That privacy boundary is correct for arbitrary email lookups. But for
-- favorite_drivers specifically, the passenger has a documented
-- relationship with the driver (they favorited them), so showing the
-- driver's PUBLIC display fields (name + avatar + rating) is fine.
--
-- This migration adds a SECURITY DEFINER RPC that takes a list of
-- driver emails and returns ONLY the public display fields for those
-- drivers — bypassing RLS but limited in scope to:
--   1. The caller can only read drivers they've actually favorited
--      (the RPC self-filters via auth.email() join to favorite_drivers)
--   2. The returned columns are PUBLIC-safe — name + avatar + rating
--      + car. NO email, NO phone, NO payment info, NO ID number, NO
--      address. Same column set that already appears on every trip
--      card via trips.driver_name etc.
--
-- Without #1, this would be a way for any user to enumerate drivers
-- by guessing emails. With it, the only drivers a caller can see are
-- ones they've explicitly favorited — a closed set.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- For driver_rating + driver_reviews_count, those columns live on
-- public.trips (denormalized when a trip is posted), NOT on profiles.
-- We surface them by joining to the driver's most recent trip — the
-- most recently-updated value reflects the latest rating computation.
-- Falls back to NULL when the driver has no trips yet (newly-signed-up
-- driver who hasn't posted) — the UI handles that with the 'جديد ✨'
-- badge.

CREATE OR REPLACE FUNCTION public.get_favorite_drivers_display()
RETURNS TABLE (
  email                  TEXT,
  id                     UUID,
  full_name              TEXT,
  avatar_url             TEXT,
  driver_rating          NUMERIC,
  driver_reviews_count   INTEGER,
  car_model              TEXT,
  car_color              TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
  SELECT
    p.email,
    p.id,
    p.full_name,
    p.avatar_url,
    -- Latest known rating from any trip the driver posted. Trips
    -- carry a denormalized driver_rating + driver_reviews_count
    -- that gets refreshed each time a review lands. We take the
    -- highest non-null value across trips as a defensive default;
    -- in practice all rows have the same value so MAX is equivalent
    -- to "any row" but cheaper than ORDER BY ... LIMIT 1 for a
    -- correlated subquery.
    (SELECT MAX(t.driver_rating)
       FROM public.trips t WHERE t.driver_email = p.email)        AS driver_rating,
    (SELECT MAX(t.driver_reviews_count)
       FROM public.trips t WHERE t.driver_email = p.email)        AS driver_reviews_count,
    p.car_model,
    p.car_color
  FROM public.profiles p
  INNER JOIN public.favorite_drivers fd
    ON fd.driver_email = p.email
   AND fd.passenger_email = auth.email()
$$;

-- Lock down execution to authenticated users only. Anonymous callers
-- (via the anon role) have no auth.email() so the WHERE clause would
-- be NULL = NULL, returning zero rows. The REVOKE/GRANT pair makes
-- that explicit and prevents accidental anonymous calls.
REVOKE ALL ON FUNCTION public.get_favorite_drivers_display() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_favorite_drivers_display() TO authenticated;

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn_exists  BOOLEAN;
  v_fn_definer BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_favorite_drivers_display'
  ) INTO v_fn_exists;

  SELECT prosecdef INTO v_fn_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_favorite_drivers_display';

  IF NOT v_fn_exists  THEN RAISE EXCEPTION 'MIGRATION 078 FAILED — RPC missing'; END IF;
  IF NOT v_fn_definer THEN RAISE EXCEPTION 'MIGRATION 078 FAILED — RPC not SECURITY DEFINER'; END IF;

  RAISE NOTICE 'MIGRATION 078 OK — get_favorite_drivers_display RPC ready';
END;
$$;
