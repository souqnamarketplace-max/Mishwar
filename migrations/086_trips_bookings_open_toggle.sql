-- ═══════════════════════════════════════════════════════════════════════════
-- 086_trips_bookings_open_toggle.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Adds the "trip open / closed for new bookings" toggle requested by the
-- Poparide-inspired feature pass. Drivers can stop accepting NEW bookings
-- on a trip without cancelling it — existing confirmed/pending bookings
-- remain valid and the trip continues toward departure as normal.
--
-- USE CASES:
--   1. "Soft full" — 3 of 4 seats booked, driver doesn't want a 4th
--      stranger but doesn't want to fill the seat either
--   2. Final-day cutoff — driver wants to lock the roster a few hours
--      before departure so no last-minute additions complicate pickup
--   3. Test posts / sandbox trips that shouldn't appear in search to
--      the public
--
-- DIFFERENT FROM available_seats=0:
--   When available_seats=0 (genuinely full), the booking RPC already
--   refuses. bookings_open=FALSE is a separate "I chose to stop"
--   signal, even when seats remain — gives drivers explicit control.
--
-- DIFFERENT FROM status='cancelled':
--   Cancelling triggers passenger notifications, refunds, and a strike
--   (mig 018). Closing for new bookings does NONE of those things —
--   it's a non-destructive toggle. Existing passengers see no change.
--
-- ─── DECISIONS ────────────────────────────────────────────────────────
--
-- 1. Default TRUE
--    New trips are bookable. Driver has to explicitly opt out, which
--    matches the "post a trip = I'm looking for passengers" mental model.
--
-- 2. NOT NULL
--    Avoids three-state logic (TRUE/FALSE/NULL) in the booking RPC.
--    A bigint of zero rows already exists at mig-deploy time but we
--    backfill via DEFAULT TRUE so existing trips remain bookable.
--
-- 3. Search visibility UNCHANGED
--    A closed-for-bookings trip still appears in /search results so
--    passengers see context ("driver Sami runs this route weekly").
--    The booking BUTTON is disabled, but the trip stays discoverable.
--    Future iteration could add a "hide from search" flag if needed.
--    Keeping it simple for v1.
--
-- 4. NOT a replacement for cancellation
--    Drivers who want passengers to see "this trip won't happen"
--    should cancel (mig 085). bookings_open=FALSE only stops NEW
--    bookings; the trip itself is still scheduled.

BEGIN;

-- ─── 1. Add the column ────────────────────────────────────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS bookings_open BOOLEAN NOT NULL DEFAULT TRUE;

