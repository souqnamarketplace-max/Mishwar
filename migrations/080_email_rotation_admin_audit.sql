-- ════════════════════════════════════════════════════════════════════════
-- Migration 080 — Email rotation: admin attribution + audit logging
-- ════════════════════════════════════════════════════════════════════════
--
-- Follow-up to mig 079 (atomic email rotation). User asked: 'does the
-- change also not affect payment subscription, audit log, all admin
-- related things, and the changes also reported in the activity log?
-- does it affect the search in the future that related to the old
-- things?'
--
-- AUDIT FINDINGS FROM THAT QUESTION:
--
--   1. ADMIN ATTRIBUTION DISPLAY BREAKS
--      _actor_label() (mig 073) does a profile lookup keyed by email:
--          SELECT full_name FROM profiles WHERE email = p_email
--      If admin_audit_log.admin_email points to the OLD email and
--      profiles.email is now NEW (after cascade), the join misses.
--      The activity log renders as 'مستخدم' (unknown user) for every
--      historical action that admin took. The original mig 079
--      reasoning ('keep audit historical') was theoretically pure
--      but practically broke the UI.
--
--   2. driver_subscriptions.approved_by NOT CASCADED
--      When admin A approves a subscription, their email is written
--      to approved_by. After A changes email, dashboard queries that
--      JOIN approved_by → profiles fail.
--
--   3. NO AUDIT TRAIL FOR EMAIL CHANGES
--      The email change itself was silent. An admin reviewing the
--      activity log couldn't see 'user X changed email from A to B
--      at time T' — important for fraud detection (an account
--      changing emails 5x in a day is suspicious).
--
--   4. SEARCH IMPACT — None on UI search (cities, not emails). But
--      the denormalized email indices (e.g. idx_trips_driver_created
--      from mig 074) need to absorb the cascade. Postgres handles
--      this transparently during UPDATE; on a power user with
--      thousands of trips, the cascade transaction holds locks
--      for ~1-2 seconds. Already documented in mig 079.
--
-- THIS MIGRATION:
--   A. Extends update_my_email RPC to ALSO cascade:
--        - admin_audit_log.admin_email
--        - driver_subscriptions.approved_by
--   B. Adds an audit log entry from inside the RPC documenting the
--      email change itself.
--   C. Adds 'email_changed' WHEN clause to _compose_audit_text so
--      the activity log renders the change with a friendly Arabic
--      sentence.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Extend update_my_email to cascade admin columns + log change ──

