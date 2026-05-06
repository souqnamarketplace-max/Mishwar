-- =============================================================================
-- مِشوار  — PHASE 1 — RPCs for atomic booking and proper account deletion
-- =============================================================================
-- These RPCs replace racy / incomplete client-side flows. Apply AFTER the
-- Phase 0 migration has been run and verified. Idempotent — safe to re-run.
--
-- ADDRESSES:
--   C-05 — account deletion now anonymizes email + denormalized columns
--   C-06 — atomic seat booking with row-level lock
--
-- IMPORTANT: this file installs server-side functions only. The client UI
-- continues to use the existing flows until a follow-up code commit wires
-- them through. Both old and new paths coexist safely.
-- =============================================================================


-- =============================================================================
-- C-06 — Atomic seat booking via SECURITY DEFINER RPC
-- =============================================================================
-- Replaces the non-atomic client decrement + AFTER-INSERT trigger. SELECT
-- ... FOR UPDATE locks the trip row for the duration of the transaction so
-- two concurrent bookings can't both succeed when only one seat remains.
--
-- The existing notify_driver_on_booking trigger continues to fire AFTER
-- INSERT for notification purposes — but the seat-decrement portion of
-- that trigger should be removed once this RPC is the only insert path.
-- We do NOT drop that trigger here because the existing client still
-- inserts directly; once the client cuts over, run the cleanup migration
-- in section 3 of this file.

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
    'confirmed', 'pending', p_payment_method,
    v_email
  ) RETURNING * INTO v_book;

  UPDATE public.trips
  SET available_seats = available_seats - p_seats,
      updated_at      = NOW()
  WHERE id = p_trip_id;

  RETURN v_book;
END $$;

REVOKE ALL ON FUNCTION public.book_seat(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_seat(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- =============================================================================
-- C-05 — Account deletion that actually anonymizes
-- =============================================================================
-- The existing UI path does supabase.from('profiles').update({ deleted_at, ... })
-- without anonymizing email. After this RPC is in place, the client should
-- call rpc('delete_user_account_v2') instead — the V2 suffix is intentional
-- so the old function (referenced from elsewhere) keeps working until cutover.

CREATE OR REPLACE FUNCTION public.delete_user_account_v2(
  p_reason TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_old_email        TEXT;
  v_new_email        TEXT;
  v_today            DATE := CURRENT_DATE;
  v_active_trips     INT;
  v_active_bookings  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_old_email FROM auth.users WHERE id = v_uid;
  IF v_old_email IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- Server-side precondition: no active trips/bookings
  SELECT COUNT(*) INTO v_active_trips
  FROM public.trips
  WHERE driver_email = v_old_email
    AND status = 'confirmed'
    AND date >= v_today;
  IF v_active_trips > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming trips as driver', v_active_trips;
  END IF;

  SELECT COUNT(*) INTO v_active_bookings
  FROM public.bookings b
  JOIN public.trips t ON t.id::text = b.trip_id
  WHERE b.passenger_email = v_old_email
    AND b.status = 'confirmed'
    AND t.date >= v_today;
  IF v_active_bookings > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming bookings as passenger', v_active_bookings;
  END IF;

  v_new_email := 'deleted-' || v_uid || '@deleted.local';

  -- 1) Anonymize the profile (preserves trip/review history but drops PII)
  UPDATE public.profiles SET
    full_name              = '[حساب محذوف]',
    email                  = v_new_email,
    avatar_url             = NULL,
    phone                  = NULL,
    bio                    = NULL,
    bank_iban              = NULL,
    bank_account_number    = NULL,
    bank_name              = NULL,
    card_holder_name       = NULL,
    card_last_four         = NULL,
    jawwal_pay_number      = NULL,
    reflect_number         = NULL,
    pref_smoking           = NULL,
    pref_chattiness        = NULL,
    pref_pets              = NULL,
    vehicle_luggage        = NULL,
    vehicle_back_row       = NULL,
    car_model              = NULL,
    car_year               = NULL,
    car_color              = NULL,
    car_plate              = NULL,
    car_image              = NULL,
    driver_note            = NULL,
    notif_push             = FALSE,
    notif_email            = FALSE,
    notif_sms              = FALSE,
    notif_marketing        = FALSE,
    deleted_at             = NOW(),
    deletion_reason        = p_reason,
    is_active              = FALSE,
    onboarding_completed   = FALSE,
    updated_at             = NOW()
  WHERE id = v_uid;

  -- 2) Anonymize denormalized email + name on every table that holds them.
  --    These are intentionally batched UPDATEs (not deletes) so counterparties
  --    keep their trip history with a "[حساب محذوف]" label instead of broken
  --    references.
  UPDATE public.messages
  SET sender_email = v_new_email, sender_name = '[محذوف]'
  WHERE sender_email = v_old_email;

  UPDATE public.messages
  SET receiver_email = v_new_email, receiver_name = '[محذوف]'
  WHERE receiver_email = v_old_email;

  UPDATE public.bookings
  SET passenger_email = v_new_email, passenger_name = '[محذوف]'
  WHERE passenger_email = v_old_email;

  UPDATE public.trips
  SET driver_email = v_new_email, driver_name = '[محذوف]'
  WHERE driver_email = v_old_email;

  UPDATE public.notifications
  SET user_email = v_new_email
  WHERE user_email = v_old_email;

  UPDATE public.reviews
  SET reviewer_email = v_new_email
  WHERE reviewer_email = v_old_email;

  UPDATE public.reviews
  SET driver_email = v_new_email
  WHERE driver_email = v_old_email;

  -- reviewed_email may not exist depending on schema variant
  BEGIN
    EXECUTE format('UPDATE public.reviews SET reviewed_email = %L WHERE reviewed_email = %L',
                   v_new_email, v_old_email);
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  UPDATE public.user_blocks
  SET blocker_email = v_new_email
  WHERE blocker_email = v_old_email;

  UPDATE public.user_blocks
  SET blocked_email = v_new_email
  WHERE blocked_email = v_old_email;

  UPDATE public.user_reports
  SET reporter_email = v_new_email
  WHERE reporter_email = v_old_email;

  UPDATE public.user_reports
  SET reported_email = v_new_email
  WHERE reported_email = v_old_email;

  UPDATE public.support_tickets
  SET user_email = v_new_email
  WHERE user_email = v_old_email;

  -- Trip preferences are pure preference data; just delete
  DELETE FROM public.trip_preferences WHERE user_email = v_old_email;

  -- 3) Cancel any non-terminal trips/bookings the user is on
  UPDATE public.trips SET status = 'cancelled', updated_at = NOW()
  WHERE driver_email = v_new_email AND status NOT IN ('completed','cancelled');

  UPDATE public.bookings SET status = 'cancelled', updated_at = NOW()
  WHERE passenger_email = v_new_email AND status NOT IN ('completed','cancelled');

  -- 4) Audit-log the self-deletion
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, details)
  VALUES (
    v_new_email,
    'account_self_deleted',
    'user',
    v_uid::text,
    jsonb_build_object('reason', p_reason, 'old_email_redacted', LEFT(v_old_email, 3) || '***')
  );

  -- 5) auth.users.email rotation. This requires elevated privileges that the
  -- normal SECURITY DEFINER context may not have on auth schema; if it fails,
  -- the user's Supabase Auth login still works with old email but profile
  -- gating in AuthContext signs them out via deleted_at. The session.email
  -- and the profiles.email are now divergent until next login, which is OK.
  BEGIN
    UPDATE auth.users
    SET email = v_new_email,
        encrypted_password = '',
        raw_user_meta_data = '{}'::jsonb
    WHERE id = v_uid;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'auth.users update skipped (no privilege); rely on profiles.deleted_at gate';
    WHEN OTHERS THEN
      RAISE NOTICE 'auth.users update skipped (%): rely on profiles.deleted_at gate', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'anonymized_email', v_new_email,
    'deleted_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.delete_user_account_v2(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account_v2(TEXT) TO authenticated;


