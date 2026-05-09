-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 018 — Cancellation strike system
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Adds a lightweight strike system to protect drivers from chronic last-
-- minute cancellers without being heavy-handed.
--
-- The model:
--   - All cancellations are counted (cancellation_count, lifetime).
--   - Cancellations within 2 hours of trip departure count as "late"
--     and add a strike (strike_count, rolling 30-day window).
--   - 3 strikes in 30 days → booking is automatically blocked for the
--     remainder of that 30-day window.
--   - last_cancelled_at lets us compute the rolling window without a
--     separate strikes table.
--
-- Why 2 hours: a driver who's been notified at trip - 2h has limited
-- time to fill that seat from another passenger or cancel the trip
-- gracefully. Cancelling earlier than that is annoying but workable;
-- cancelling later actively harms the driver's planning.
--
-- Why 3-in-30: low enough that chronic flakers get caught quickly, high
-- enough that one bad week (sick kid, work emergency) doesn't lock
-- someone out. Industry standard for rideshare/booking platforms.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── A) Schema additions to profiles ──────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cancellation_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_cancellation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strike_count            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_cancelled_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS strikes_reset_at        TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.cancellation_count      IS 'Lifetime count of cancelled bookings (any window).';
COMMENT ON COLUMN public.profiles.late_cancellation_count IS 'Lifetime count of cancellations within 2h of trip departure.';
COMMENT ON COLUMN public.profiles.strike_count            IS 'Active strikes (decrements automatically when older than 30d).';
COMMENT ON COLUMN public.profiles.last_cancelled_at       IS 'Most recent cancellation timestamp — for rolling-window strike computation.';
COMMENT ON COLUMN public.profiles.strikes_reset_at        IS 'When strike_count was last cleared (manually by admin or by 30d rollover).';


-- ─── B) Helper: compute current effective strike count ────────────────────
--
-- Returns the strike count after expiring any strikes older than 30 days.
-- Doesn't mutate state — that happens lazily when cancel_booking() or
-- book_seat() runs. Useful for UI ("you have N strikes, oldest expires…")
-- without having to re-derive from the lifetime columns.
--
-- Logic: if last_cancelled_at is NULL or older than 30 days ago, all
-- strikes have expired → 0. Otherwise the stored strike_count is current.
-- This is approximate (we don't track per-strike timestamps), but errs
-- on the user's side (they get strikes wiped after 30 days of clean
-- behaviour).

CREATE OR REPLACE FUNCTION public.user_effective_strikes(p_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count       INTEGER;
  v_last        TIMESTAMPTZ;
  v_window_days INTEGER := 30;
BEGIN
  SELECT strike_count, last_cancelled_at
  INTO v_count, v_last
  FROM public.profiles
  WHERE email = p_email;

  IF v_count IS NULL OR v_count = 0 THEN
    RETURN 0;
  END IF;

  -- If the last cancellation is older than the rolling window, treat
  -- all strikes as expired. We don't reset them in the DB here (that's
  -- a side-effect — done in cancel_booking when a new strike lands, or
  -- by an admin via the dashboard).
  IF v_last IS NULL OR (now() - v_last) > (v_window_days || ' days')::interval THEN
    RETURN 0;
  END IF;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.user_effective_strikes(TEXT) TO authenticated;


-- ─── C) Updated cancel_booking() with strike logic ────────────────────────
--
-- Replaces the existing function with one that:
--   1. Computes hours-until-departure for the booking's trip
--   2. Increments cancellation_count always (passengers only — drivers
--      cancelling don't get a strike, that's a different operational
--      surface and not what we're protecting against)
--   3. If <2h until departure AND caller is the passenger:
--        - Resets strike_count if last cancellation was outside window
--        - Increments strike_count + late_cancellation_count
--   4. Frees the booked seat back to the trip's available_seats pool
--   5. Writes booking row with status='cancelled' + reason
--
-- Drivers and admins cancelling don't apply strikes (drivers can have
-- legitimate reasons we'd rather they own than hide; admins are doing
-- moderation).

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
  IF FOUND AND trip_record.id IS NOT NULL AND booking_record.status IN ('pending', 'confirmed') THEN
    UPDATE public.trips
    SET available_seats = LEAST(
          GREATEST(available_seats + COALESCE(booking_record.seats_booked, 1), 0),
          COALESCE(seats_total, 20)
        ),
        updated_at = now()
    WHERE id::text = booking_record.trip_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.cancel_booking(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT) TO authenticated;

