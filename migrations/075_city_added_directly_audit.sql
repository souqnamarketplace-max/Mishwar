-- ════════════════════════════════════════════════════════════════════════
-- Migration 075 — Activity log entry for direct city additions
-- ════════════════════════════════════════════════════════════════════════
--
-- /dashboard cities now has an "+ إضافة مدينة جديدة" button that admins
-- can use to seed cities without waiting for a user suggestion. The
-- frontend audit-logs this with action='city_added_directly'.
--
-- Without an explicit WHEN clause in _compose_audit_text, that action
-- would fall through to the ELSE branch and render as:
--   "city_added_directly (Admin Name)"
-- — functional but ugly. This migration adds a proper Arabic sentence:
--   "🗺️ أضافت الإدارة (Admin Name) مدينة جديدة (Ramallah)"
--
-- The function body is otherwise identical to mig 073. CREATE OR REPLACE
-- re-issues the whole function with one new WHEN line inserted alphabetically
-- next to the existing city_* WHENs.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

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
    -- ── Trip actions ──────────────────────────────────────────────
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

    -- ── Booking actions ──────────────────────────────────────────
    WHEN 'booking_created'                  THEN '🎟️ حجز الراكب ' || v_actor_label || ' مقعداً' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'booking_confirmed'                THEN '✓ وافق السائق ' || v_actor_label || ' على حجز'
    WHEN 'driver_confirm_booking'           THEN '✓ وافق السائق ' || v_actor_label || ' على حجز'
    WHEN 'driver_reject_booking'            THEN '✗ رفض السائق ' || v_actor_label || ' حجزاً'
    WHEN 'driver_cancel_confirmed_booking'  THEN '✗ ألغى السائق ' || v_actor_label || ' حجزاً مؤكداً'
    WHEN 'booking_cancelled_by_passenger'   THEN '↩️ ألغى الراكب ' || v_actor_label || ' حجزه'

    -- ── Review actions ───────────────────────────────────────────
    WHEN 'driver_review_submitted'    THEN '⭐ قيّم السائق ' || v_actor_label || ' راكباً' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END
    WHEN 'passenger_review_submitted' THEN '⭐ قيّم الراكب ' || v_actor_label || ' السائق' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END

    -- ── User / account actions ───────────────────────────────────
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

    -- ── Authentication actions ────────────────────────────────────
    WHEN 'password_reset_requested'          THEN '🔑 طلب ' || v_actor_label || ' إعادة تعيين كلمة المرور'

    -- ── Subscription ─────────────────────────────────────────────
    WHEN 'subscription_requested'    THEN '💳 طلب السائق ' || v_actor_label || ' اشتراكاً'
    WHEN 'subscription_approved'     THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اشتراك'
    WHEN 'subscription_rejected'     THEN '✗ رفضت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_granted'      THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_bulk_granted' THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكات بالجملة'

    -- ── Driver license ───────────────────────────────────────────
    WHEN 'driver_license_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على رخصة سائق'
    WHEN 'driver_license_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') رخصة سائق'

    -- ── City suggestions / management ─────────────────────────────
    WHEN 'city_suggested'           THEN '🗺️ اقترح ' || v_actor_label || ' إضافة مدينة' || CASE WHEN (p_details->>'city_name') IS NOT NULL THEN ' (' || (p_details->>'city_name') || ')' ELSE '' END
    WHEN 'city_suggestion_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اقتراح مدينة'
    WHEN 'city_suggestion_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') اقتراح مدينة'
    -- NEW in mig 075: direct add by admin (no user suggestion).
    -- Details JSONB has canonical_name + lat + lng + governorate.
    -- We surface canonical_name in parens for the most useful audit
    -- context — admins reading the log want to know WHICH city was
    -- added, not just that one was.
    WHEN 'city_added_directly'      THEN '🗺️ أضافت الإدارة (' || v_actor_label || ') مدينة جديدة' || CASE WHEN (p_details->>'canonical_name') IS NOT NULL THEN ' (' || (p_details->>'canonical_name') || ')' ELSE '' END

    -- ── Reports / feedback ───────────────────────────────────────
    WHEN 'report_filed'         THEN '🚨 أبلغ ' || v_actor_label || ' عن مستخدم آخر'
    WHEN 'feedback_submitted'   THEN '💬 أرسل ' || v_actor_label || ' ' || v_ticket_type
    WHEN 'admin_mark_payment'   THEN '💰 سجّلت الإدارة (' || v_actor_label || ') دفعة'

    -- ── Fallback ─────────────────────────────────────────────────
    ELSE p_action || ' (' || v_actor_label || ')'
  END;
END;
$$;

COMMIT;

DO $$
DECLARE
  v_test_output TEXT;
BEGIN
  -- Smoke test the new WHEN clause produces a friendly sentence
  v_test_output := public._compose_audit_text(
    'city_added_directly',
    'admin_city',
    jsonb_build_object('canonical_name', 'رام الله'),
    'admin@mishwar.ps'
  );

  IF v_test_output NOT LIKE '%أضافت الإدارة%رام الله%' THEN
    RAISE EXCEPTION 'MIGRATION 075 FAILED — _compose_audit_text did not produce expected output for city_added_directly. Got: %', v_test_output;
  END IF;

  RAISE NOTICE 'MIGRATION 075 OK — city_added_directly action renders as: %', v_test_output;
END;
$$;
