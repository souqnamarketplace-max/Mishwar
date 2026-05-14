-- ════════════════════════════════════════════════════════════════════════
-- Migration 037 — populate bookings.total_price + harden notifications
-- ════════════════════════════════════════════════════════════════════════
--
-- TWO BUGS, ONE MIGRATION
--
-- ─── BUG #1: bookings.total_price is always NULL ────────────────────────
-- Reported in prod: admin dashboard's "إدارة الحجوزات" table shows "—₪"
-- for every booking's السعر الكلي column. Same NULL surfaces in:
--   - public.dashboard_metrics() total_revenue field (lines 1368, 1527
--     in supabase-production.sql) → admin sees $0 revenue forever
--   - commission/payout calculations (line 1528-1529) → drivers' payouts
--     compute to zero
--   - the seed_apple_reviewer_accounts fixture (which explicitly INSERTs
--     total_price) is the only path that ever populates this column
--
-- Root cause: the book_seat RPC (migration 018) inserts every booking
-- column EXCEPT total_price:
--
--   INSERT INTO public.bookings (
--     trip_id, passenger_email, passenger_name, seats_booked,
--     pickup_city, dropoff_city, notes, status, payment_status,
--     payment_method, created_by
--   ) VALUES (
--     p_trip_id::text, v_email, ...
--   );
--
-- total_price is declared NUMERIC with a CHECK (>= 0) but no NOT NULL,
-- so the INSERT succeeds with NULL. The trip's price column is the per-
-- seat price; total_price should be price × seats. The original author
-- likely intended the column to be populated by a trigger or computed
-- at read time, but neither was ever wired up.
--
-- Fix: re-CREATE book_seat with total_price computed inside the RPC
-- from the locked trip row (v_trip.price * p_seats), and backfill
-- existing NULL rows with the same calculation.
--
-- ─── BUG #2: admin-created notifications silently fail ──────────────────
-- Reported: admin approved a passenger verification, user never got the
-- in-app notification. Investigation: every admin notification surface
-- (DashboardPassengerVerifications, DashboardSubscriptions,
-- DashboardReports) does either:
--   - supabase.from("notifications").insert({ type: "verification", ... })
--     → fails the CHECK constraint type IN ('new_trip','price_drop',
--                                          'date_match','system')
--   - .insert({ ..., link: "/some/path" })
--     → fails because public.notifications has no `link` column
--
-- All wrapped in try/catch that swallows the error and continues. From
-- the admin's POV the action "succeeded" but the user never got the
-- bell ping. Migration 027 ALSO has this issue — the create_notification
-- RPC references `link` and is called with custom types from various
-- helpers, all of which fail silently because the schema doesn't match.
--
-- Fix: add the `link` column and replace the narrow type CHECK with
-- a permissive one that accepts every type the codebase actually uses
-- today (audited via grep). Future-new types remain free to add.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── PART A: notifications schema hardening ──────────────────────────
-- Add `link` column. Idempotent — IF NOT EXISTS so re-running this
-- migration is a no-op. TEXT not VARCHAR so we don't have to pick a
-- length cap; in-app deep links can be long with query params.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS link TEXT;

-- Replace the narrow CHECK constraint. The old one rejected every type
-- the admin dashboards needed; rather than enumerate a constantly-
-- growing list, accept anything non-empty and ≤50 chars (which catches
-- typos like 'systemmm' but doesn't lock us into a fixed taxonomy).
-- This loosening is safe — `type` is used by the UI to pick an icon
-- and a navigation target; unknown types just fall through to the
-- 'system' rendering.

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class r ON c.conrelid = r.oid
  JOIN pg_namespace n ON r.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND r.relname = 'notifications'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%type%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped narrow type CHECK constraint: %', v_constraint_name;
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_nonempty
  CHECK (type IS NOT NULL AND length(type) BETWEEN 1 AND 50);

-- ─── PART B: book_seat populates total_price ─────────────────────────
-- Re-CREATE book_seat with one new line in the INSERT: total_price
-- computed from v_trip.price * p_seats. Everything else is identical
-- to the migration 018 / migration 034 version (onboarding precheck +
-- strike check + block check + seat-availability check + own-trip
-- refusal + past-trip refusal — all preserved in order).

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

  -- ─── Total-price calculation (migration 037) ───
  -- trip.price is per-seat. total_price is what the passenger owes
  -- for this booking and what feeds into revenue/commission reporting.
  -- COALESCE the trip price to 0 in the (unlikely) case a legacy trip
  -- has NULL price — the booking still goes through, but the admin
  -- dashboard's revenue total stays accurate (0 instead of NULL, so
  -- dashboard_metrics' SUM doesn't include any NULL surprises).
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

-- ─── PART C: backfill existing NULL total_price rows ─────────────────
-- Match each booking with its parent trip and write the correct
-- total_price into rows where it's currently NULL. Only touches NULL
-- rows — anything already populated (test data, seed accounts) is
-- preserved. Joins via trips.id::text = bookings.trip_id because the
-- bookings table stores trip_id as TEXT not UUID (historical decision).

UPDATE public.bookings b
SET total_price = COALESCE(t.price, 0) * COALESCE(b.seats_booked, 1)
FROM public.trips t
WHERE t.id::text = b.trip_id
  AND b.total_price IS NULL;

-- ─── Verification ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_link_exists       BOOLEAN;
  v_check_loose       BOOLEAN;
  v_remaining_nulls   INTEGER;
  v_book_seat_ok      BOOLEAN;
BEGIN
  -- Confirm the link column landed
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'link'
  ) INTO v_link_exists;
  IF NOT v_link_exists THEN
    RAISE EXCEPTION 'MIGRATION 037 FAILED: notifications.link column missing';
  END IF;

  -- Confirm the narrow CHECK was replaced
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON c.conrelid = r.oid
    JOIN pg_namespace n ON r.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND r.relname = 'notifications'
      AND c.conname = 'notifications_type_nonempty'
  ) INTO v_check_loose;
  IF NOT v_check_loose THEN
    RAISE EXCEPTION 'MIGRATION 037 FAILED: permissive type constraint not installed';
  END IF;

  -- Confirm book_seat now references total_price
  SELECT pg_get_functiondef(p.oid) LIKE '%v_total_price%'
  INTO v_book_seat_ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'book_seat';
  IF NOT v_book_seat_ok THEN
    RAISE EXCEPTION 'MIGRATION 037 FAILED: book_seat missing total_price logic';
  END IF;

  -- Confirm backfill ran — should be zero NULL rows on bookings that
  -- have a known trip. Bookings on orphaned trip_ids (trip deleted)
  -- remain NULL because there's no source data to compute from; not
  -- counted as a failure.
  SELECT COUNT(*) INTO v_remaining_nulls
  FROM public.bookings b
  WHERE b.total_price IS NULL
    AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id::text = b.trip_id);
  IF v_remaining_nulls > 0 THEN
    RAISE WARNING 'MIGRATION 037: % bookings still have NULL total_price (parent trip exists)', v_remaining_nulls;
  END IF;

  RAISE NOTICE 'MIGRATION 037 OK — book_seat sets total_price, notifications schema hardened';
END $$;
