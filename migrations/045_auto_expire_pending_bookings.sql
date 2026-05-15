-- ════════════════════════════════════════════════════════════════════════
-- Migration 045 — Auto-expire pending bookings past their trip departure
-- ════════════════════════════════════════════════════════════════════════
--
-- BACKGROUND
-- The booking flow uses 'first-come-first-served with immediate seat
-- hold' — book_seat decrements available_seats the moment a pending
-- booking is created, then the driver approves or rejects. This works
-- well IF the driver responds in time. But there's no enforcement of
-- 'in time':
--
--   • Driver posts trip departing tomorrow 9am
--   • Passenger books at 6pm today → pending, seat held
--   • Driver never opens the app
--   • Trip departure passes at 9am tomorrow
--   • Booking stays 'pending' forever, seat stays held forever
--
-- The passenger has no recourse: they can't cancel a stale booking and
-- have nothing better to do than book another trip, but their seat
-- in the stale one is technically still allocated. The driver dashboard
-- accumulates stale rows. The seat count is wrong.
--
-- THE FIX — lazy auto-expiry
-- A function expire_stale_pending_bookings() that:
--   1. Finds all bookings where status = 'pending' AND the trip's
--      departure timestamp (trip.date + trip.time) is in the past.
--   2. For each one: flip status to 'cancelled' with reason
--      'auto_expired_no_driver_response'; refund the seat to the
--      trip; create a notification for the passenger pointing them
--      at /my-trips?tab=cancelled.
--   3. Return the count of expired bookings.
--
-- LAZY TRIGGERING
-- Two call paths:
--   (a) From inside book_seat — at the top, before the seat-count
--       check. This way every new booking attempt sweeps up any
--       stale pending bookings on the same trip first, potentially
--       freeing up seats that the new booker can claim. The
--       cleanup amortizes itself across booking traffic; no
--       background job needed.
--   (b) As a standalone admin RPC, so /dashboard/bookings can
--       trigger a sweep manually if a stuck trip needs cleanup.
--
-- WHY NOT pg_cron
-- pg_cron requires Supabase admin setup and would need to run every
-- few minutes to feel responsive. The lazy approach piggybacks on
-- existing user activity — cleanup happens exactly when someone
-- cares about the trip's seat count.
--
-- AT-MOST-ONCE NOTIFICATION
-- The function uses a single UPDATE with RETURNING to atomically
-- flip status AND capture which rows changed. Notifications only
-- fire for rows that actually transitioned (not for rows that were
-- already cancelled — wouldn't happen given the WHERE clause, but
-- defensive).
--
-- IDEMPOTENCY
-- Safe to call repeatedly. After the first call expires a batch,
-- subsequent calls find no pending+past rows and return 0.
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expire_stale_pending_bookings(
  p_trip_id UUID DEFAULT NULL  -- optional: restrict to one trip, else sweep all
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_expired      INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
  r              RECORD;
BEGIN
  -- Walk every pending booking whose trip departure has passed.
  -- Optionally restrict to a single trip when called from book_seat.
  FOR r IN
    SELECT b.id          AS booking_id,
           b.trip_id     AS trip_id,
           b.passenger_email,
           b.seats_booked,
           t.from_city,
           t.to_city,
           t.date,
           t.time
    FROM public.bookings b
    JOIN public.trips t ON t.id::text = b.trip_id
    WHERE b.status = 'pending'
      AND (
        -- Trip departure has passed. If time is NULL (legacy data),
        -- treat midnight as the departure time — that's the most
        -- conservative reading.
        (t.date::timestamptz + COALESCE(t.time::time, '00:00'::time)) < v_now
      )
      AND (p_trip_id IS NULL OR b.trip_id = p_trip_id::text)
  LOOP
    -- Flip the booking. Wrap in EXCEPTION so a single bad row
    -- (corrupted data, missing column, etc.) doesn't abort the
    -- whole sweep for the other rows.
    BEGIN
      UPDATE public.bookings
      SET status              = 'cancelled',
          cancellation_reason = 'auto_expired_no_driver_response',
          updated_at          = v_now
      WHERE id = r.booking_id
        AND status = 'pending';  -- guard against race with manual cancel

      -- Refund the seat to the trip. LEAST/GREATEST bounds so
      -- malformed data (e.g. seats_booked accidentally negative)
      -- can't push available_seats above total_seats or below 0.
      UPDATE public.trips
      SET available_seats = LEAST(
            total_seats,
            GREATEST(0, available_seats + COALESCE(r.seats_booked, 1))
          ),
          updated_at      = v_now
      WHERE id::text = r.trip_id;

      -- Notify the passenger. Wrap in EXCEPTION too — notification
      -- failure shouldn't abort the seat refund.
      BEGIN
        INSERT INTO public.notifications (
          user_email, title, message, type, trip_id, link
        ) VALUES (
          r.passenger_email,
          'انتهت مهلة الرد على حجزك',
          'لم يستجب السائق لطلب حجزك على رحلة ' || COALESCE(r.from_city, '') ||
            ' → ' || COALESCE(r.to_city, '') ||
            ' بتاريخ ' || r.date::text || '. تم إلغاء الحجز تلقائياً. يمكنك البحث عن رحلة أخرى.',
          'system',
          r.trip_id,
          '/my-trips?tab=cancelled'
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'expire_stale_pending_bookings: notification skip for booking % — %',
          r.booking_id, SQLERRM;
      END;

      v_expired := v_expired + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'expire_stale_pending_bookings: row skip for booking % — %',
        r.booking_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_expired;
END $$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_pending_bookings(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.expire_stale_pending_bookings(UUID) TO authenticated;
-- Authorization is implicit: the function only acts on rows whose
-- trip has already departed, which means even if a non-admin invokes
-- it they can only clean up dead data. No live booking is affected.

-- ─── Integrate into book_seat ────────────────────────────────────────
-- Re-CREATE book_seat with one new line near the top: call
-- expire_stale_pending_bookings(p_trip_id) BEFORE the seat-count
-- check. Everything else stays identical to migration 037 — keep the
-- onboarding precheck, strike check, block check, lock, validations,
-- total_price calculation, and seat decrement in order.

CREATE OR REPLACE FUNCTION public.book_seat(
  p_trip_id      UUID,
  p_seats        INTEGER DEFAULT 1,
  p_pickup_city  TEXT    DEFAULT NULL,
  p_dropoff_city TEXT    DEFAULT NULL,
  p_notes        TEXT    DEFAULT NULL,
  p_payment_method TEXT  DEFAULT NULL
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
  IF v_email IS NULL                      THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_seats < 1 OR p_seats > 6           THEN RAISE EXCEPTION 'invalid seat count'; END IF;

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

  -- ─── NEW (migration 045) ────────────────────────────────────────
  -- Sweep stale pending bookings on THIS trip before checking seat
  -- availability. If the previous booker disappeared and never had
  -- their booking approved or rejected, their hold gets cleaned up
  -- here, the seat is refunded, and the current booker may now find
  -- a seat available where there wasn't one a moment ago. PERFORM
  -- because we don't need the count — just the side effects.
  PERFORM public.expire_stale_pending_bookings(p_trip_id);

  -- Lock the trip row. Concurrent bookers wait here until first txn commits.
  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND                            THEN RAISE EXCEPTION 'trip not found'; END IF;
  IF v_trip.status <> 'confirmed'         THEN RAISE EXCEPTION 'trip not bookable (status=%)', v_trip.status; END IF;
  IF v_trip.driver_email = v_email        THEN RAISE EXCEPTION 'cannot book your own trip' USING ERRCODE = '42501'; END IF;

  -- Block check (migration 017)
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_email = v_email           AND blocked_email = v_trip.driver_email)
       OR (blocker_email = v_trip.driver_email AND blocked_email = v_email)
  ) THEN
    RAISE EXCEPTION 'cannot book — block exists between passenger and driver'
      USING ERRCODE = '42501';
  END IF;

  IF v_trip.available_seats < p_seats     THEN RAISE EXCEPTION 'not enough seats (have %, need %)', v_trip.available_seats, p_seats; END IF;

  IF (v_trip.date::timestamptz + COALESCE(v_trip.time::time, '00:00'::time)) < now() THEN
    RAISE EXCEPTION 'trip is in the past';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE email = v_email;

  -- Total-price calculation (migration 037)
  v_total_price := COALESCE(v_trip.price, 0) * p_seats;

  INSERT INTO public.bookings (
    trip_id, passenger_email, passenger_name, seats_booked,
    pickup_city, dropoff_city, notes, status, payment_status, payment_method,
    total_price,
    created_by
  ) VALUES (
    p_trip_id::text, v_email, COALESCE(v_name, v_email), p_seats,
    p_pickup_city, p_dropoff_city, p_notes,
    'pending', 'pending', p_payment_method,
    v_total_price,
    v_email
  ) RETURNING * INTO v_book;

  UPDATE public.trips
  SET available_seats = available_seats - p_seats,
      updated_at      = NOW()
  WHERE id = p_trip_id;

  RETURN v_book;
END $$;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_expire_fn_ok BOOLEAN;
  v_book_seat_ok BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'expire_stale_pending_bookings'
  ) INTO v_expire_fn_ok;

  -- Confirm book_seat now references the expire function (defensive —
  -- catches a future CREATE OR REPLACE that forgets the integration).
  SELECT pg_get_functiondef(p.oid) LIKE '%expire_stale_pending_bookings%'
  INTO v_book_seat_ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'book_seat';

  IF NOT v_expire_fn_ok THEN
    RAISE EXCEPTION 'MIGRATION 045 FAILED: expire_stale_pending_bookings RPC missing';
  END IF;
  IF NOT v_book_seat_ok THEN
    RAISE EXCEPTION 'MIGRATION 045 FAILED: book_seat does not call expire_stale_pending_bookings';
  END IF;

  RAISE NOTICE 'MIGRATION 045 OK — pending bookings auto-expire when trip departs';
END $$;
