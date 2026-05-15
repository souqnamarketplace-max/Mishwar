-- ════════════════════════════════════════════════════════════════════════
-- Migration 039 — extend the deletion handshake to ALL protected-column
--                 triggers, not just profiles
-- ════════════════════════════════════════════════════════════════════════
--
-- USER REPORT (2026-05-14)
-- Attempting to delete an account → 403 from delete_user_account_v2 with
-- the error 'cannot change passenger_email'. Toast: "فشل حذف الحساب.
-- يرجى الاتصال بالدعم: cannot change passenger_email".
--
-- ROOT CAUSE
-- Migration 002 (security hardening) created FIVE BEFORE-UPDATE triggers,
-- each blocking identity-column changes for non-admin callers:
--   guard_profile_protected_columns       on public.profiles
--   guard_booking_updates                  on public.bookings
--   guard_trip_updates                     on public.trips
--   guard_message_receiver_columns         on public.messages
--   guard_review_must_have_booking         on public.reviews   (INSERT only)
--
-- Migration 035 fixed the FIRST one by adding a session-variable
-- handshake (mishwar.deleting_account = NEW.id::text), so the deletion
-- RPC could anonymize the profile's email column. But the OTHER three
-- UPDATE triggers were left untouched — and the delete RPC's cascade
-- (migration 036) does UPDATEs on each of them to anonymize the
-- denormalized email/name columns:
--
--   UPDATE bookings SET passenger_email = v_new_email, passenger_name = ...
--     → blocked by guard_booking_updates
--   UPDATE trips SET driver_email = v_new_email, driver_name = ...
--     → blocked by guard_trip_updates
--   UPDATE messages SET sender_email = v_new_email, ...
--   UPDATE messages SET receiver_email = v_new_email, ...
--     → blocked by guard_message_receiver_columns
--
-- The first one to fire was bookings (alphabetical anonymization order
-- in the RPC), which threw 'cannot change passenger_email' and the
-- entire delete-account transaction rolled back. The user saw the
-- error, the deletion never persisted, the modal reset (as fixed in
-- the previous commit).
--
-- THE FIX
-- Apply the same session-variable handshake to all three remaining
-- UPDATE triggers. Slight simplification from migration 035's pattern:
-- instead of comparing the session variable to NEW.id (which works
-- for profiles but doesn't generalize — bookings.id is the booking
-- UUID, not the user UUID), we compare it to auth.uid()::text.
--
-- This is semantically "the current operation is being performed
-- inside an authorized account-deletion flow for the calling user".
-- delete_user_account_v2 is the only function that sets the session
-- variable, and it sets it to auth.uid()::text. So this check is
-- effectively "are we inside delete_user_account_v2 right now?"
--
-- SAFETY ANALYSIS
--   • set_config in delete_user_account_v2 uses is_local := true →
--     scoped to that transaction, auto-clears on commit/rollback,
--     can't leak across requests.
--   • PostgREST does not allow clients to set arbitrary session
--     variables over the wire. Custom namespaces like `mishwar.*`
--     are not in the configurable prefix list — only `request.*`
--     and a few PG defaults. So an attacker can't spoof the
--     handshake via REST.
--   • The session variable only allows BYPASSING the immutable-
--     column protections. It doesn't grant any new write capability;
--     row-level RLS on the underlying tables still applies (and the
--     RPC bypasses RLS only because it's SECURITY DEFINER, not
--     because of this variable).
--   • The handshake compares against auth.uid() of the CALLER. If
--     user A's session calls delete_user_account_v2, the variable
--     is set to A's UUID, and only updates affecting A's own data
--     can pass the guard. The RPC's WHERE clauses already constrain
--     this — the trigger check is redundant defense in depth.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) guard_booking_updates ────────────────────────────────────────
-- Re-CREATE with the handshake check inserted right after the admin
-- bypass. Everything else preserved verbatim from migration 002.

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

  -- Deletion-handshake bypass (migration 039). Set inside
  -- delete_user_account_v2 to auth.uid()::text right before the
  -- cascade of anonymization UPDATEs. is_local on set_config makes
  -- this txn-scoped — it can't leak across requests.
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
    -- Passenger can only cancel + edit their own pickup/dropoff/notes
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
-- Original blocks driver_email changes. Same handshake pattern.

DO $$
DECLARE
  v_orig_def TEXT;
BEGIN
  -- Capture the existing function definition. We need to preserve all
  -- its existing logic (status transition rules, etc.) and just inject
  -- the handshake at the top.
  SELECT pg_get_functiondef(p.oid)
  INTO v_orig_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'guard_trip_updates';

  IF v_orig_def IS NULL THEN
    RAISE NOTICE 'guard_trip_updates not present, skipping';
    RETURN;
  END IF;

  -- If the handshake is already in the body, skip — the migration is
  -- idempotent.
  IF v_orig_def LIKE '%mishwar.deleting_account%' THEN
    RAISE NOTICE 'guard_trip_updates already has handshake';
    RETURN;
  END IF;

  -- Inject the handshake check right after the admin-bypass.
  -- The migration-002 source has:
  --     IF caller_role = 'admin' THEN RETURN NEW; END IF;
  -- followed by the immutable-column checks. We splice a new block
  -- in between via regexp_replace, NOT a full function rewrite —
  -- that way any subsequent migration that added new business logic
  -- to guard_trip_updates is preserved.
  EXECUTE regexp_replace(
    v_orig_def,
    '(IF\s+caller_role\s*=\s*''admin''\s+THEN\s+RETURN\s+NEW\s*;\s*END\s+IF\s*;)',
    E'\\1\n  -- Deletion-handshake bypass (migration 039)\n  IF NULLIF(current_setting(''mishwar.deleting_account'', true), '''') IS NOT NULL\n     AND current_setting(''mishwar.deleting_account'', true) = auth.uid()::text\n  THEN\n    RETURN NEW;\n  END IF;',
    'i'
  );
END $$;

-- ─── (3) guard_message_receiver_columns ───────────────────────────────
-- Original blocks sender_email and receiver_email changes. Same pattern
-- as guard_trip_updates — splice in the handshake right after admin
-- bypass without touching anything else.

DO $$
DECLARE
  v_orig_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_orig_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'guard_message_receiver_columns';

  IF v_orig_def IS NULL THEN
    RAISE NOTICE 'guard_message_receiver_columns not present, skipping';
    RETURN;
  END IF;

  IF v_orig_def LIKE '%mishwar.deleting_account%' THEN
    RAISE NOTICE 'guard_message_receiver_columns already has handshake';
    RETURN;
  END IF;

  EXECUTE regexp_replace(
    v_orig_def,
    '(IF\s+caller_role\s*=\s*''admin''\s+THEN\s+RETURN\s+NEW\s*;\s*END\s+IF\s*;)',
    E'\\1\n  -- Deletion-handshake bypass (migration 039)\n  IF NULLIF(current_setting(''mishwar.deleting_account'', true), '''') IS NOT NULL\n     AND current_setting(''mishwar.deleting_account'', true) = auth.uid()::text\n  THEN\n    RETURN NEW;\n  END IF;',
    'i'
  );
END $$;

-- ─── Verification ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_booking_ok  BOOLEAN;
  v_trip_ok     BOOLEAN;
  v_message_ok  BOOLEAN;
  v_profile_ok  BOOLEAN;
BEGIN
  -- Each of the four guards should now contain the handshake reference.
  -- guard_profile_protected_columns picked it up in migration 035 (with
  -- a slightly different check shape using NEW.id), so we accept either
  -- pattern there. The other three should match the new auth.uid()
  -- pattern from this migration.

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
