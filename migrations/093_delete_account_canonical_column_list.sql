-- ─────────────────────────────────────────────────────────────────────────────
-- 093_delete_account_canonical_column_list.sql
--
-- Migration 088's delete_user_account_v2 anonymization UPDATE referenced
-- TWO non-existent columns on public.profiles:
--   - dob               (real column: date_of_birth — fixed in mig 092)
--   - credit_card_enabled (no such column anywhere — only ever appeared
--                          in mig 088 itself and never in a CREATE/ALTER)
--
-- Mig 092 fixed the first; the second only surfaced once 092 unblocked
-- the function to reach the next line. Rather than play whack-a-mole one
-- column at a time, this migration aligns the UPDATE with the proven-
-- working column list from mig 003's earlier delete RPC (which shipped
-- and worked for over a year before mig 088 reframed it), plus the
-- payment-and-notification columns that *do* exist and that mig 088 was
-- correctly trying to wipe.
--
-- Diff vs mig 092:
--   - REMOVED credit_card_enabled (column does not exist)
--   - ADDED   bio, bank_account_number, bank_name,
--             card_holder_name, card_last_four,
--             pref_smoking, pref_chattiness, pref_pets,
--             vehicle_luggage, vehicle_back_row,
--             driver_note,
--             notif_push, notif_email, notif_sms, notif_marketing,
--             is_active, onboarding_completed, updated_at
--     (all from mig 003's working anonymization — they exist on the
--      production profiles table; mig 088 forgot them)
--
-- Subscription cancellation, email rotation, denormalized-column
-- anonymization, return shape — all unchanged from mig 088.
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

  -- Server-side preconditions (unchanged).
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

  -- Cancel active driver subscriptions (mig 088 logic, preserved).
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

  -- 1) Anonymize profile — canonical column list from mig 003 + later
  -- additions (date_of_birth, gender). NO credit_card_enabled, NO dob.
  UPDATE public.profiles
     SET full_name              = 'مستخدم محذوف',
         email                  = v_new_email,
         phone                  = NULL,
         avatar_url             = NULL,
         bio                    = NULL,
         date_of_birth          = NULL,
         gender                 = NULL,
         -- payment
         bank_iban              = NULL,
         bank_account_number    = NULL,
         bank_name              = NULL,
         card_holder_name       = NULL,
         card_last_four         = NULL,
         jawwal_pay_number      = NULL,
         reflect_number         = NULL,
         -- vehicle
         car_model              = NULL,
         car_year               = NULL,
         car_color              = NULL,
         car_plate              = NULL,
         car_image              = NULL,
         driver_note            = NULL,
         -- ride preferences
         pref_smoking           = NULL,
         pref_chattiness        = NULL,
         pref_pets              = NULL,
         vehicle_luggage        = NULL,
         vehicle_back_row       = NULL,
         -- notification opt-ins
         notif_push             = FALSE,
         notif_email            = FALSE,
         notif_sms              = FALSE,
         notif_marketing        = FALSE,
         -- account state
         is_active              = FALSE,
         onboarding_completed   = FALSE,
         deletion_reason        = COALESCE(p_reason, deletion_reason),
         deleted_at             = NOW(),
         updated_at             = NOW()
   WHERE id = v_uid;

  -- 2) Rotate auth.users email (mig 088, unchanged).
  UPDATE auth.users
     SET email              = v_new_email,
         email_confirmed_at = NULL,
         banned_until       = '2099-12-31 00:00:00+00'
   WHERE id = v_uid;

  -- 3) Anonymize denormalized email columns (mig 088, unchanged).
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
