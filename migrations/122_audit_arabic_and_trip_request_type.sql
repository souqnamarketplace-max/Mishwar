-- ════════════════════════════════════════════════════════════════════════
-- Migration 122 — Audit log Arabic completeness + trip_request as own type
--
-- ─── PART 1: Arabic translations for 11 untranslated action codes ───────
-- The activity log was showing entries like:
--     "trip_auto_expired_to_completed (system)"
--     "admin_set_account_type (خالد)"
-- These hit the ELSE branch in _compose_audit_text and got rendered with
-- the raw English action code. Admins reading the activity feed have to
-- mentally translate every one — this hurts comprehension and creates
-- the impression that "the system speaks half-English". Fix: add every
-- action that's currently in admin_audit_log without a translation.
--
-- Inventory of missing codes (from audit table, by count):
--   trip_auto_expired_to_completed    25  — auto-expiry sweep flipped a
--                                          stale trip from 'in_progress'
--                                          to 'completed' (cron job)
--   trip_auto_expired_to_in_progress  24  — auto-expiry sweep flipped a
--                                          stale trip from 'upcoming' to
--                                          'in_progress' (cron job)
--   account_resigned_after_deletion    7  — same email registered again
--                                          after the user deleted account
--   broadcast_notification             4  — admin sent a push broadcast
--   pending_bookings_auto_cancelled    4  — book_seat sweep killed stale
--                                          pending bookings on the trip
--   app_settings_updated               3  — admin changed an app_settings
--   admin_reset_onboarding             2  — admin wiped a user's onboarding
--   admin_set_account_type             2  — admin changed account_type
--                                          (passenger/driver/both)
--   report_action_taken                1  — admin took action on report
--   report_dismissed                   1  — admin dismissed report w/o action
--   audit_pipeline_smoke_test          1  — diagnostic, ok to omit but
--                                          including for completeness
--
-- ─── PART 2: separate "passenger trip request" from "driver trip" ──────
-- Currently both driver-posted trips and passenger-posted trip requests
-- share the activity type 'trip'. Admin can't filter "show me only
-- passenger requests" without scrolling. Split into:
--   - 'trip'         → driver-posted trips (created, started, completed,
--                      cancelled, etc.)
--   - 'trip_request' → passenger-posted ride requests (created, expired,
--                      cancelled by passenger or admin)
--
-- Front-end change required in DashboardLogs.jsx to add the new chip;
-- old mobile clients on 1.0.5 will fall back to typeConfig.user for
-- unknown types (graceful degradation, not a crash).
-- ════════════════════════════════════════════════════════════════════════

