-- ════════════════════════════════════════════════════════════════════════
-- Migration 039 — extend the deletion handshake to ALL protected-column
--                 triggers, not just profiles
-- ════════════════════════════════════════════════════════════════════════
--
-- USER REPORT (2026-05-14)
-- Attempting to delete an account → 403 from delete_user_account_v2 with
-- the error 'cannot change passenger_email'.
--
-- ROOT CAUSE
-- Migration 002 created FIVE BEFORE-UPDATE triggers, each blocking
-- identity-column changes for non-admin callers:
--   guard_profile_protected_columns       on public.profiles
--   guard_booking_updates                  on public.bookings
--   guard_trip_updates                     on public.trips
--   guard_message_receiver_columns         on public.messages
--   guard_review_must_have_booking         on public.reviews   (INSERT only)
--
-- Migration 035 fixed the FIRST one by adding a session-variable
-- handshake. The other three UPDATE triggers were left untouched —
-- and the delete RPC's cascade (migration 036) does UPDATEs on each
-- to anonymize denormalized email/name columns. The first to fire was
-- bookings, hence the user's error.
--
-- THE FIX
-- Apply the same session-variable handshake to all three remaining
-- UPDATE triggers. Each guard now checks at the top, right after the
-- admin bypass:
--
--   IF NULLIF(current_setting('mishwar.deleting_account', true), '')
--      IS NOT NULL
--      AND current_setting('mishwar.deleting_account', true)
--          = auth.uid()::text
--   THEN
--     RETURN NEW;
--   END IF;
--
-- This bypass only triggers when the deletion RPC has set the session
-- variable AND the calling user matches auth.uid().
--
-- SAFETY ANALYSIS
--   • set_config in delete_user_account_v2 uses is_local := true →
--     scoped to that transaction, auto-clears on commit/rollback.
--   • PostgREST does not allow clients to set arbitrary session
--     variables over the wire. Custom namespaces like `mishwar.*`
--     are not in the configurable prefix list.
--   • The handshake compares against auth.uid() of the CALLER. Only
--     the calling user themselves can bypass for their own data.
--
-- HISTORICAL NOTE
-- The first draft used a regexp_replace splice via pg_get_functiondef
-- to inject the handshake without re-stating each function's full
-- body. That FAILED at apply time because pg_get_functiondef reformats
-- whitespace, quotes, and indentation when reconstructing source —
-- so the regex pattern (matching migration-002 source) never matched
-- the reformatted output. The verification block then raised
-- 'guard_message_receiver_columns missing handshake'. This version
-- uses full CREATE OR REPLACE — verbose but reliable.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) guard_booking_updates ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_booking_updates()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  caller_email TEXT := public.auth_user_email();
  caller_role  TEXT := public.auth_user_role();
  is_passenger BOOLEAN := (OLD.passenger_email = caller_email);
  is_driver    BOOLEAN := EXISTS (
    SELECT 1 FROM public.trips
    WHERE id::text = OLD.trip_id
      AND driver_email = caller_email
  );
  v_handshake  TEXT := NULLIF(current_setting('mishwar.deleting_account', true), '');
