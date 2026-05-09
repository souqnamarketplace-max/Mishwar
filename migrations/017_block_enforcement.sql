-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 017 — Block enforcement at database level
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Closes two security gaps in the user-block system. Before this migration,
-- the entire block enforcement was client-side (filterByBlocks() drops
-- conversations/trips from UI lists, the composer locks when a block is
-- detected, etc.). A determined attacker could bypass:
--
--   1. INSERT into messages by hitting the REST endpoint directly with
--      their session token, since the messages_insert RLS policy didn't
--      check user_blocks.
--
--   2. Book a trip via the book_seat RPC even when blocked, since that RPC
--      didn't check user_blocks either. Cached pages or direct URL access
--      could let a previously-blocked passenger book on a driver's trip.
--
-- This migration:
--
--   A) Adds a RESTRICTIVE RLS policy "messages_no_blocked_insert" on
--      public.messages that refuses INSERT when sender and receiver are
--      involved in a block pair (either direction).
--
--   B) Modifies public.book_seat() to refuse with a clear error when the
--      booking passenger and trip driver are involved in a block pair.
--      The RPC is the only allowed booking path (direct INSERTs into
--      bookings are blocked by existing policies + the
--      guard_booking_updates trigger), so checking here closes the gap
--      for that flow.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── A) Messages INSERT block check ────────────────────────────────────────
--
-- A RESTRICTIVE policy is ANDed with all PERMISSIVE policies for the same
-- action. So this acts as an additional gate on top of the existing
-- "user can insert messages they send" permissive policy: the row must
-- still match the sender-is-me check, AND must not violate the no-block
-- rule.
--
-- Symmetric: blocks either I-blocked-them or they-blocked-me. Same
-- behavior as the client-side getBlockedEmails() Set semantics.
--
-- auth.email() returns the authenticated user's email or NULL if no
-- session. We use auth.email() rather than the public.auth_user_email()
-- helper because RLS WITH CHECK expressions are evaluated very frequently
-- and the helper does an extra lookup; auth.email() is a built-in.

DROP POLICY IF EXISTS "messages_no_blocked_insert" ON public.messages;

CREATE POLICY "messages_no_blocked_insert" ON public.messages
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_email = auth.email() AND blocked_email = receiver_email)
         OR (blocker_email = receiver_email   AND blocked_email = auth.email())
    )
  );

COMMENT ON POLICY "messages_no_blocked_insert" ON public.messages IS
  'Blocks INSERTs where sender and receiver are involved in a user_blocks
   row (either direction). Defense-in-depth — the client also locks the
   composer in Messages.jsx, but a direct REST call bypasses that. This
   policy guarantees the row never lands in the table.';


-- ─── B) Booking RPC block check ────────────────────────────────────────────
--
-- Adds a check at the top of book_seat() (after the auth + seat-count
-- preconditions, before reading the trip) that refuses the booking when
-- a block exists between the passenger (caller) and the trip's driver.
--
-- Lookup is keyed on driver_email which is read from the trips row; we
-- do that read before the block check now, but it's effectively free
-- since we'd be doing it anyway for the existing self-booking + status
-- + seat-count checks just below.

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
  v_trip   public.trips%ROWTYPE;
  v_email  TEXT := public.auth_user_email();
  v_name   TEXT;
  v_book   public.bookings;
BEGIN
  IF v_email IS NULL                      THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_seats < 1 OR p_seats > 6           THEN RAISE EXCEPTION 'invalid seat count'; END IF;

  -- Lock the trip row. Concurrent bookers wait here until first txn commits.
  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND                            THEN RAISE EXCEPTION 'trip not found'; END IF;
  IF v_trip.status <> 'confirmed'         THEN RAISE EXCEPTION 'trip not bookable (status=%)', v_trip.status; END IF;
  IF v_trip.driver_email = v_email        THEN RAISE EXCEPTION 'cannot book your own trip' USING ERRCODE = '42501'; END IF;

  -- ─── BLOCK CHECK (added in migration 017) ───
  -- Refuse if passenger or driver has blocked the other. Symmetric.
  -- 42501 = insufficient_privilege; client friendlyError() maps this to
  -- a clear Arabic message ("لا يمكنك حجز رحلة هذا السائق — أحدكما حظر الآخر").
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

  -- Status starts at 'pending' to preserve the existing UX where the driver
  -- explicitly accepts each booking request from DriverPassengers.jsx. The
  -- seat is reserved immediately (we decrement available_seats below) so the
  -- next concurrent booker correctly sees the lower count, but the booking
  -- itself stays in 'pending' until the driver clicks accept. This matches
  -- the BlaBlaCar-style flow the app already implements; auto-confirming
  -- would remove driver choice and could surprise drivers.
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

COMMENT ON FUNCTION public.book_seat(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) IS
  'Books p_seats on a trip atomically (decrements trip.available_seats +
   inserts pending booking row in same txn). Refuses if not authenticated,
   trip not confirmed, self-booking, blocked passenger/driver, or not enough
   seats. Migration 017 added the block check. SECURITY DEFINER — the
   caller does not need direct INSERT rights on public.bookings.';


-- ─── C) Index on user_blocks for the lookups above ─────────────────────────
--
-- Both new checks (RLS policy + book_seat) do EXISTS lookups on
-- user_blocks filtered by (blocker_email, blocked_email) pairs. Without
-- an index, every message INSERT and every booking would seq-scan
-- user_blocks. With realistic block volumes (low — most users will have
-- 0 blocks, abusers maybe 5–10) the seq-scan is fine, but adding the
-- index is cheap insurance against future scale.
--
-- The existing UNIQUE constraint on (blocker_email, blocked_email) gives
-- us a covering index for the "did I block them" direction. We just need
-- the reverse direction.

CREATE INDEX IF NOT EXISTS user_blocks_blocked_blocker_idx
  ON public.user_blocks (blocked_email, blocker_email);

COMMENT ON INDEX public.user_blocks_blocked_blocker_idx IS
  'Reverse-direction lookup for "did they block me" — the unique constraint
   on (blocker_email, blocked_email) covers the forward direction.';