-- ─── _compose_audit_text: add Arabic for 11 untranslated codes ─────────
CREATE OR REPLACE FUNCTION public._compose_audit_text(p_action text, p_target_type text, p_details jsonb, p_admin_email text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor_email TEXT;
  v_actor_label TEXT;
  v_route       TEXT := COALESCE(p_details->>'route', '');
  v_ticket_type TEXT;
  v_count       TEXT;
  v_old_type    TEXT;
  v_new_type    TEXT;
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
    -- ─── Trips (driver-side) ─────────────────────────────────────────
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

    -- ─── NEW: auto-expiry trail (cron-issued) ────────────────────────
    -- These come from the auto_expire_trips() cron job (mig 045 area).
    -- Actor is system; the label will end up as "النظام" via
    -- _actor_label for the special 'system' email.
    WHEN 'trip_auto_expired_to_completed'  THEN '⏲️ أنهى النظام رحلة منتهية تلقائياً'
    WHEN 'trip_auto_expired_to_in_progress' THEN '⏲️ بدأ النظام رحلة تلقائياً بعد موعد انطلاقها'
    WHEN 'pending_bookings_auto_cancelled' THEN '⏲️ ألغى النظام حجوزات معلّقة بعد انتهاء الرحلة' ||
      CASE WHEN (p_details->>'count') IS NOT NULL THEN ' (' || (p_details->>'count') || ')' ELSE '' END

    -- ─── Bookings ────────────────────────────────────────────────────
    WHEN 'booking_created'                  THEN '🎟️ حجز الراكب ' || v_actor_label || ' مقعداً' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'booking_confirmed'                THEN '✓ وافق السائق ' || v_actor_label || ' على حجز'
    WHEN 'driver_confirm_booking'           THEN '✓ وافق السائق ' || v_actor_label || ' على حجز'
    WHEN 'driver_reject_booking'            THEN '✗ رفض السائق ' || v_actor_label || ' حجزاً'
    WHEN 'driver_cancel_confirmed_booking'  THEN '✗ ألغى السائق ' || v_actor_label || ' حجزاً مؤكداً'
    WHEN 'booking_cancelled_by_passenger'   THEN '↩️ ألغى الراكب ' || v_actor_label || ' حجزه'

    -- ─── Reviews ─────────────────────────────────────────────────────
    WHEN 'driver_review_submitted'    THEN '⭐ قيّم السائق ' || v_actor_label || ' راكباً' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END
    WHEN 'passenger_review_submitted' THEN '⭐ قيّم الراكب ' || v_actor_label || ' السائق' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END

    -- ─── Users / accounts ────────────────────────────────────────────
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
    WHEN 'email_changed'                     THEN '✉️ غيّر ' || v_actor_label || ' بريده الإلكتروني'
    WHEN 'password_reset_requested'          THEN '🔑 طلب ' || v_actor_label || ' إعادة تعيين كلمة المرور'

    -- ─── NEW: admin account-management actions ───────────────────────
    -- account_resigned_after_deletion: profile row reactivated because the
    -- same email signed up again after a previous delete (mig 088 path).
    -- Shows up frequently for test accounts; meaningful for fraud review.
    WHEN 'account_resigned_after_deletion' THEN '🔄 أعاد ' || v_actor_label || ' التسجيل بعد حذف الحساب'
    -- admin_set_account_type: dashboard role switch (passenger↔driver↔both).
    -- Include the new role in parens when present in details.
    WHEN 'admin_set_account_type' THEN '🔧 غيّرت الإدارة نوع حساب (' || v_actor_label || ')' ||
      CASE WHEN (p_details->>'new_type') IS NOT NULL
        THEN ' → ' || (p_details->>'new_type')
        ELSE ''
      END
    -- admin_reset_onboarding: dashboard "Reset Onboarding" button.
    -- The user will be forced through the signup flow again next login.
    WHEN 'admin_reset_onboarding' THEN '↻ أعادت الإدارة بدء تسجيل (' || v_actor_label || ')'

    -- ─── Subscriptions / payments ────────────────────────────────────
    WHEN 'subscription_requested'    THEN '💳 طلب السائق ' || v_actor_label || ' اشتراكاً'
    WHEN 'subscription_approved'     THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اشتراك'
    WHEN 'subscription_rejected'     THEN '✗ رفضت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_granted'      THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_bulk_granted' THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكات بالجملة'

    -- ─── Licenses ────────────────────────────────────────────────────
    WHEN 'driver_license_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على رخصة سائق'
    WHEN 'driver_license_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') رخصة سائق'

    -- ─── Cities ──────────────────────────────────────────────────────
    WHEN 'city_suggested'           THEN '🗺️ اقترح ' || v_actor_label || ' إضافة مدينة' || CASE WHEN (p_details->>'city_name') IS NOT NULL THEN ' (' || (p_details->>'city_name') || ')' ELSE '' END
    WHEN 'city_suggestion_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اقتراح مدينة'
    WHEN 'city_suggestion_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') اقتراح مدينة'
    WHEN 'city_added_directly'      THEN '🗺️ أضافت الإدارة (' || v_actor_label || ') مدينة جديدة' || CASE WHEN (p_details->>'canonical_name') IS NOT NULL THEN ' (' || (p_details->>'canonical_name') || ')' ELSE '' END

    -- ─── Reports / feedback ──────────────────────────────────────────
    WHEN 'report_filed'         THEN '🚨 أبلغ ' || v_actor_label || ' عن مستخدم آخر'
    -- NEW: action_taken / dismissed for admin review of user_reports.
    -- These are the resolution actions on a report (e.g. issued warning,
    -- blocked user, or determined no action needed).
    WHEN 'report_action_taken'  THEN '⚖️ اتخذت الإدارة (' || v_actor_label || ') إجراءً على بلاغ'
    WHEN 'report_dismissed'     THEN '✗ رفضت الإدارة (' || v_actor_label || ') البلاغ'
    WHEN 'feedback_submitted'   THEN '💬 أرسل ' || v_actor_label || ' ' || v_ticket_type
    WHEN 'admin_mark_payment'   THEN '💰 سجّلت الإدارة (' || v_actor_label || ') دفعة'

    -- ─── NEW: system / admin operations ──────────────────────────────
    -- broadcast_notification: admin sent a push or in-app announcement to
    -- a segment of users. Include audience size when present.
    WHEN 'broadcast_notification' THEN '📣 أرسلت الإدارة (' || v_actor_label || ') إشعاراً عاماً' ||
      CASE WHEN (p_details->>'recipient_count') IS NOT NULL
        THEN ' (' || (p_details->>'recipient_count') || ' مستخدم)'
        ELSE ''
      END
    -- app_settings_updated: changes to flags like maintenance mode, min
    -- app version, payment toggles. Diagnostic detail only — no extra
    -- key surfaced because details schema varies per setting.
    WHEN 'app_settings_updated' THEN '⚙️ حدّثت الإدارة (' || v_actor_label || ') إعدادات التطبيق'
    -- audit_pipeline_smoke_test: deliberate test write to verify the
    -- audit trail is functional after a deploy or DR drill. Kept simple.
    WHEN 'audit_pipeline_smoke_test' THEN '🧪 اختبار سلامة سجل التدقيق'

    ELSE p_action || ' (' || v_actor_label || ')'
  END;
