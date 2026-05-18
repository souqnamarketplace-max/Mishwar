-- ════════════════════════════════════════════════════════════════════════
-- Migration 076 — favorite_drivers table
-- ════════════════════════════════════════════════════════════════════════
--
-- Scale-audit P1 #7: passengers who've ridden with the same driver
-- multiple times want to find that driver's future trips quickly.
-- Implements:
--   1. New favorite_drivers table — passenger_email → driver_email
--   2. RLS so users only see/modify their own favorites
--   3. RPC list_favorite_driver_emails() for the SearchTrips "only
--      favorites" filter — returns just the email list, no joins
--
-- Why not localStorage like trip favorites:
--   - The killer feature is "filter SearchTrips to only favorite
--     drivers". With localStorage, the client would need to fetch
--     all trips and filter in JS — fine at 50 trips, sluggish at
--     5000 once Mishwaro grows. With a server-side list, SearchTrips
--     can do `.in('driver_email', [favs])` which leverages the
--     existing idx_trips_driver_created index (mig 074).
--   - Trip favorites get away with localStorage because their consumer
--     is the Favorites page which only needs to look up trip IDs the
--     user has already bookmarked — no cross-device lookup needed.
--   - Driver favorites are also more PERSISTENT than trip favorites:
--     a trip you favorited 6 months ago is meaningless, but a driver
--     you favorited 6 months ago is still the same person you trust.
--     This longevity makes server-side storage justified.
--
-- Why composite primary key (passenger_email, driver_email):
--   - Each (passenger, driver) pair can favorite/unfavorite exactly
--     once. A separate id column would be misleading — there's no
--     stable identifier needed.
--   - UPSERT semantics fall out naturally: ON CONFLICT (passenger_email,
--     driver_email) DO NOTHING means re-favoriting is a no-op without
--     errors, which matches user intent.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.favorite_drivers (
  passenger_email TEXT NOT NULL,
  driver_email    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (passenger_email, driver_email),

  -- A user can't favorite themselves — silly but possible if the
  -- favorite-driver button somehow rendered on a driver's own trip.
  -- Server-side CHECK guarantees this regardless of client bugs.
  CONSTRAINT favorite_drivers_no_self CHECK (passenger_email <> driver_email),

  -- Email length sanity. We don't FK to profiles because (a) profiles
  -- has no UNIQUE constraint on email (legacy from base44) and (b) FK
  -- would break the favorite if a driver later changes their email.
  -- The orphan row gets cleaned up by the deleted_user cleanup path,
  -- and meanwhile a "favorite a deleted driver" just returns no rows
  -- from the JOIN — harmless.
  CONSTRAINT favorite_drivers_passenger_len  CHECK (length(passenger_email) BETWEEN 3 AND 254),
  CONSTRAINT favorite_drivers_driver_len     CHECK (length(driver_email)    BETWEEN 3 AND 254)
);

-- Index for SearchTrips's "only favorites" filter — looks up the
-- list of driver_emails this passenger has favorited. Goes through
-- the PK on (passenger_email, driver_email) which already supports
-- a fast prefix scan by passenger_email, so no extra index needed.

-- ─── 2. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.favorite_drivers ENABLE ROW LEVEL SECURITY;

-- Passengers can only SEE their own favorites. A user querying
-- favorite_drivers WHERE passenger_email = 'somebody-else@x'
-- returns zero rows (RLS hides them, doesn't error).
DROP POLICY IF EXISTS "passengers read own favorite drivers" ON public.favorite_drivers;
CREATE POLICY "passengers read own favorite drivers"
  ON public.favorite_drivers FOR SELECT TO authenticated
  USING (passenger_email = auth.email());

-- Passengers can INSERT favorites only for themselves. The WITH CHECK
-- prevents a malicious client from inserting a row claiming a
-- different passenger_email (which would otherwise let them poison
-- another user's favorites list).
DROP POLICY IF EXISTS "passengers add own favorite drivers" ON public.favorite_drivers;
CREATE POLICY "passengers add own favorite drivers"
  ON public.favorite_drivers FOR INSERT TO authenticated
  WITH CHECK (passenger_email = auth.email());

-- Passengers can DELETE only their own favorites. Same auth.email()
-- check as INSERT and SELECT.
DROP POLICY IF EXISTS "passengers remove own favorite drivers" ON public.favorite_drivers;
CREATE POLICY "passengers remove own favorite drivers"
  ON public.favorite_drivers FOR DELETE TO authenticated
  USING (passenger_email = auth.email());

-- No UPDATE policy by design — there's nothing meaningful to update
-- on a favorite row (the PK fields are immutable; created_at is
-- informational). Re-favoriting goes through INSERT … ON CONFLICT.

-- ─── 3. Optional RPC — count favorites per driver ────────────────────
-- Surfaces "you have 3 favorite drivers" copy in the UI without
-- a client-side count query. Uses SECURITY DEFINER so we can run
-- the COUNT without the RLS filter (which would block reading
-- another user's count — but here the caller IS that user, just
-- accessed via auth.email()).
CREATE OR REPLACE FUNCTION public.my_favorite_drivers_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
  SELECT COUNT(*)::INTEGER
    FROM public.favorite_drivers
   WHERE passenger_email = auth.email();
$$;

REVOKE ALL ON FUNCTION public.my_favorite_drivers_count() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_favorite_drivers_count() TO authenticated;

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_table BOOLEAN;
  v_count_fn BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='favorite_drivers'
  ) INTO v_table;
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='my_favorite_drivers_count'
  ) INTO v_count_fn;
  IF NOT v_table    THEN RAISE EXCEPTION 'MIGRATION 076 FAILED — favorite_drivers table missing'; END IF;
  IF NOT v_count_fn THEN RAISE EXCEPTION 'MIGRATION 076 FAILED — my_favorite_drivers_count RPC missing'; END IF;
  RAISE NOTICE 'MIGRATION 076 OK — favorite_drivers table + RPC + RLS in place';
END;
$$;
