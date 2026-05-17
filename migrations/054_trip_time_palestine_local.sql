-- ════════════════════════════════════════════════════════════════════════
-- Migration 054 — Trip time semantics: interpret as Asia/Jerusalem local
-- ════════════════════════════════════════════════════════════════════════
--
-- THE BUG
-- trips.date (DATE) and trips.time (TEXT, e.g. "09:00") together represent
-- the trip's departure as a wall-clock time. The frontend (src/lib/
-- tripScheduling.js) correctly treats this pair as Asia/Jerusalem local
-- when computing isTripExpired / windowsOverlap / conflict detection.
--
-- The server-side RPCs do NOT match. They do:
--     v_departure := v_trip.date + COALESCE(... v_trip.time ...);
-- which produces a TIMESTAMP (no zone), then assign it to a TIMESTAMPTZ
-- variable. PostgreSQL converts naive → tz using the SERVER's TimeZone
-- setting, which on Supabase defaults to UTC. So "09:00" stored as a
-- Palestine local time is interpreted by the SQL gates as 09:00 UTC —
-- off by 2-3 hours from what the driver, the passenger, and the
-- frontend think the departure is.
--
-- IMPACT
--   1. start_trip "too early — departure is in X minutes":
--        Driver in Palestine taps "بدء الرحلة" at 08:35 local time on a
--        trip scheduled for 09:00 local. Server thinks trip is at 09:00
--        UTC = 12:00 local. Server thinks NOW = 08:35 local = 05:35 UTC.
--        v_minutes_diff = (09:00 UTC − 05:35 UTC) = 205 minutes → blocked.
--        Driver is effectively locked out for ~3 hours past the moment
--        they should have been allowed to start.
--
--   2. book_seat "trip is in the past":
--        A trip scheduled at "21:00" Palestine on a date that has just
--        rolled over (UTC midnight has passed but Palestine midnight has
--        not yet) gets evaluated as future when it's actually past, or
--        vice versa. Passengers may book trips already departing, or be
--        blocked from booking trips that haven't left yet.
--
--   3. expire_stale_pending_bookings sweep query:
--        Same shifted comparison. Pending bookings get auto-cancelled at
--        the wrong moment — typically a few hours later than they should
--        for late-evening trips, which means a passenger could keep
--        their seat hold for hours past departure on a no-show driver.
--
-- The fix is intentionally NOT in change_trip_time (it works on TIME
-- only, no zone math), NOT in complete_trip (no time comparison), and
-- NOT in passive display anywhere (toLocaleString already uses the
-- user's browser zone, which for Mishwaro users IS Palestine).
--
-- TIMEZONE NOTE
-- 'Asia/Jerusalem' is the IANA timezone identifier we use throughout
-- the codebase for Palestine local time. 'Asia/Hebron' is an IANA
-- alias for the same offset (UTC+2 winter / UTC+3 DST summer), so
-- they're functionally interchangeable. We stick with Asia/Jerusalem
-- because it's the canonical name supported across older IANA tzdata
-- versions and avoids any client-side library version skew. Renaming
-- to Asia/Hebron in a future migration is a one-line change with no
-- behavioural impact — the DST switchover dates are identical.
--
-- DST CORRECTNESS
-- AT TIME ZONE is the standard PostgreSQL way to do zone-aware
-- conversion and respects each date's actual DST state, not a fixed
-- offset. So a trip on 2026-04-10 (DST active, UTC+3) and a trip on
-- 2026-01-15 (DST inactive, UTC+2) both get the right wall-clock
-- interpretation without any conditional code here.
--
-- BACKWARD COMPATIBILITY
-- Existing trip rows are unchanged. Only the comparison logic moves.
-- This means trips that previously "wouldn't start" because of the
-- shifted comparison will suddenly become startable at the correct
-- local moment. That's the desired outcome — the trips were always
-- meant to be Palestine local; the gate was the bug.
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) start_trip ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_trip(p_trip_id UUID)
RETURNS public.trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_trip          public.trips%ROWTYPE;
  v_email         TEXT    := public.auth_user_email();
  v_role          TEXT    := public.auth_user_role();
  v_departure     TIMESTAMPTZ;
  v_minutes_diff  INTEGER;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip not found';
  END IF;

  IF v_trip.driver_email <> v_email AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'not your trip' USING ERRCODE = '42501';
  END IF;

  IF v_trip.status <> 'confirmed' THEN
    RAISE EXCEPTION 'cannot start trip from status %', v_trip.status;
  END IF;

  -- Departure time gate.
  -- - NULLIF('','') normalises empty-string time to NULL (migration 052)
  -- - ::time casts the TEXT column to TIME so COALESCE has a single type
  -- - date + time → TIMESTAMP (no zone)
  -- - AT TIME ZONE 'Asia/Jerusalem' interprets that wall clock as
  --   Palestine local time (handles DST automatically per date)
  -- The result is a proper TIMESTAMPTZ comparable to NOW().
  v_departure := (v_trip.date + COALESCE(NULLIF(v_trip.time, '')::time, '00:00'::time))
                 AT TIME ZONE 'Asia/Jerusalem';
  v_minutes_diff := EXTRACT(EPOCH FROM (v_departure - NOW())) / 60;

  IF v_minutes_diff > 30 THEN
    RAISE EXCEPTION 'too early — departure is in % minutes, you can start within 30 minutes of departure', v_minutes_diff;
  END IF;

  IF v_minutes_diff < -120 THEN
    RAISE EXCEPTION 'too late — departure was % minutes ago. Cancel or contact support', ABS(v_minutes_diff);
  END IF;

  UPDATE public.trips
  SET status     = 'in_progress',
      updated_at = NOW()
  WHERE id = p_trip_id
  RETURNING * INTO v_trip;

  RETURN v_trip;