BEGIN
  -- Admin can do anything
  IF caller_role = 'admin' THEN RETURN NEW; END IF;

  -- Deletion-handshake bypass (migration 039). delete_user_account_v2
  -- sets this to auth.uid()::text right before its cascade UPDATEs.
  IF v_handshake IS NOT NULL AND v_handshake = auth.uid()::text THEN
    RETURN NEW;
  END IF;

  -- Identity columns are immutable for everyone except admin (or
  -- in-progress self-deletion, handled above).
  IF NEW.passenger_email IS DISTINCT FROM OLD.passenger_email THEN
    RAISE EXCEPTION 'cannot change passenger_email'        USING ERRCODE = '42501';
  END IF;
  IF NEW.trip_id         IS DISTINCT FROM OLD.trip_id         THEN
    RAISE EXCEPTION 'cannot change trip_id'                 USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at      IS DISTINCT FROM OLD.created_at      THEN
    RAISE EXCEPTION 'cannot change created_at'              USING ERRCODE = '42501';
  END IF;

  IF is_passenger AND NOT is_driver THEN
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      RAISE EXCEPTION 'passengers cannot change payment_status' USING ERRCODE = '42501';
    END IF;
    IF NEW.paid_at        IS DISTINCT FROM OLD.paid_at        THEN
      RAISE EXCEPTION 'passengers cannot change paid_at'        USING ERRCODE = '42501';
    END IF;
    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      RAISE EXCEPTION 'passengers cannot change payment_method' USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_status  IS DISTINCT FROM OLD.refund_status  THEN
      RAISE EXCEPTION 'passengers cannot change refund_status'  USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_amount  IS DISTINCT FROM OLD.refund_amount  THEN
      RAISE EXCEPTION 'passengers cannot change refund_amount'  USING ERRCODE = '42501';
    END IF;
    IF NEW.no_show        IS DISTINCT FROM OLD.no_show        THEN
      RAISE EXCEPTION 'passengers cannot change no_show'        USING ERRCODE = '42501';
    END IF;
    IF NEW.seats_booked   IS DISTINCT FROM OLD.seats_booked   THEN
      RAISE EXCEPTION 'passengers cannot change seats_booked'   USING ERRCODE = '42501';
    END IF;
    IF NEW.cancel_reason  IS DISTINCT FROM OLD.cancel_reason  THEN
      IF OLD.cancel_reason IS NOT NULL THEN
        RAISE EXCEPTION 'cancel_reason already set'             USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'passengers can only cancel'           USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF is_driver AND NOT is_passenger THEN
    IF NEW.seats_booked   IS DISTINCT FROM OLD.seats_booked   THEN
      RAISE EXCEPTION 'drivers cannot change seats_booked'      USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_status  IS DISTINCT FROM OLD.refund_status   THEN
      RAISE EXCEPTION 'refund_status is admin-only'             USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_amount  IS DISTINCT FROM OLD.refund_amount   THEN
      RAISE EXCEPTION 'refund_amount is admin-only'             USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ─── (2) guard_trip_updates ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_trip_updates()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  caller_email TEXT := public.auth_user_email();
  caller_role  TEXT := public.auth_user_role();
  has_bookings BOOLEAN := EXISTS (
    SELECT 1 FROM public.bookings
    WHERE trip_id = OLD.id::text
      AND status IN ('confirmed','completed')
  );
  v_handshake  TEXT := NULLIF(current_setting('mishwar.deleting_account', true), '');
BEGIN
  IF caller_role = 'admin' THEN RETURN NEW; END IF;

  -- Deletion-handshake bypass (migration 039)
  IF v_handshake IS NOT NULL AND v_handshake = auth.uid()::text THEN
    RETURN NEW;
  END IF;

  -- driver_email immutable
  IF NEW.driver_email IS DISTINCT FROM OLD.driver_email THEN
    RAISE EXCEPTION 'cannot change driver_email'           USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'cannot change trip id'                USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'cannot change created_at'             USING ERRCODE = '42501';
  END IF;

  -- Route + price + date + time freeze after first booking.
  IF has_bookings THEN
    IF NEW.from_city IS DISTINCT FROM OLD.from_city THEN
      RAISE EXCEPTION 'cannot change from_city after first booking'  USING ERRCODE = '42501';
    END IF;
    IF NEW.to_city   IS DISTINCT FROM OLD.to_city   THEN
      RAISE EXCEPTION 'cannot change to_city after first booking'    USING ERRCODE = '42501';
    END IF;
    IF NEW.price     IS DISTINCT FROM OLD.price     THEN
      RAISE EXCEPTION 'cannot change price after first booking'      USING ERRCODE = '42501';
    END IF;
    IF NEW.date      IS DISTINCT FROM OLD.date      THEN
      RAISE EXCEPTION 'cannot change date after first booking'       USING ERRCODE = '42501';
    END IF;
    IF NEW.time      IS DISTINCT FROM OLD.time      THEN
      RAISE EXCEPTION 'cannot change time after first booking'       USING ERRCODE = '42501';
    END IF;
  END IF;

  -- total_seats is set at creation, never changes
  IF NEW.total_seats IS DISTINCT FROM OLD.total_seats THEN
    RAISE EXCEPTION 'cannot change total_seats'            USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

