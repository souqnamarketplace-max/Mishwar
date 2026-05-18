-- ════════════════════════════════════════════════════════════════════════
-- Migration 077 — Notify passengers when their favorite driver posts a trip
-- ════════════════════════════════════════════════════════════════════════
--
-- User-reported gap: 'does the favorite-drivers feature help the passenger
-- if the driver hasn't posted a trip / deleted a trip?'.
--
-- Mig 076 added the favorite_drivers table + the SearchTrips filter, but
-- the feature was PURELY REACTIVE — the passenger had to open
-- /search-trips?favs=1 to discover a new trip. There was no signal when
-- a favorite driver posted something new.
--
-- This migration adds a trigger on trips INSERT that pings every passenger
-- who has favorited the driver. Pattern mirrors mig 038's
-- trg_notify_matching_route_preferences exactly:
--   - AFTER INSERT trigger
--   - SECURITY DEFINER so it can write into notifications (which has
--     RLS restricting INSERTs to via create_notification RPC)
--   - Only fires for status='confirmed' trips (matches mig 038)
--   - Walks favorite_drivers WHERE driver_email = NEW.driver_email and
--     inserts one notification per passenger
--
-- Deduplication consideration:
-- A passenger could be subscribed to both a route preference AND have the
-- driver favorited. They'll get 2 pings — once from mig 038 trigger,
-- once from this one. We accept this as a feature (the favorite-driver
-- ping is more specific: 'Ahmad just posted a trip' vs 'a new trip on
-- your saved route'); a user who finds it noisy can unfavorite or
-- disable route alerts. Hard de-dup across two notification sources
-- would require a state table and add complexity for limited value.
--
-- Recurring trips edge case:
-- When a driver posts a recurring trip, CreateTrip.jsx inserts N row
-- iterations (one per future date). Each INSERT fires this trigger,
-- so passengers would get N pings for a 12-week recurring series.
-- We dedupe at the trigger level by ONLY notifying for the FIRST
-- inserted trip in a recurring series — detected via NEW.recurring_parent_id
-- being NULL (i.e. this IS the parent / standalone trip). Children get
-- the parent's notification implicitly because checking the favorited
-- driver's profile shows all upcoming trips.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- Check that recurring_parent_id column exists; if not we'll still
-- work but won't dedupe recurring children. Older migrations may or
-- may not have added it.
DO $$
DECLARE
  v_has_recurring_parent BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='trips' AND column_name='recurring_parent_id'
  ) INTO v_has_recurring_parent;
  IF NOT v_has_recurring_parent THEN
    RAISE NOTICE 'trips.recurring_parent_id not present — recurring trip dedup will fire on every series row. Acceptable but noisy.';
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.notify_favorite_driver_new_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_driver_name        TEXT;
  v_route_display      TEXT;
  v_date_display       TEXT;
  v_link               TEXT;
  v_message            TEXT;
  v_has_recurring_col  BOOLEAN;
  v_is_recurring_child BOOLEAN := FALSE;
  r                    RECORD;
  v_count              INTEGER := 0;
BEGIN
  -- Skip non-bookable statuses (drafts, cancelled at-insert, etc.)
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Don't ping for trips with no driver_email (legacy / anonymous rows).
  IF NEW.driver_email IS NULL OR length(trim(NEW.driver_email)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Recurring dedup. Only the FIRST trip in a recurring series gets the
  -- notification; subsequent children of the same parent suppress it.
  -- The column may not exist on older schemas — guard.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='trips' AND column_name='recurring_parent_id'
  ) INTO v_has_recurring_col;
  IF v_has_recurring_col THEN
    -- We can't reference NEW.recurring_parent_id at definition time if
    -- the column doesn't exist; use to_jsonb() trick to read the field
    -- safely regardless.
    v_is_recurring_child := (to_jsonb(NEW)->>'recurring_parent_id') IS NOT NULL;
    IF v_is_recurring_child THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Driver display name — same fallback logic as mig 038
  v_driver_name := COALESCE(NULLIF(TRIM(NEW.driver_name), ''), 'سائق');

  -- Route + date for the notification body
  v_route_display := COALESCE(NEW.from_city, '؟') || ' ← ' || COALESCE(NEW.to_city, '؟');
  v_date_display  := COALESCE(NEW.date::text, '');

  -- Deep link target — opens the trip detail page. Pattern matches
  -- the create_notification RPC's link contract: it's a relative
  -- path the frontend's getNotifTarget() will navigate to.
  v_link := '/trip/' || NEW.id::text;

  -- Body. Keep it short — push notification clients clip after ~120
  -- chars. The driver name + route + date is the meaningful content.
  v_message := v_driver_name || ' نشر رحلة جديدة: ' || v_route_display
            || CASE WHEN v_date_display <> '' THEN ' بتاريخ ' || v_date_display ELSE '' END
            || '. اضغط لعرض التفاصيل.';

  -- Walk every passenger who has favorited this driver. Send one
  -- notification each via the create_notification RPC (mig 027) so
  -- the RLS authorization model is preserved end-to-end.
  --
  -- We skip the driver themselves if somehow they favorited themselves
  -- (mig 076 has a CHECK constraint preventing this, but the SELECT
  -- here is cheap and defensive).
  FOR r IN
    SELECT passenger_email
      FROM public.favorite_drivers
     WHERE driver_email = NEW.driver_email
       AND passenger_email <> NEW.driver_email
  LOOP
    BEGIN
      PERFORM public.create_notification(
        p_user_email := r.passenger_email,
        p_title      := '🚗 سائق مفضل نشر رحلة جديدة',
        p_message    := v_message,
        p_type       := 'favorite_driver_new_trip',
        p_trip_id    := NEW.id,
        p_link       := v_link
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Per-passenger failure should NOT roll back the trip INSERT or
      -- block other passengers from being notified. Log via RAISE
      -- NOTICE (visible in pg logs) and continue.
      RAISE NOTICE 'notify_favorite_driver_new_trip: failed to notify % — %', r.passenger_email, SQLERRM;
    END;
  END LOOP;

  -- Pleasant log for debug — appears in pg log only, not user-facing.
  IF v_count > 0 THEN
    RAISE NOTICE 'notify_favorite_driver_new_trip: sent % notifications for trip %', v_count, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Hook the trigger. Same pattern as mig 038 — AFTER INSERT, FOR EACH ROW.
-- DROP+CREATE is idempotent so re-running this migration is safe.
DROP TRIGGER IF EXISTS trg_notify_favorite_driver_new_trip ON public.trips;
CREATE TRIGGER trg_notify_favorite_driver_new_trip
  AFTER INSERT ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_favorite_driver_new_trip();

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_trigger BOOLEAN;
  v_fn_definer BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_notify_favorite_driver_new_trip'
       AND NOT tgisinternal
  ) INTO v_trigger;

  SELECT prosecdef INTO v_fn_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='notify_favorite_driver_new_trip';

  IF NOT v_trigger    THEN RAISE EXCEPTION 'MIGRATION 077 FAILED — trigger missing'; END IF;
  IF NOT v_fn_definer THEN RAISE EXCEPTION 'MIGRATION 077 FAILED — function not SECURITY DEFINER'; END IF;

  RAISE NOTICE 'MIGRATION 077 OK — favorite-driver new-trip notifications now fire via trigger';
END;
$$;