END;
$function$;

-- ─── PART 2: separate trip_request from trip in the activity feed ──────

CREATE OR REPLACE FUNCTION public._map_audit_to_activity_type(p_target_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_target_type
    WHEN 'trip'                    THEN 'trip'
    -- Changed: trip_request now has its own type so admins can filter for
    -- "passenger requests" separately from "driver trips" without scrolling.
    WHEN 'trip_request'            THEN 'trip_request'
    WHEN 'booking'                 THEN 'booking'
    WHEN 'review'                  THEN 'review'
    WHEN 'report'                  THEN 'report'
    WHEN 'feedback'                THEN 'feedback'
    WHEN 'support_ticket'          THEN 'feedback'
    WHEN 'city_suggestion'         THEN 'user'
    WHEN 'user'                    THEN 'user'
    WHEN 'driver_subscription'     THEN 'user'
    WHEN 'passenger_verification'  THEN 'user'
    WHEN 'driver_license'          THEN 'user'
    WHEN 'payment'                 THEN 'user'
    ELSE 'user'
  END;
$function$;

-- ─── Update activity_log RPC: 2 inline derivations of trip_request rows ─
-- The activity_log function duplicates its UNION ALL chain (once for the
-- count, once for the page). Both copies have a row that hardcodes type
-- 'trip' for the derived trip_request entries — we update both to use
-- 'trip_request' for consistency with the audit-driven rows.
CREATE OR REPLACE FUNCTION public.activity_log(filter_type text DEFAULT 'all'::text, search_email text DEFAULT NULL::text, page_param integer DEFAULT 1, page_size_param integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'auth'
AS $function$
DECLARE
  v_offset   INTEGER;
  v_total    INTEGER;
  v_rows     JSONB;
  v_role     TEXT := public.auth_user_role();
  v_email_q  TEXT;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  v_offset  := (GREATEST(page_param, 1) - 1) * page_size_param;
  v_email_q := NULLIF(trim(COALESCE(search_email, '')), '');

  -- Count of all filtered events.
  SELECT COUNT(*)::INTEGER INTO v_total
  FROM (
    SELECT 1
    FROM (
      SELECT
        'audit:' || a.id::text                                    AS event_id,
        public._map_audit_to_activity_type(a.target_type)         AS type,
        public._compose_audit_text(a.action, a.target_type, a.details, a.admin_email) AS text,
        a.created_at                                              AS created_at,
        public._audit_primary_actor(a.action, a.details, a.admin_email) AS actor_email
      FROM public.admin_audit_log a

      UNION ALL

      SELECT 'derived:trip_created:' || t.id::text, 'trip',
        '🚗 نشر السائق ' || public._actor_label(t.driver_email) ||
        ' رحلة جديدة (' || t.from_city || ' → ' || t.to_city || ')',
        t.created_at, t.driver_email
      FROM public.trips t
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'trip_created' AND target_id = t.id::text)

      UNION ALL

      SELECT 'derived:trip_cancelled:' || t.id::text, 'trip',
        '❌ ألغى السائق ' || public._actor_label(t.driver_email) ||
        ' رحلته (' || t.from_city || ' → ' || t.to_city || ')',
        t.updated_at, t.driver_email
      FROM public.trips t
      WHERE t.status = 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('driver_cancel_trip', 'admin_delete_trip',
                                         'driver_delete_trip', 'delete_trip')
                          AND target_id = t.id::text)

      UNION ALL

      SELECT 'derived:trip_completed:' || t.id::text, 'trip',
        '✅ أنهى السائق ' || public._actor_label(t.driver_email) ||
        ' الرحلة (' || t.from_city || ' → ' || t.to_city || ')',
        t.updated_at, t.driver_email
      FROM public.trips t
      WHERE t.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'driver_complete_trip' AND target_id = t.id::text)

      UNION ALL

      SELECT 'derived:trip_started:' || t.id::text, 'trip',
        '🚦 بدأ السائق ' || public._actor_label(t.driver_email) ||
        ' الرحلة (' || t.from_city || ' → ' || t.to_city || ')',
        t.updated_at, t.driver_email
      FROM public.trips t
      WHERE t.status = 'in_progress'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'driver_start_trip' AND target_id = t.id::text)

      UNION ALL

      SELECT 'derived:booking_created:' || b.id::text, 'booking',
        '🎟️ حجز الراكب ' || public._actor_label(b.passenger_email) || ' مقعداً' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
        b.created_at, b.passenger_email
      FROM public.bookings b
      LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'booking_created' AND target_id = b.id::text)

      UNION ALL

      SELECT 'derived:booking_cancelled:' || b.id::text, 'booking',
        '↩️ ألغى ' || public._actor_label(b.passenger_email) || ' حجزه' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
        COALESCE(b.updated_at, b.created_at), b.passenger_email
      FROM public.bookings b
      LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
      WHERE b.status = 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('booking_cancelled_by_passenger',
                                         'driver_cancel_confirmed_booking',
                                         'driver_reject_booking')
                          AND target_id = b.id::text)

      UNION ALL

      SELECT 'derived:booking_confirmed:' || b.id::text, 'booking',
        '✓ وافق السائق ' || public._actor_label(t.driver_email) ||
        ' على حجز الراكب ' || public._actor_label(b.passenger_email) ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
        COALESCE(b.updated_at, b.created_at), t.driver_email
      FROM public.bookings b
      LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
      WHERE b.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('booking_confirmed', 'driver_confirm_booking')
                          AND target_id = b.id::text)

      UNION ALL

      SELECT 'derived:review:' || r.id::text, 'review',
        CASE r.review_type
          WHEN 'driver_rates_passenger' THEN '⭐ قيّم السائق ' || public._actor_label(r.reviewer_email) || ' راكباً'
          ELSE '⭐ قيّم الراكب ' || public._actor_label(r.reviewer_email) || ' السائق'
        END || ' (' || r.rating::text || '/5)',
        r.created_at, r.reviewer_email
      FROM public.reviews r
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('driver_review_submitted', 'passenger_review_submitted')
                          AND target_id = r.trip_id::text)

      UNION ALL

      SELECT 'derived:report:' || ur.id::text, 'report',
        '🚨 أبلغ ' || public._actor_label(ur.reporter_email) || ' عن مستخدم آخر',
        ur.created_at, ur.reporter_email
      FROM public.user_reports ur
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('report_filed', 'report')
                          AND target_id = ur.id::text)

      UNION ALL

      SELECT 'derived:feedback:' || st.id::text, 'feedback',
        '💬 أرسل ' || public._actor_label(st.user_email) || ' ' ||
          CASE st.type
            WHEN 'complaint'  THEN 'شكوى'
            WHEN 'suggestion' THEN 'اقتراح'
            WHEN 'praise'     THEN 'إشادة'
            ELSE COALESCE(st.type, 'ملاحظة')
          END,
        st.created_at, st.user_email
      FROM public.support_tickets st
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'feedback_submitted' AND target_id = st.id::text)

      UNION ALL

      -- Changed: derived trip_request rows now report type 'trip_request'
      -- instead of 'trip' so the new "طلبات الركاب" filter chip works.
      SELECT 'derived:trip_request:' || tr.id::text, 'trip_request',
        '🙋 نشر الراكب ' || public._actor_label(tr.passenger_email) ||
        ' طلب رحلة (' || tr.from_city || ' → ' || tr.to_city || ')',
        tr.created_at, tr.passenger_email
      FROM public.trip_requests tr
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'trip_request_created' AND target_id = tr.id::text)

      UNION ALL

      SELECT 'derived:subscription:' || ds.id::text, 'user',
        '💳 طلب السائق ' || public._actor_label(ds.driver_email) ||
        ' اشتراكاً (' || COALESCE(ds.status, 'pending') || ')',
        ds.created_at, ds.driver_email
      FROM public.driver_subscriptions ds
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'subscription_requested' AND target_id = ds.id::text)

      UNION ALL

      SELECT 'derived:city:' || cs.id::text, 'user',
        '🗺️ اقترح ' || public._actor_label(cs.suggested_by_email) ||
        ' إضافة مدينة (' || cs.name || ')',
        cs.created_at, cs.suggested_by_email
      FROM public.city_suggestions cs
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'city_suggested' AND target_id = cs.id::text)

      UNION ALL

      SELECT 'derived:signup:' || p.id::text, 'user',
        '👤 انضم ' || public._actor_label(p.email) || ' للمنصة',
        p.created_at, p.email
      FROM public.profiles p
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'onboarding_completed' AND target_id = p.id::text)
    ) all_events
    WHERE (filter_type = 'all' OR all_events.type = filter_type)
      AND (
        v_email_q IS NULL
        OR all_events.actor_email ILIKE '%' || v_email_q || '%'
        OR (
          (v_email_q ~ '^M-?\d+$' OR v_email_q ~ '^\d+$')
          AND all_events.actor_email = (
            SELECT email FROM public.profiles
             WHERE account_number = (regexp_replace(v_email_q, '\D', '', 'g'))::BIGINT
             LIMIT 1
          )
        )
      )
  ) counted;

  -- Paginated page of rows aggregated as JSONB. Same UNION as above.
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      jsonb_build_object(
        'id',           event_id,
        'type',         type,
        'text',         text,
        'created_at',   created_at,
        'actor_email',  actor_email
      ) AS row_obj,
      created_at
    FROM (
      SELECT
        'audit:' || a.id::text                                    AS event_id,
        public._map_audit_to_activity_type(a.target_type)         AS type,
        public._compose_audit_text(a.action, a.target_type, a.details, a.admin_email) AS text,
        a.created_at                                              AS created_at,
        public._audit_primary_actor(a.action, a.details, a.admin_email) AS actor_email
      FROM public.admin_audit_log a
      UNION ALL
      SELECT 'derived:trip_created:' || t.id::text, 'trip',
        '🚗 نشر السائق ' || public._actor_label(t.driver_email) ||
        ' رحلة جديدة (' || t.from_city || ' → ' || t.to_city || ')',
        t.created_at, t.driver_email
      FROM public.trips t
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'trip_created' AND target_id = t.id::text)
      UNION ALL
      SELECT 'derived:trip_cancelled:' || t.id::text, 'trip',
        '❌ ألغى السائق ' || public._actor_label(t.driver_email) ||
        ' رحلته (' || t.from_city || ' → ' || t.to_city || ')',
        t.updated_at, t.driver_email
      FROM public.trips t
      WHERE t.status = 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('driver_cancel_trip', 'admin_delete_trip',
                                         'driver_delete_trip', 'delete_trip')
                          AND target_id = t.id::text)
      UNION ALL
      SELECT 'derived:trip_completed:' || t.id::text, 'trip',
        '✅ أنهى السائق ' || public._actor_label(t.driver_email) ||
        ' الرحلة (' || t.from_city || ' → ' || t.to_city || ')',
        t.updated_at, t.driver_email
      FROM public.trips t
      WHERE t.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'driver_complete_trip' AND target_id = t.id::text)
      UNION ALL
      SELECT 'derived:trip_started:' || t.id::text, 'trip',
        '🚦 بدأ السائق ' || public._actor_label(t.driver_email) ||
        ' الرحلة (' || t.from_city || ' → ' || t.to_city || ')',
        t.updated_at, t.driver_email
      FROM public.trips t
      WHERE t.status = 'in_progress'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'driver_start_trip' AND target_id = t.id::text)
      UNION ALL
      SELECT 'derived:booking_created:' || b.id::text, 'booking',
        '🎟️ حجز الراكب ' || public._actor_label(b.passenger_email) || ' مقعداً' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
        b.created_at, b.passenger_email
      FROM public.bookings b
      LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'booking_created' AND target_id = b.id::text)
      UNION ALL
      SELECT 'derived:booking_cancelled:' || b.id::text, 'booking',
        '↩️ ألغى ' || public._actor_label(b.passenger_email) || ' حجزه' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
        COALESCE(b.updated_at, b.created_at), b.passenger_email
      FROM public.bookings b
      LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
      WHERE b.status = 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('booking_cancelled_by_passenger',
                                         'driver_cancel_confirmed_booking',
                                         'driver_reject_booking')
                          AND target_id = b.id::text)
      UNION ALL
      SELECT 'derived:booking_confirmed:' || b.id::text, 'booking',
        '✓ وافق السائق ' || public._actor_label(t.driver_email) ||
        ' على حجز الراكب ' || public._actor_label(b.passenger_email) ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
        COALESCE(b.updated_at, b.created_at), t.driver_email
      FROM public.bookings b
      LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
      WHERE b.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('booking_confirmed', 'driver_confirm_booking')
                          AND target_id = b.id::text)
      UNION ALL
      SELECT 'derived:review:' || r.id::text, 'review',
        CASE r.review_type
          WHEN 'driver_rates_passenger' THEN '⭐ قيّم السائق ' || public._actor_label(r.reviewer_email) || ' راكباً'
          ELSE '⭐ قيّم الراكب ' || public._actor_label(r.reviewer_email) || ' السائق'
        END || ' (' || r.rating::text || '/5)',
        r.created_at, r.reviewer_email
      FROM public.reviews r
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('driver_review_submitted', 'passenger_review_submitted')
                          AND target_id = r.trip_id::text)
      UNION ALL
      SELECT 'derived:report:' || ur.id::text, 'report',
        '🚨 أبلغ ' || public._actor_label(ur.reporter_email) || ' عن مستخدم آخر',
        ur.created_at, ur.reporter_email
      FROM public.user_reports ur
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action IN ('report_filed', 'report')
                          AND target_id = ur.id::text)
      UNION ALL
      SELECT 'derived:feedback:' || st.id::text, 'feedback',
        '💬 أرسل ' || public._actor_label(st.user_email) || ' ' ||
          CASE st.type
            WHEN 'complaint'  THEN 'شكوى'
            WHEN 'suggestion' THEN 'اقتراح'
            WHEN 'praise'     THEN 'إشادة'
            ELSE COALESCE(st.type, 'ملاحظة')
          END,
        st.created_at, st.user_email
      FROM public.support_tickets st
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'feedback_submitted' AND target_id = st.id::text)
      UNION ALL
      -- Changed: trip_request now has its own type.
      SELECT 'derived:trip_request:' || tr.id::text, 'trip_request',
        '🙋 نشر الراكب ' || public._actor_label(tr.passenger_email) ||
        ' طلب رحلة (' || tr.from_city || ' → ' || tr.to_city || ')',
        tr.created_at, tr.passenger_email
      FROM public.trip_requests tr
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'trip_request_created' AND target_id = tr.id::text)
      UNION ALL
      SELECT 'derived:subscription:' || ds.id::text, 'user',
        '💳 طلب السائق ' || public._actor_label(ds.driver_email) ||
        ' اشتراكاً (' || COALESCE(ds.status, 'pending') || ')',
        ds.created_at, ds.driver_email
      FROM public.driver_subscriptions ds
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'subscription_requested' AND target_id = ds.id::text)
      UNION ALL
      SELECT 'derived:city:' || cs.id::text, 'user',
        '🗺️ اقترح ' || public._actor_label(cs.suggested_by_email) ||
        ' إضافة مدينة (' || cs.name || ')',
        cs.created_at, cs.suggested_by_email
      FROM public.city_suggestions cs
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'city_suggested' AND target_id = cs.id::text)
      UNION ALL
      SELECT 'derived:signup:' || p.id::text, 'user',
        '👤 انضم ' || public._actor_label(p.email) || ' للمنصة',
        p.created_at, p.email
      FROM public.profiles p
      WHERE NOT EXISTS (SELECT 1 FROM public.admin_audit_log
                        WHERE action = 'onboarding_completed' AND target_id = p.id::text)
    ) all_events
    WHERE (filter_type = 'all' OR all_events.type = filter_type)
      AND (
        v_email_q IS NULL
        OR all_events.actor_email ILIKE '%' || v_email_q || '%'
        OR (
          (v_email_q ~ '^M-?\d+$' OR v_email_q ~ '^\d+$')
          AND all_events.actor_email = (
            SELECT email FROM public.profiles
             WHERE account_number = (regexp_replace(v_email_q, '\D', '', 'g'))::BIGINT
             LIMIT 1
          )
        )
      )
    ORDER BY created_at DESC
    OFFSET v_offset
    LIMIT page_size_param
  ) paged;

  RETURN jsonb_build_object(
    'rows',       COALESCE(v_rows, '[]'::jsonb),
    'total',      COALESCE(v_total, 0),
    'totalPages', CEIL(GREATEST(COALESCE(v_total, 0), 1)::numeric / GREATEST(page_size_param, 1))::INTEGER
  );
END;
$function$;