-- ─── (3) guard_message_receiver_columns ───────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_message_receiver_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  caller       TEXT := public.auth_user_email();
  v_handshake  TEXT := NULLIF(current_setting('mishwar.deleting_account', true), '');
BEGIN
  -- Admin override
  IF public.auth_user_role() = 'admin' THEN RETURN NEW; END IF;

  -- Deletion-handshake bypass (migration 039)
  IF v_handshake IS NOT NULL AND v_handshake = auth.uid()::text THEN
    RETURN NEW;
  END IF;

  -- Receiver can only change is_read (and updated_at). All identity
  -- columns are immutable.
  IF OLD.receiver_email = caller AND OLD.sender_email <> caller THEN
    IF NEW.content        IS DISTINCT FROM OLD.content        THEN
      RAISE EXCEPTION 'receivers cannot edit message content' USING ERRCODE = '42501';
    END IF;
    IF NEW.sender_email   IS DISTINCT FROM OLD.sender_email   THEN
      RAISE EXCEPTION 'cannot change sender_email'           USING ERRCODE = '42501';
    END IF;
    IF NEW.sender_name    IS DISTINCT FROM OLD.sender_name    THEN
      RAISE EXCEPTION 'cannot change sender_name'            USING ERRCODE = '42501';
    END IF;
    IF NEW.receiver_email IS DISTINCT FROM OLD.receiver_email THEN
      RAISE EXCEPTION 'cannot change receiver_email'         USING ERRCODE = '42501';
    END IF;
    IF NEW.created_at     IS DISTINCT FROM OLD.created_at     THEN
      RAISE EXCEPTION 'cannot change created_at'             USING ERRCODE = '42501';
    END IF;
    IF NEW.trip_id        IS DISTINCT FROM OLD.trip_id        THEN
      RAISE EXCEPTION 'cannot change trip_id'                USING ERRCODE = '42501';
    END IF;
    IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
      RAISE EXCEPTION 'cannot change conversation_id'        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Senders can edit their own content but not impersonate
  IF OLD.sender_email = caller THEN
    IF NEW.sender_email IS DISTINCT FROM OLD.sender_email THEN
      RAISE EXCEPTION 'cannot change sender_email'           USING ERRCODE = '42501';
    END IF;
    IF NEW.receiver_email IS DISTINCT FROM OLD.receiver_email THEN
      RAISE EXCEPTION 'cannot change receiver_email'         USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ─── Verification ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_booking_ok  BOOLEAN;
  v_trip_ok     BOOLEAN;
  v_message_ok  BOOLEAN;
  v_profile_ok  BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) LIKE '%mishwar.deleting_account%'
  INTO v_booking_ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='guard_booking_updates';

  SELECT pg_get_functiondef(p.oid) LIKE '%mishwar.deleting_account%'
  INTO v_trip_ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='guard_trip_updates';

  SELECT pg_get_functiondef(p.oid) LIKE '%mishwar.deleting_account%'
  INTO v_message_ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='guard_message_receiver_columns';

  SELECT pg_get_functiondef(p.oid) LIKE '%mishwar.deleting_account%'
  INTO v_profile_ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='guard_profile_protected_columns';

  IF NOT v_booking_ok THEN
    RAISE EXCEPTION 'MIGRATION 039 FAILED: guard_booking_updates missing handshake';
  END IF;
  IF NOT v_trip_ok THEN
    RAISE EXCEPTION 'MIGRATION 039 FAILED: guard_trip_updates missing handshake';
  END IF;
  IF NOT v_message_ok THEN
    RAISE EXCEPTION 'MIGRATION 039 FAILED: guard_message_receiver_columns missing handshake';
  END IF;
  IF NOT v_profile_ok THEN
    RAISE WARNING 'guard_profile_protected_columns missing handshake — re-apply migration 035';
  END IF;

  RAISE NOTICE 'MIGRATION 039 OK — all 4 protected-column guards bypass during self-deletion';
END $$;
