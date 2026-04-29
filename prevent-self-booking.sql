-- ============================================================
-- DEFENSE-IN-DEPTH: prevent driver from booking their own trip
-- Run this once in Supabase SQL Editor (idempotent)
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_no_self_booking()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trip_driver_email TEXT;
BEGIN
  -- Get the driver email of the trip being booked
  SELECT driver_email INTO trip_driver_email
  FROM public.trips
  WHERE id = NEW.trip_id;

  -- Reject if passenger and driver are the same person
  IF trip_driver_email IS NOT NULL 
     AND NEW.passenger_email IS NOT NULL
     AND lower(trip_driver_email) = lower(NEW.passenger_email) THEN
    RAISE EXCEPTION 'لا يمكنك حجز مقعد في رحلتك الخاصة' 
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any (idempotent)
DROP TRIGGER IF EXISTS prevent_self_booking ON public.bookings;

-- Create trigger that fires BEFORE INSERT
CREATE TRIGGER prevent_self_booking
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.check_no_self_booking();

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✅ Self-booking guard installed:';
  RAISE NOTICE '   Trigger: prevent_self_booking on public.bookings (BEFORE INSERT)';
  RAISE NOTICE '   Function: public.check_no_self_booking()';
  RAISE NOTICE '   Behavior: rejects bookings where passenger_email = trip.driver_email';
END $$;