-- Idempotency: if the column existed but was NULLable, this is a no-op.
-- If the migration is re-run after some trip got bookings_open=NULL
-- (shouldn't happen given the default, but defensive), set NULLs to TRUE.
UPDATE public.trips
   SET bookings_open = TRUE
 WHERE bookings_open IS NULL;

-- ─── 2. Update book_seat() to check bookings_open ────────────────────
--
-- Re-creating the FULL function body from mig 054 with one added check
-- (the bookings_open gate). Postgres CREATE OR REPLACE FUNCTION does
-- NOT support delta-style edits — we must include the whole body.
--
-- The ONLY change vs mig 054: lines 51-52 add the bookings_open check
-- after the status check, with a distinct error message so the
-- frontend can translate it specifically ("driver has closed this
-- trip for new bookings" vs the generic "not bookable").

CREATE OR REPLACE FUNCTION public.book_seat(
  p_trip_id        UUID,
  p_seats          INTEGER DEFAULT 1,
  p_pickup_city    TEXT    DEFAULT NULL,
  p_dropoff_city   TEXT    DEFAULT NULL,
  p_notes          TEXT    DEFAULT NULL,
  p_payment_method TEXT    DEFAULT NULL
) RETURNS public.bookings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_trip               public.trips%ROWTYPE;
  v_email              TEXT := public.auth_user_email();
  v_name               TEXT;
  v_book               public.bookings;
  v_strikes            INTEGER;
  v_strike_threshold   INTEGER := 3;
  v_onboarded          BOOLEAN;
  v_total_price        NUMERIC;
BEGIN
  IF v_email IS NULL                THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_seats < 1 OR p_seats > 6     THEN RAISE EXCEPTION 'invalid seat count'; END IF;

  -- Onboarding precheck (migration 034)
  SELECT COALESCE(onboarding_completed, FALSE)
  INTO v_onboarded
  FROM public.profiles
  WHERE email = v_email;
  IF NOT COALESCE(v_onboarded, FALSE) THEN
    RAISE EXCEPTION 'profile incomplete — finish onboarding before booking'
      USING ERRCODE = '42501';
  END IF;

  -- Strike check (migration 018)
  v_strikes := public.user_effective_strikes(v_email);
  IF v_strikes >= v_strike_threshold THEN
    RAISE EXCEPTION 'booking blocked due to strikes (%)', v_strikes
      USING ERRCODE = '42501';
  END IF;

  -- Sweep stale pending bookings on this trip (migration 045)
  PERFORM public.expire_stale_pending_bookings(p_trip_id);

  -- Lock trip
  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND                       THEN RAISE EXCEPTION 'trip not found'; END IF;
  IF v_trip.status <> 'confirmed'    THEN RAISE EXCEPTION 'trip not bookable (status=%)', v_trip.status; END IF;

  -- ── NEW in mig 086: bookings_open gate ──
  -- Driver-controlled "stop accepting new bookings" toggle. Distinct
  -- error code so the frontend translation in src/lib/errors.js can
  -- show a specific Arabic message ("السائق أوقف الحجوزات الجديدة")
  -- rather than the generic "not bookable" string.
  IF NOT COALESCE(v_trip.bookings_open, TRUE) THEN
    RAISE EXCEPTION 'driver has closed this trip for new bookings'
      USING ERRCODE = '42501';
  END IF;

  IF v_trip.driver_email = v_email   THEN RAISE EXCEPTION 'cannot book your own trip' USING ERRCODE = '42501'; END IF;

  -- Block check (migration 017)
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_email = v_email             AND blocked_email = v_trip.driver_email)
       OR (blocker_email = v_trip.driver_email AND blocked_email = v_email)
  ) THEN
    RAISE EXCEPTION 'cannot book — block exists between passenger and driver'
      USING ERRCODE = '42501';
  END IF;

  IF v_trip.available_seats < p_seats THEN
    RAISE EXCEPTION 'not enough seats (have %, need %)', v_trip.available_seats, p_seats;
  END IF;

  -- "Trip is in the past" check — Palestine local interpretation
  -- (migration 054). See header for context.
  IF ((v_trip.date + COALESCE(NULLIF(v_trip.time, '')::time, '00:00'::time))
       AT TIME ZONE 'Asia/Jerusalem') < NOW() THEN
    RAISE EXCEPTION 'trip is in the past';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE email = v_email;

  v_total_price := COALESCE(v_trip.price, 0) * p_seats;

  INSERT INTO public.bookings (
    trip_id, passenger_email, passenger_name, seats_booked,
    pickup_city, dropoff_city, notes, payment_method,
    payment_status, status, total_price
  ) VALUES (
    p_trip_id, v_email, v_name, p_seats,
    p_pickup_city, p_dropoff_city, p_notes, p_payment_method,
    'unpaid', 'pending', v_total_price
  )
  RETURNING * INTO v_book;

  -- Decrement available_seats atomically inside the transaction.
  UPDATE public.trips
     SET available_seats = available_seats - p_seats
   WHERE id = p_trip_id;

  RETURN v_book;
END;
$$;

REVOKE ALL ON FUNCTION public.book_seat(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_seat(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;

-- ─── VERIFICATION QUERIES (run manually in SQL editor) ────────────────
--
-- After applying:
--
--   -- Column check:
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'trips'
--      AND column_name = 'bookings_open';
--   -- Expect: boolean, true, NO
--
--   -- All existing trips backfilled to TRUE:
--   SELECT bookings_open, count(*)
--     FROM public.trips
--    GROUP BY bookings_open;
--   -- Expect 1 row: TRUE, <all trips>
--
--   -- Smoke test the new gate (as a passenger user in a fresh session,
--   -- attempt to book a trip after setting bookings_open=FALSE):
--   --   UPDATE trips SET bookings_open=FALSE WHERE id='<test-trip-id>';
--   --   SELECT public.book_seat('<test-trip-id>'::uuid, 1, ...);
--   -- Expect: ERROR 42501 — "driver has closed this trip for new bookings"