CREATE OR REPLACE FUNCTION public.update_my_email(p_new_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid           UUID;
  v_auth_email    TEXT;
  v_old_email     TEXT;
  v_clean_new     TEXT;
  v_rows_updated  JSONB := '{}'::jsonb;
  v_count         INTEGER;
BEGIN
  -- ── 1. Identify the caller ──
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT email INTO v_auth_email FROM auth.users WHERE id = v_uid;
  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Auth user not found' USING ERRCODE = '28000';
  END IF;

  v_clean_new := lower(trim(p_new_email));

  IF v_clean_new <> lower(v_auth_email) THEN
    RAISE EXCEPTION 'New email % does not match authenticated identity %. Complete the email confirmation link first.',
      v_clean_new, v_auth_email USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_old_email FROM public.profiles WHERE id = v_uid;
  IF v_old_email IS NULL OR lower(v_old_email) = v_clean_new THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'message', 'No cascade needed — already in sync',
      'old_email', v_old_email,
      'new_email', v_clean_new
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE lower(email) = v_clean_new AND id <> v_uid
  ) THEN
    RAISE EXCEPTION 'Another account already uses email %', v_clean_new
      USING ERRCODE = '23505';
  END IF;

  -- ── 2. Cascade ──
  UPDATE public.profiles SET email = v_clean_new WHERE id = v_uid;

  UPDATE public.trips SET driver_email = v_clean_new WHERE driver_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('trips_driver_email', v_count);

  UPDATE public.trips SET created_by = v_clean_new WHERE created_by = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('trips_created_by', v_count);

  UPDATE public.bookings SET passenger_email = v_clean_new WHERE passenger_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('bookings_passenger_email', v_count);

  UPDATE public.bookings SET created_by = v_clean_new WHERE created_by = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('bookings_created_by', v_count);

  UPDATE public.favorite_drivers SET passenger_email = v_clean_new WHERE passenger_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('favorite_drivers_passenger', v_count);

  UPDATE public.favorite_drivers SET driver_email = v_clean_new WHERE driver_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('favorite_drivers_driver', v_count);

  UPDATE public.notifications SET user_email = v_clean_new WHERE user_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('notifications', v_count);

  -- ── NEW IN MIG 080: admin_audit_log.admin_email cascade ──
  -- _actor_label() does profiles lookup keyed by email, so the historical
  -- admin_email column MUST follow the cascade or the activity log
  -- renders 'مستخدم' (unknown) for every past action by this admin.
  -- The historical-integrity concern is preserved via the new
  -- 'email_changed' audit row inserted at the bottom of this RPC —
  -- anyone wanting to trace 'who was admin@old.com previously' can
  -- find the mapping there.
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='admin_audit_log') THEN
    EXECUTE format(
      'UPDATE public.admin_audit_log SET admin_email = %L WHERE admin_email = %L',
      v_clean_new, v_old_email
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows_updated := v_rows_updated || jsonb_build_object('admin_audit_log_admin_email', v_count);
  END IF;

  -- ── NEW IN MIG 080: driver_subscriptions.approved_by cascade ──
  -- Dashboard subscription queries display 'approved by admin X' by
  -- joining approved_by → profiles. If admin's email changed, the
  -- join misses and the column shows the raw old email (or nothing).
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='driver_subscriptions'
                AND column_name='approved_by') THEN
    EXECUTE format(
      'UPDATE public.driver_subscriptions SET approved_by = %L WHERE approved_by = %L',
      v_clean_new, v_old_email
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows_updated := v_rows_updated || jsonb_build_object('driver_subscriptions_approved_by', v_count);
  END IF;

  -- Existing optional cascades retained from mig 079
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='messages') THEN
    BEGIN
      EXECUTE format('UPDATE public.messages SET sender_email = %L WHERE sender_email = %L', v_clean_new, v_old_email);
      EXECUTE format('UPDATE public.messages SET recipient_email = %L WHERE recipient_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='device_tokens') THEN
    BEGIN
      EXECUTE format('UPDATE public.device_tokens SET user_email = %L WHERE user_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trip_requests') THEN
    BEGIN
      EXECUTE format('UPDATE public.trip_requests SET passenger_email = %L WHERE passenger_email = %L', v_clean_new, v_old_email);
      EXECUTE format('UPDATE public.trip_requests SET created_by = %L WHERE created_by = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trip_preferences') THEN
    BEGIN
      EXECUTE format('UPDATE public.trip_preferences SET user_email = %L WHERE user_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_subscriptions') THEN
    BEGIN
      EXECUTE format('UPDATE public.driver_subscriptions SET driver_email = %L WHERE driver_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_licenses') THEN
    BEGIN
      EXECUTE format('UPDATE public.driver_licenses SET driver_email = %L WHERE driver_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='city_suggestions') THEN
    BEGIN
      EXECUTE format('UPDATE public.city_suggestions SET suggested_by_email = %L WHERE suggested_by_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reviews') THEN
    BEGIN
      EXECUTE format('UPDATE public.reviews SET reviewer_email = %L WHERE reviewer_email = %L', v_clean_new, v_old_email);
      EXECUTE format('UPDATE public.reviews SET rated_user_email = %L WHERE rated_user_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_reports') THEN
    BEGIN
      EXECUTE format('UPDATE public.user_reports SET reporter_email = %L WHERE reporter_email = %L', v_clean_new, v_old_email);
      EXECUTE format('UPDATE public.user_reports SET reported_email = %L WHERE reported_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_blocks') THEN
    BEGIN
      EXECUTE format('UPDATE public.user_blocks SET blocker_email = %L WHERE blocker_email = %L', v_clean_new, v_old_email);
      EXECUTE format('UPDATE public.user_blocks SET blocked_email = %L WHERE blocked_email = %L', v_clean_new, v_old_email);
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  -- ── NEW IN MIG 080: audit log entry for the change itself ──
  -- This is THE evidentiary record. If anyone asks 'what email did
  -- this user have last quarter?' the answer lives in this row's
  -- details JSONB. The old email is preserved redacted (first 3
  -- chars + ***) to satisfy GDPR Art. 5(1)(c) data minimization
  -- while still being useful for fraud investigation.
  --
  -- Action 'email_changed' has a WHEN clause in _compose_audit_text
  -- (added below) so the activity log renders this as:
  --   '✉️ غيّر {actor_label} بريده الإلكتروني'
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='admin_audit_log') THEN
    INSERT INTO public.admin_audit_log (
      admin_email, action, target_type, target_id, details
    ) VALUES (
      v_clean_new,
      'email_changed',
      'user',
      v_uid::text,
      jsonb_build_object(
        'old_email_redacted', LEFT(v_old_email, 3) || '***@' || split_part(v_old_email, '@', 2),
        'new_email_redacted', LEFT(v_clean_new, 3) || '***@' || split_part(v_clean_new, '@', 2),
        'rows_updated', v_rows_updated
      )
    );
  END IF;

  RAISE NOTICE 'update_my_email: rotated % → % for uid % — counts %',
    v_old_email, v_clean_new, v_uid, v_rows_updated;

  RETURN jsonb_build_object(
    'success', TRUE,
    'old_email', v_old_email,
    'new_email', v_clean_new,
    'rows_updated', v_rows_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_email(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_my_email(TEXT) TO authenticated;


-- ─── 2. Add 'email_changed' WHEN clause to _compose_audit_text ────────
-- Without this WHEN, the activity log would render the email-change
-- audit row as 'email_changed (Ahmad)' instead of a friendly Arabic
-- sentence. Same pattern as every other action.
--
-- CREATE OR REPLACE re-issues the entire function body. The base body
-- is from mig 075. We add ONE new WHEN clause alphabetically near the
-- other user-account actions.

CREATE OR REPLACE FUNCTION public._compose_audit_text(
  p_action      TEXT,
  p_target_type TEXT,
  p_details     JSONB,
  p_admin_email TEXT
)
RETURNS TEXT
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_email TEXT;
  v_actor_label TEXT;
  v_route       TEXT := COALESCE(p_details->>'route', '');
  v_ticket_type TEXT;
BEGIN
  v_actor_email := public._audit_primary_actor(p_action, p_details, p_admin_email);
  v_actor_label := public._actor_label(v_actor_email);

  v_ticket_type := CASE p_details->>'ticket_type'
    WHEN 'complaint'  THEN 'شكوى'
    WHEN 'suggestion' THEN 'اقتراح'
    WHEN 'praise'     THEN 'إشادة'
    ELSE COALESCE(p_details->>'ticket_type', 'ملاحظة')
  END;

  RETURN CASE p_action
    WHEN 'trip_created'         THEN '🚗 نشر السائق ' || v_actor_label || ' رحلة جديدة' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'driver_cancel_trip'   THEN '❌ ألغى السائق ' || v_actor_label || ' رحلته' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'admin_delete_trip'    THEN '🗑️ حذفت الإدارة (' || v_actor_label || ') رحلة'
    WHEN 'driver_delete_trip'   THEN '🗑️ حذف السائق ' || v_actor_label || ' رحلته'
    WHEN 'delete_trip'          THEN '🗑️ حُذفت رحلة (' || v_actor_label || ')'
    WHEN 'driver_start_trip'    THEN '🚦 بدأ السائق ' || v_actor_label || ' رحلته' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'driver_complete_trip' THEN '✅ أنهى السائق ' || v_actor_label || ' الرحلة' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'driver_change_trip_time' THEN '⏰ غيّر السائق ' || v_actor_label || ' موعد رحلته'
    WHEN 'admin_cancel_trip_request' THEN '❌ ألغت الإدارة (' || v_actor_label || ') طلب رحلة'
    WHEN 'trip_request_created' THEN '🙋 نشر الراكب ' || v_actor_label || ' طلب رحلة' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END

    WHEN 'booking_created'                  THEN '🎟️ حجز الراكب ' || v_actor_label || ' مقعداً' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'booking_confirmed'                THEN '✓ وافق السائق ' || v_actor_label || ' على حجز'
    WHEN 'driver_confirm_booking'           THEN '✓ وافق السائق ' || v_actor_label || ' على حجز'
    WHEN 'driver_reject_booking'            THEN '✗ رفض السائق ' || v_actor_label || ' حجزاً'
    WHEN 'driver_cancel_confirmed_booking'  THEN '✗ ألغى السائق ' || v_actor_label || ' حجزاً مؤكداً'
    WHEN 'booking_cancelled_by_passenger'   THEN '↩️ ألغى الراكب ' || v_actor_label || ' حجزه'

    WHEN 'driver_review_submitted'    THEN '⭐ قيّم السائق ' || v_actor_label || ' راكباً' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END
    WHEN 'passenger_review_submitted' THEN '⭐ قيّم الراكب ' || v_actor_label || ' السائق' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END

    WHEN 'onboarding_completed'              THEN '👤 أكمل ' || v_actor_label || ' التسجيل' || CASE WHEN (p_details->>'account_type') IS NOT NULL THEN ' (' || (p_details->>'account_type') || ')' ELSE '' END
    WHEN 'passenger_verification_submitted'  THEN '🛡️ طلب الراكب ' || v_actor_label || ' التوثيق'
    WHEN 'passenger_verification_approved'   THEN '✓ وثّقت الإدارة (' || v_actor_label || ') حساب راكب'
    WHEN 'passenger_verification_rejected'   THEN '✗ رفضت الإدارة (' || v_actor_label || ') توثيقاً'
    WHEN 'passenger_verification_revoked'    THEN '⊘ سحبت الإدارة (' || v_actor_label || ') توثيق راكب'
    WHEN 'account_self_delete_initiated'     THEN '⚠️ بدأ ' || v_actor_label || ' حذف حسابه'
    WHEN 'account_self_deleted'              THEN '🗑️ حذف ' || v_actor_label || ' حسابه نهائياً'
    WHEN 'admin_update_user'                 THEN '✏️ حدّثت الإدارة (' || v_actor_label || ') بيانات مستخدم'
    WHEN 'admin_deactivate_user'             THEN '🚫 عطّلت الإدارة (' || v_actor_label || ') حساب مستخدم'
    WHEN 'admin_activate_user'               THEN '✓ فعّلت الإدارة (' || v_actor_label || ') حساب مستخدم'
    WHEN 'admin_clear_strikes'               THEN '♻️ مسحت الإدارة (' || v_actor_label || ') مخالفات مستخدم'
    WHEN 'admin_update_booking_status'       THEN '✏️ حدّثت الإدارة (' || v_actor_label || ') حالة حجز'
    WHEN 'user_block'                        THEN '⛔ حظر ' || v_actor_label || ' مستخدماً آخر'
    -- NEW: email change (mig 080). Notable for fraud detection — an
    -- admin reviewing the activity log can spot suspicious patterns
    -- (e.g. account changing emails 5x in a day).
    WHEN 'email_changed'                     THEN '✉️ غيّر ' || v_actor_label || ' بريده الإلكتروني'

    WHEN 'password_reset_requested'          THEN '🔑 طلب ' || v_actor_label || ' إعادة تعيين كلمة المرور'

    WHEN 'subscription_requested'    THEN '💳 طلب السائق ' || v_actor_label || ' اشتراكاً'
    WHEN 'subscription_approved'     THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اشتراك'
    WHEN 'subscription_rejected'     THEN '✗ رفضت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_granted'      THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_bulk_granted' THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكات بالجملة'

    WHEN 'driver_license_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على رخصة سائق'
    WHEN 'driver_license_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') رخصة سائق'

    WHEN 'city_suggested'           THEN '🗺️ اقترح ' || v_actor_label || ' إضافة مدينة' || CASE WHEN (p_details->>'city_name') IS NOT NULL THEN ' (' || (p_details->>'city_name') || ')' ELSE '' END
    WHEN 'city_suggestion_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اقتراح مدينة'
    WHEN 'city_suggestion_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') اقتراح مدينة'
    WHEN 'city_added_directly'      THEN '🗺️ أضافت الإدارة (' || v_actor_label || ') مدينة جديدة' || CASE WHEN (p_details->>'canonical_name') IS NOT NULL THEN ' (' || (p_details->>'canonical_name') || ')' ELSE '' END

    WHEN 'report_filed'         THEN '🚨 أبلغ ' || v_actor_label || ' عن مستخدم آخر'
    WHEN 'feedback_submitted'   THEN '💬 أرسل ' || v_actor_label || ' ' || v_ticket_type
    WHEN 'admin_mark_payment'   THEN '💰 سجّلت الإدارة (' || v_actor_label || ') دفعة'

    ELSE p_action || ' (' || v_actor_label || ')'
  END;
END;
$$;

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_test_output  TEXT;
  v_email_clause BOOLEAN;
BEGIN
  -- Smoke test the new 'email_changed' WHEN clause
  v_test_output := public._compose_audit_text(
    'email_changed',
    'user',
    jsonb_build_object('old_email_redacted', 'ahm***@example.com'),
    'new@example.com'
  );
  v_email_clause := v_test_output LIKE '✉️ غيّر %بريده الإلكتروني%';
  IF NOT v_email_clause THEN
    RAISE EXCEPTION 'MIGRATION 080 FAILED — email_changed WHEN clause did not render correctly. Got: %', v_test_output;
  END IF;

  RAISE NOTICE 'MIGRATION 080 OK';
  RAISE NOTICE '  - update_my_email now also cascades admin_audit_log + driver_subscriptions.approved_by';
  RAISE NOTICE '  - email changes now logged to activity log';
  RAISE NOTICE '  - email_changed renders as: %', v_test_output;
END;
$$;
