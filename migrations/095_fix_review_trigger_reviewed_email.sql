-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: review trigger references non-existent column 'reviewed_email'
--
-- Why: migration 002 created guard_review_must_have_booking() with a
-- COALESCE(NEW.reviewed_email, NEW.passenger_email) clause for the
-- driver_rates_passenger branch. Neither column exists on public.reviews.
-- The actual column for "who is being reviewed" is rated_user_email.
--
-- When a driver tries to rate a passenger:
--   - Client sends rated_user_email correctly
--   - BEFORE INSERT trigger evaluates NEW.reviewed_email
--   - PostgreSQL raises 42703 "record 'new' has no field 'reviewed_email'"
--   - Insert fails, driver sees REST 400 error
--
-- Fix: replace NEW.reviewed_email with NEW.rated_user_email so the trigger
-- correctly looks up the passenger that the driver is rating.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_review_must_have_booking()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  has_relation BOOLEAN;
BEGIN
  -- Admin can override (rare; for moderation / restoration)
  IF public.auth_user_role() = 'admin' THEN RETURN NEW; END IF;

  IF NEW.review_type = 'passenger_rates_driver' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.trips t ON t.id::text = b.trip_id
      WHERE b.passenger_email = NEW.reviewer_email
        AND t.driver_email    = NEW.driver_email
        AND b.status IN ('confirmed','completed')
        AND t.status IN ('completed','in_progress')
    ) INTO has_relation;
  ELSIF NEW.review_type = 'driver_rates_passenger' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.trips t ON t.id::text = b.trip_id
      WHERE t.driver_email    = NEW.reviewer_email
        AND b.passenger_email = NEW.rated_user_email
        AND b.status IN ('confirmed','completed')
        AND t.status IN ('completed','in_progress')
    ) INTO has_relation;
  ELSE
    RAISE WARNING 'unknown review_type %', NEW.review_type;
    RETURN NEW;
  END IF;

  IF NOT has_relation THEN
    RAISE EXCEPTION 'reviewer must have a completed booking with the reviewed party'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;
