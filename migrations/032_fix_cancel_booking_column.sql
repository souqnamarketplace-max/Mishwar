-- ════════════════════════════════════════════════════════════════════════
-- Migration 032 — Fix `seats_total` typo in cancel_booking
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- Booking cancellation has been failing in production with:
--   ERROR:  column "seats_total" does not exist (SQLSTATE 42703)
--
-- Migration 018 introduced cancel_booking(UUID, TEXT). The seat-refund
-- branch (line ~206 of that file) caps the new available_seats at the
-- trip's total capacity using:
--
--   LEAST(available_seats + booked, COALESCE(seats_total, 20))
--                                            ^^^^^^^^^^^
-- The actual column on public.trips is `total_seats`, not `seats_total`
-- (see supabase-production.sql trips definition: total_seats INTEGER
-- DEFAULT 4). The function was never exercised by tests against a real
-- schema, so the typo only surfaces when a user (passenger, driver, or
-- admin) tries to cancel a confirmed booking — i.e. exactly the path the
-- user reported failing today.
--
-- The fix is one character (column name swap). We recreate the entire
-- function body via CREATE OR REPLACE so the change is atomic — no
-- DROP+CREATE window where the function is missing and clients hit
-- "function not found" instead.
--
-- The legacy 1-arg overload `cancel_booking(UUID)` is unchanged; it
-- simply forwards to the 2-arg version, so this single fix repairs
-- both call paths.
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_booking(booking_id_param UUID, reason_param TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  booking_record       public.bookings%ROWTYPE;
  trip_record          public.trips%ROWTYPE;
  caller_email         TEXT := public.auth_user_email();
  caller_role          TEXT := public.auth_user_role();
  is_passenger_cancel  BOOLEAN;
  hours_until_trip     NUMERIC;
  is_late              BOOLEAN := FALSE;
  v_window_days        INTEGER := 30;
  v_current_strikes    INTEGER;
  v_last_cancelled     TIMESTAMPTZ;
BEGIN
  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO booking_record FROM public.bookings WHERE id = booking_id_param;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF booking_record.status = 'cancelled' THEN
    RAISE EXCEPTION 'booking already cancelled';
  END IF;

  -- Authorization: passenger, the trip's driver, or an admin
  is_passenger_cancel := (booking_record.passenger_email = caller_email);

  IF NOT is_passenger_cancel
     AND NOT EXISTS (SELECT 1 FROM public.trips WHERE id::text = booking_record.trip_id AND driver_email = caller_email)
     AND caller_role <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized to cancel this booking' USING ERRCODE = '42501';
  END IF;

  -- Look up the trip — needed for the late-cancellation check + seat refund
  SELECT * INTO trip_record FROM public.trips WHERE id::text = booking_record.trip_id;

  IF FOUND AND trip_record.date IS NOT NULL THEN
    hours_until_trip := EXTRACT(
      EPOCH FROM (
        (trip_record.date::timestamptz + COALESCE(trip_record.time::time, '00:00'::time)) - now()
      )
    ) / 3600;
    -- Only late if BEFORE departure (we don't strike for cancelling
    -- already-completed trips — that's a no-show, separate handling)
    is_late := hours_until_trip > 0 AND hours_until_trip < 2;
  END IF;

  -- ─── Apply strike for late passenger cancellation ───
  IF is_passenger_cancel AND is_late THEN
    -- Read current state to decide if we're starting a fresh window
    SELECT strike_count, last_cancelled_at
    INTO v_current_strikes, v_last_cancelled
    FROM public.profiles WHERE email = caller_email;

    -- If the previous strike is older than the rolling window, reset
    -- before incrementing — this gives users a clean slate after 30
    -- days of good behaviour.
    IF v_last_cancelled IS NULL
       OR (now() - v_last_cancelled) > (v_window_days || ' days')::interval THEN
      v_current_strikes := 0;
    END IF;

    UPDATE public.profiles
    SET cancellation_count      = COALESCE(cancellation_count, 0) + 1,
        late_cancellation_count = COALESCE(late_cancellation_count, 0) + 1,
        strike_count            = COALESCE(v_current_strikes, 0) + 1,
        last_cancelled_at       = now()
    WHERE email = caller_email;
  ELSIF is_passenger_cancel THEN
    -- On-time passenger cancellation — count it but no strike
    UPDATE public.profiles
    SET cancellation_count = COALESCE(cancellation_count, 0) + 1,
        last_cancelled_at  = now()
    WHERE email = caller_email;
  END IF;

  -- Mark the booking cancelled (with optional reason)
  UPDATE public.bookings
  SET status     = 'cancelled',
      updated_at = now(),
      cancellation_reason = COALESCE(reason_param, cancellation_reason)
  WHERE id = booking_id_param;

  -- Refund the seats back to the trip pool, but only if the booking
  -- had been confirmed (pending bookings never decremented seats in
  -- some legacy flows; our book_seat does decrement on pending too).
  -- Use GREATEST guard against double-refund corruption.
  --
  -- BUGFIX (032): was `seats_total` which doesn't exist on this table.
  -- The actual column is `total_seats`. The typo only manifested at
  -- runtime — Postgres doesn't validate column references inside a
  -- function body until the function is executed, so migration 018
  -- created the function fine and the error stayed dormant until the
  -- first cancellation hit this branch.
  IF FOUND AND trip_record.id IS NOT NULL AND booking_record.status IN ('pending', 'confirmed') THEN
    UPDATE public.trips
    SET available_seats = LEAST(
          GREATEST(available_seats + COALESCE(booking_record.seats_booked, 1), 0),
          COALESCE(total_seats, 20)
        ),
        updated_at = now()
    WHERE id::text = booking_record.trip_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.cancel_booking(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT) TO authenticated;

-- ─── Verification ──────────────────────────────────────────────────────
-- Confirm the function compiles cleanly with the new column name.
-- (CREATE OR REPLACE doesn't fail on undefined columns — Postgres
-- only resolves them at execution time — so we explicitly EXPLAIN a
-- minimal SELECT against the column to surface any future regression.)
DO $$
BEGIN
  PERFORM total_seats FROM public.trips LIMIT 0;
  RAISE NOTICE 'MIGRATION 032 OK — total_seats column resolved on public.trips';
EXCEPTION
  WHEN undefined_column THEN
    RAISE EXCEPTION 'MIGRATION 032 FAILED: column total_seats not found on public.trips — schema drift';
END $$;