-- Keep backward compatibility — old client code calls cancel_booking(uuid)
-- without the reason. Forward to the 2-arg version with NULL reason.
CREATE OR REPLACE FUNCTION public.cancel_booking(booking_id_param UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
BEGIN
  PERFORM public.cancel_booking(booking_id_param, NULL);
END $$;

REVOKE ALL ON FUNCTION public.cancel_booking(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID) TO authenticated;


-- ─── D) Add cancellation_reason column on bookings if missing ─────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;


-- ─── E) Update book_seat to check strikes ─────────────────────────────────
--
-- Refuses booking if the user has reached the strike threshold within
-- the rolling window. ERRCODE 42501 = insufficient_privilege; client
-- friendlyError() maps this to a clear Arabic message.
--
-- We re-define the entire function (rather than just appending) since
-- there's no clean way to inject a check mid-function in plpgsql. Keeps
-- the migration 017 block check + new strike check in one body.

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
BEGIN
  IF v_email IS NULL                      THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_seats < 1 OR p_seats > 6           THEN RAISE EXCEPTION 'invalid seat count'; END IF;

  -- ─── Strike check (added in migration 018) ───
  -- Use the helper to apply the rolling-window expiry, so a user who's
  -- been clean for 30 days isn't blocked indefinitely.
  v_strikes := public.user_effective_strikes(v_email);
  IF v_strikes >= v_strike_threshold THEN
    RAISE EXCEPTION 'booking blocked due to strikes (%)', v_strikes
      USING ERRCODE = '42501';
  END IF;

  -- Lock the trip row. Concurrent bookers wait here until first txn commits.
  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND                            THEN RAISE EXCEPTION 'trip not found'; END IF;
  IF v_trip.status <> 'confirmed'         THEN RAISE EXCEPTION 'trip not bookable (status=%)', v_trip.status; END IF;
  IF v_trip.driver_email = v_email        THEN RAISE EXCEPTION 'cannot book your own trip' USING ERRCODE = '42501'; END IF;

  -- Block check (from migration 017) — symmetric block-pair refusal
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_email = v_email           AND blocked_email = v_trip.driver_email)
       OR (blocker_email = v_trip.driver_email AND blocked_email = v_email)
  ) THEN
    RAISE EXCEPTION 'cannot book — block exists between passenger and driver'
      USING ERRCODE = '42501';
  END IF;

  IF v_trip.available_seats < p_seats     THEN RAISE EXCEPTION 'not enough seats (have %, need %)', v_trip.available_seats, p_seats; END IF;

  -- Trip date/time must be in the future
  IF (v_trip.date::timestamptz + COALESCE(v_trip.time::time, '00:00'::time)) < now() THEN
    RAISE EXCEPTION 'trip is in the past';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE email = v_email;

  INSERT INTO public.bookings (
    trip_id, passenger_email, passenger_name, seats_booked,
    pickup_city, dropoff_city, notes, status, payment_status, payment_method,
    created_by
  ) VALUES (
    p_trip_id::text, v_email, COALESCE(v_name, v_email), p_seats,
    p_pickup_city, p_dropoff_city, p_notes,
    'pending', 'pending', p_payment_method,
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


-- ─── F) Admin RPC: clear a user's strikes (give second chance) ────────────
--
-- Admins sometimes need to lift strikes — user contacted support with a
-- legitimate reason (medical emergency, wrongful strike), or the strike
-- system itself misfired. This is the controlled escape hatch.
-- Audit-logged via logAdminAction in the client; the DB just does the
-- mutation and trusts the admin role check.

CREATE OR REPLACE FUNCTION public.admin_clear_user_strikes(p_email TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
BEGIN
  IF public.auth_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET strike_count     = 0,
      strikes_reset_at = now()
  WHERE email = p_email;
END $$;

REVOKE ALL ON FUNCTION public.admin_clear_user_strikes(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_user_strikes(TEXT) TO authenticated;
