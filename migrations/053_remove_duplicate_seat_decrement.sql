-- ════════════════════════════════════════════════════════════════════════
-- Migration 053 — Remove duplicate seat decrement from booking trigger
-- ════════════════════════════════════════════════════════════════════════
--
-- THE BUG
-- Two pieces of code decrement public.trips.available_seats on every
-- booking insert:
--
--   1. The book_seat RPC (migration 003, refined in 037/045):
--        UPDATE public.trips
--        SET available_seats = available_seats - p_seats
--        WHERE id = p_trip_id;
--
--   2. The notify_driver_on_booking trigger (supabase-triggers.sql,
--      legacy base44-cloud-function replacement):
--        UPDATE public.trips
--        SET available_seats = GREATEST(0,
--              COALESCE(available_seats,1) - COALESCE(NEW.seats_booked,1))
--        WHERE id = trip_record.id;
--
-- Because the trigger fires AFTER INSERT but BEFORE the next statement
-- in book_seat's function body, the actual execution order inside a
-- single book_seat call is:
--
--   a. INSERT INTO bookings (...);
--   b. trigger fires → available_seats := GREATEST(0, X - 1)
--   c. book_seat's inline UPDATE → available_seats := available_seats - 1
--
-- For a trip starting with available_seats = N:
--   N=3 → trigger sets 2, then RPC sets 1.  Off by one (under-counted).
--   N=2 → trigger sets 1, then RPC sets 0.  Off by one (under-counted).
--   N=1 → trigger sets 0, then RPC sets -1 →
--         CHECK constraint trips_available_seats_check (>= 0) fires →
--         23514. Booking insert fails. Passenger sees
--         "البيانات لا تطابق الشروط المطلوبة" toast.
--
-- This was hidden for trips with seats > 1 because GREATEST clamped the
-- final value to a still-valid (but wrong) number. The hard CHECK
-- failure on the last seat is what made it visible.
--
-- THE FIX
-- Drop the trigger's seat-decrement UPDATE. book_seat does this
-- correctly inside the transaction with FOR UPDATE on the trip row —
-- which the trigger version doesn't, so the trigger version isn't
-- even concurrency-safe. The trigger's other job (notify the driver)
-- is preserved.
--
-- WHAT ABOUT NON-book_seat BOOKING INSERTS?
-- The seed file (seed_apple_reviewer_accounts.sql) and admin tools
-- are the only paths that INSERT directly into bookings outside the
-- RPC. The seed file already temporarily DISABLEs prevent_passenger_
-- booking_conflict for its seed insert; admins create bookings that
-- represent historical fact and don't expect seats to be decremented.
-- So the trigger doing the decrement was wrong for those paths too.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_driver_on_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  trip_record RECORD;
BEGIN
  -- Fetch the trip this booking is for
  SELECT * INTO trip_record
  FROM public.trips
  WHERE id::text = NEW.trip_id
  LIMIT 1;

  IF trip_record IS NULL THEN
    RETURN NEW;
  END IF;

  -- Notify the driver. Wrap in EXCEPTION so a transient notification
  -- failure (e.g. notifications table CHECK violation if migration 037
  -- isn't applied) doesn't abort the booking itself — the booking
  -- is the authoritative side-effect, the notification is best-effort.
  BEGIN
    INSERT INTO public.notifications (
      user_email, title, message, type, trip_id, from_city, to_city, is_read, created_by
    ) VALUES (
      trip_record.driver_email,
      '🎉 حجز جديد لرحلتك',
      COALESCE(NEW.passenger_name, 'راكب') || ' حجز ' || COALESCE(NEW.seats_booked, 1)::text ||
        ' مقاعد في رحلتك من ' || trip_record.from_city || ' إلى ' || trip_record.to_city,
      'system',
      trip_record.id::text,
      trip_record.from_city,
      trip_record.to_city,
      false,
      'system'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notify_driver_on_booking: notification skip for booking % — %',
      NEW.id, SQLERRM;
  END;

  -- ─── REMOVED — see migration 053 header ─────────────────────────────
  -- Previously this trigger also ran:
  --   UPDATE public.trips
  --   SET available_seats = GREATEST(0, available_seats - NEW.seats_booked)
  --   WHERE id = trip_record.id;
  -- The book_seat RPC already does this atomically inside its own
  -- transaction with FOR UPDATE on the trip row. Running it here a
  -- second time double-decremented every booking and produced a hard
  -- CHECK-constraint failure (23514) on the last seat. Removed.

  RETURN NEW;
END;
$$;

-- The trigger itself doesn't need to be re-created — it references
-- this function by name and the CREATE OR REPLACE above swaps the body
-- atomically. Confirm it's still wired up to the right table/event:
DO $$
DECLARE
  v_trigger_ok BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_booking_created'
      AND NOT tgisinternal
  ) INTO v_trigger_ok;

  IF NOT v_trigger_ok THEN
    RAISE EXCEPTION 'MIGRATION 053 FAILED: on_booking_created trigger not present — should have been created by supabase-triggers.sql';
  END IF;

  RAISE NOTICE 'MIGRATION 053 OK — notify_driver_on_booking no longer decrements seats';
END $$;

-- ─── Reseat already-affected trips ───────────────────────────────────
-- For trips that were silently double-decremented but didn't hit the
-- CHECK (i.e. seats > 1 when book_seat was called), available_seats
-- has been under-counted. The correct value for available_seats is
-- always:
--   total_seats - SUM(seats_booked) over all non-cancelled bookings
--
-- Re-compute it for every trip with status confirmed/in_progress so
-- the display catches up. completed/cancelled trips don't need fixing
-- (no future booking will be made on them).

UPDATE public.trips t
SET available_seats = GREATEST(0, LEAST(
      t.total_seats,
      t.total_seats - COALESCE((
        SELECT SUM(b.seats_booked)
        FROM public.bookings b
        WHERE b.trip_id = t.id::text
          AND b.status IN ('pending', 'confirmed', 'in_progress')
      ), 0)
    ))
WHERE t.status IN ('confirmed', 'in_progress');

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_mismatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_mismatched
  FROM public.trips t
  WHERE t.status IN ('confirmed', 'in_progress')
    AND t.available_seats <> GREATEST(0, LEAST(
          t.total_seats,
          t.total_seats - COALESCE((
            SELECT SUM(b.seats_booked)
            FROM public.bookings b
            WHERE b.trip_id = t.id::text
              AND b.status IN ('pending', 'confirmed', 'in_progress')
          ), 0)
        ));

  IF v_mismatched > 0 THEN
    RAISE WARNING 'MIGRATION 053: % trip(s) still have mismatched available_seats after reseat — manual review needed', v_mismatched;
  ELSE
    RAISE NOTICE 'MIGRATION 053 OK — all active trips now have correct available_seats';
  END IF;
END $$;