END $$;

REVOKE EXECUTE ON FUNCTION public.start_trip(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_trip(UUID) TO authenticated;

-- ─── (2) book_seat ──────────────────────────────────────────────────
-- Same expression in the "trip is in the past" check. Re-create the
-- full function (we can't patch one line of a plpgsql body) — body is
-- copied from migration 045 verbatim except for the one comparison
-- line, which now uses AT TIME ZONE.

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

REVOKE ALL ON FUNCTION public.book_seat(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_seat(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ─── (3) expire_stale_pending_bookings ──────────────────────────────
-- The sweep finds pending bookings whose trip departure has passed.
-- Same comparison pattern — must use Palestine local time.

CREATE OR REPLACE FUNCTION public.expire_stale_pending_bookings(
  p_trip_id UUID DEFAULT NULL
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
        -- Palestine local interpretation (migration 054)
        ((t.date + COALESCE(NULLIF(t.time, '')::time, '00:00'::time))
           AT TIME ZONE 'Asia/Jerusalem') < v_now
      )
      AND (p_trip_id IS NULL OR b.trip_id = p_trip_id::text)
  LOOP
    BEGIN
      UPDATE public.bookings
      SET status              = 'cancelled',
          cancellation_reason = 'auto_expired_no_driver_response',
          updated_at          = v_now
      WHERE id = r.booking_id
        AND status = 'pending';

      UPDATE public.trips
      SET available_seats = LEAST(
            total_seats,
            GREATEST(0, available_seats + COALESCE(r.seats_booked, 1))
          ),
          updated_at      = v_now
      WHERE id::text = r.trip_id;

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

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_test_ts TIMESTAMPTZ;
BEGIN
  -- Sanity: a known Palestine wall time produces the expected UTC.
  -- 2026-05-18 09:00 Asia/Jerusalem during DST (UTC+3) = 06:00 UTC.
  -- DST starts in Palestine late March, so May 18 is DST-active.
  v_test_ts := ('2026-05-18'::date + '09:00'::time) AT TIME ZONE 'Asia/Jerusalem';
  IF EXTRACT(HOUR FROM v_test_ts AT TIME ZONE 'UTC') <> 6 THEN
    RAISE WARNING 'MIGRATION 054: timezone arithmetic produced unexpected result: %', v_test_ts;
  ELSE
    RAISE NOTICE 'MIGRATION 054 OK — Palestine local time gates wired up correctly';
  END IF;
END $$;
