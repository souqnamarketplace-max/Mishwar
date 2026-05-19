-- ─────────────────────────────────────────────────────────────────────────────
-- 092_fix_delete_account_dob_column.sql
--
-- Migration 088's delete_user_account_v2 anonymization UPDATE sets
--     dob = NULL
-- but the actual column on public.profiles is date_of_birth (added in
-- migration 058's age-gate work — the *constraint* is named
-- profiles_dob_age_check, which is what made the typo plausible-looking).
-- Result: every call to the RPC fails with
--     column "dob" of relation "profiles" does not exist
-- so account deletion is completely broken. Latent since 088 because
-- the bug only fires when an authenticated user actually calls the RPC,
-- and end-to-end self-deletion hadn't been exercised until now.
--
-- Fix: CREATE OR REPLACE the function with date_of_birth instead of dob.
-- Function body is otherwise unchanged from mig 088 — including all the
-- subscription-cancellation logic and the v_cancelled_subs reporting.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_user_account_v2(
  p_reason TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid                    UUID := auth.uid();
  v_old_email              TEXT;
  v_new_email              TEXT;
  v_today                  DATE := CURRENT_DATE;
  v_active_trips           INT;
  v_active_bookings        INT;
  v_cancelled_subs         INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_old_email FROM auth.users WHERE id = v_uid;
  IF v_old_email IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- Server-side precondition: no active trips/bookings (unchanged)
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

  -- Cancel active driver subscriptions (mig 088, unchanged).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'driver_subscriptions'
  ) THEN
    UPDATE public.driver_subscriptions
       SET status        = 'cancelled',
           cancelled_at  = NOW(),
           period_end    = LEAST(period_end, NOW()),
           cancel_reason = 'account_deleted'
     WHERE driver_email = v_old_email
       AND status IN ('active', 'pending');
    GET DIAGNOSTICS v_cancelled_subs = ROW_COUNT;
  END IF;

  v_new_email := 'deleted-' || v_uid || '@deleted.local';

  -- Deletion handshake (mig 035, unchanged).
  PERFORM set_config('mishwar.deleting_account', v_uid::text, true);

  -- 1) Anonymize profile — date_of_birth here, NOT dob (that was the bug).
  UPDATE public.profiles
     SET full_name            = 'مستخدم محذوف',
         email                = v_new_email,
         phone                = NULL,
         avatar_url           = NULL,
         date_of_birth        = NULL,
         gender               = NULL,
         car_model            = NULL,
         car_year             = NULL,
         car_color            = NULL,
         car_plate            = NULL,
         car_image            = NULL,
         bank_iban            = NULL,
         jawwal_pay_number    = NULL,
         reflect_number       = NULL,
         credit_card_enabled  = FALSE,
         deletion_reason      = COALESCE(p_reason, deletion_reason),
         deleted_at           = NOW()
   WHERE id = v_uid;

  -- 2) Rotate auth.users email
  UPDATE auth.users
     SET email              = v_new_email,
         email_confirmed_at = NULL,
         banned_until       = '2099-12-31 00:00:00+00'
   WHERE id = v_uid;

  -- 3) Anonymize denormalized email columns
  UPDATE public.messages       SET sender_email    = v_new_email WHERE sender_email    = v_old_email;
  UPDATE public.messages       SET receiver_email  = v_new_email WHERE receiver_email  = v_old_email;
  UPDATE public.bookings       SET passenger_email = v_new_email WHERE passenger_email = v_old_email;
  UPDATE public.trips          SET driver_email    = v_new_email WHERE driver_email    = v_old_email;
  UPDATE public.notifications  SET user_email      = v_new_email WHERE user_email      = v_old_email;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewer_email') THEN
    UPDATE public.reviews SET reviewer_email = v_new_email WHERE reviewer_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewed_email') THEN
    UPDATE public.reviews SET reviewed_email = v_new_email WHERE reviewed_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_blocks' AND column_name='blocker_email') THEN
    UPDATE public.user_blocks SET blocker_email = v_new_email WHERE blocker_email = v_old_email;
    UPDATE public.user_blocks SET blocked_email = v_new_email WHERE blocked_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trip_requests') THEN
    UPDATE public.trip_requests SET passenger_email = v_new_email WHERE passenger_email = v_old_email;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_subscriptions') THEN
    UPDATE public.driver_subscriptions SET driver_email = v_new_email WHERE driver_email = v_old_email;
  END IF;

  RETURN jsonb_build_object(
    'success',                 true,
    'deleted_at',              NOW(),
    'reason',                  p_reason,
    'cancelled_subscriptions', v_cancelled_subs
  );
END $$;

REVOKE ALL ON FUNCTION public.delete_user_account_v2(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account_v2(TEXT) TO authenticated;