-- =============================================================================
-- CLEANUP — only run AFTER the client has been cut over to book_seat()
-- =============================================================================
-- The existing notify_driver_on_booking trigger does seat decrement at the end.
-- Once the only insert path is the book_seat RPC (which decrements inside the
-- same transaction), the trigger's UPDATE block becomes a double-decrement.
-- This is a documentation comment — DO NOT execute the block below until the
-- client cutover has shipped and is verified live for at least 24 hours.
--
-- BEGIN;
--   CREATE OR REPLACE FUNCTION public.notify_driver_on_booking()
--   RETURNS TRIGGER
--   LANGUAGE plpgsql SECURITY DEFINER
--   SET search_path = public, pg_catalog
--   AS $fn$
--   DECLARE trip_record RECORD;
--   BEGIN
--     SELECT * INTO trip_record FROM public.trips WHERE id::text = NEW.trip_id LIMIT 1;
--     IF trip_record IS NULL THEN RETURN NEW; END IF;
--     INSERT INTO public.notifications (user_email, title, message, type, trip_id, from_city, to_city, is_read, created_by)
--     VALUES (trip_record.driver_email,
--             '🎉 حجز جديد لرحلتك',
--             COALESCE(NEW.passenger_name, 'راكب') || ' حجز ' || COALESCE(NEW.seats_booked, 1)::text ||
--               ' مقاعد في رحلتك من ' || trip_record.from_city || ' إلى ' || trip_record.to_city,
--             'system', trip_record.id::text, trip_record.from_city, trip_record.to_city,
--             false, 'system');
--     -- (seat-decrement removed; book_seat RPC handles it atomically)
--     RETURN NEW;
--   END $fn$;
-- COMMIT;


-- =============================================================================
-- VERIFICATION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE '────────────────────────────────────────────────────────';
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'book_seat')
  THEN RAISE NOTICE '✓ C-06  book_seat() RPC installed';
  ELSE RAISE WARNING '✗ C-06  book_seat() not found'; END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'delete_user_account_v2')
  THEN RAISE NOTICE '✓ C-05  delete_user_account_v2() RPC installed';
  ELSE RAISE WARNING '✗ C-05  delete_user_account_v2() not found'; END IF;

  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'Phase 1 RPCs ready. Client-side cutover ships in a follow-up commit.';
END $$;
