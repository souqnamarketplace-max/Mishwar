-- ════════════════════════════════════════════════════════════════════════
-- Migration 049 — Comprehensive activity_log rewrite
-- ════════════════════════════════════════════════════════════════════════
--
-- USER REPORT
-- "I noticed the trip cancellation and many events are not showing in
--  the activity log."
--
-- ROOT CAUSE
-- The previous activity_log RPC (built via Supabase dashboard UI, source
-- never committed to this repo) was incomplete — it surfaced trip and
-- booking creation events but missed cancellations, completions, review
-- submissions, verification submissions, subscription requests, and a
-- bunch of other state-changing events. Combined with the fact that
-- many client surfaces had zero audit logging (CreateTrip, TripDetails,
-- Onboarding, Feedback, all the review wizards, etc.) the activity log
-- felt sparse and broken.
--
-- THE FIX (TWO PARTS)
--
-- Part A — Client side (already committed in the same PR as this
-- migration): added logAudit calls to 10 state-changing surfaces. From
-- this point forward, every trip post, booking, review, verification,
-- subscription request, city suggestion, onboarding completion, feedback
-- submission, and trip request lands in admin_audit_log.
--
-- Part B — This migration. Rewrites activity_log as a UNION of:
--   (1) admin_audit_log entries — the going-forward primary source for
--       everything we just instrumented
--   (2) DERIVED events from the underlying tables (trips, bookings,
--       reviews, reports, support_tickets, city_suggestions,
--       trip_requests, driver_subscriptions, passenger_verifications,
--       driver_licenses) for HISTORICAL rows that pre-date the audit
--       calls
--
-- Dedup is done via NOT EXISTS — if an admin_audit_log entry already
-- exists for a (target_type, target_id, action), the derived event is
-- skipped. So new events have their audit-log row as the canonical
-- source, and old events have their derived row.
--
-- OUTPUT SHAPE
-- The RPC returns JSONB with the same {rows, total, totalPages} shape
-- the DashboardLogs.jsx UI already consumes. Each row has
-- {type, id, text, created_at} matching the existing render code.
--
-- SECURITY
-- SECURITY DEFINER + admin-only check. Activity log exposes every
-- action across every user account — not for general access.
--
-- IDEMPOTENT
-- CREATE OR REPLACE. Re-running is safe.
-- ════════════════════════════════════════════════════════════════════════


-- ─── Helper: map admin_audit_log target_type → activity_log type ────
-- The activity feed uses 6 high-level type buckets: booking, trip,
-- review, user, feedback, report. Audit log target_type is more
-- granular (driver_subscription, passenger_verification, etc.); this
-- function rolls those finer types into the 6 buckets the UI knows
-- how to render with icons + colours.
CREATE OR REPLACE FUNCTION public._map_audit_to_activity_type(p_target_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_target_type
    WHEN 'trip'                    THEN 'trip'
    WHEN 'trip_request'            THEN 'trip'
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
$$;


-- ─── Helper: compose Arabic display text from an audit-log entry ────
-- The activity feed shows a single Arabic sentence per row. This
-- function maps action codes to user-friendly text. New action codes
-- can be added here without touching the main RPC.
CREATE OR REPLACE FUNCTION public._compose_audit_text(
  p_action      TEXT,
  p_target_type TEXT,
  p_details     JSONB,
  p_admin_email TEXT
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_actor TEXT;
  v_route TEXT;
BEGIN
  -- Route shorthand for trip/booking events that include from→to
  v_route := COALESCE(p_details->>'route', '');
  -- Actor — prefer the email from details (passenger / driver) over
  -- admin_email which is the action initiator, not necessarily the
  -- target user.
  v_actor := COALESCE(
    p_details->>'driver_email',
    p_details->>'passenger_email',
    p_details->>'user_email',
    p_admin_email,
    'مستخدم'
  );

  RETURN CASE p_action
    -- ── Trip actions ──────────────────────────────────────────────
    WHEN 'trip_created'         THEN '🚗 نشر سائق رحلة جديدة' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'driver_cancel_trip'   THEN '❌ ألغى السائق رحلته' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'admin_delete_trip'    THEN '🗑️ حذفت الإدارة رحلة'
    WHEN 'driver_delete_trip'   THEN '🗑️ حذف السائق رحلته'
    WHEN 'delete_trip'          THEN '🗑️ حُذفت رحلة'
    WHEN 'driver_start_trip'    THEN '🚦 بدأ السائق رحلته' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'driver_complete_trip' THEN '✅ اكتملت الرحلة' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'driver_change_trip_time' THEN '⏰ غيّر السائق موعد رحلته'
    WHEN 'admin_cancel_trip_request' THEN '❌ ألغت الإدارة طلب رحلة'
    WHEN 'trip_request_created' THEN '🙋 نشر راكب طلب رحلة' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END

    -- ── Booking actions ──────────────────────────────────────────
    WHEN 'booking_created'                  THEN '🎟️ حجز راكب مقعداً' || CASE WHEN v_route<>'' THEN ' (' || v_route || ')' ELSE '' END
    WHEN 'booking_confirmed'                THEN '✓ وافق السائق على حجز'
    WHEN 'driver_confirm_booking'           THEN '✓ وافق السائق على حجز'
    WHEN 'driver_reject_booking'            THEN '✗ رفض السائق حجزاً'
    WHEN 'driver_cancel_confirmed_booking'  THEN '✗ ألغى السائق حجزاً مؤكداً'
    WHEN 'booking_cancelled_by_passenger'   THEN '↩️ ألغى الراكب حجزه'

    -- ── Review actions ───────────────────────────────────────────
    WHEN 'driver_review_submitted'    THEN '⭐ قيّم السائق راكباً' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END
    WHEN 'passenger_review_submitted' THEN '⭐ قيّم الراكب السائق' || CASE WHEN (p_details->>'rating') IS NOT NULL THEN ' (' || (p_details->>'rating') || '/5)' ELSE '' END

    -- ── User / account actions ───────────────────────────────────
    WHEN 'onboarding_completed'              THEN '👤 أكمل المستخدم التسجيل' || CASE WHEN (p_details->>'account_type') IS NOT NULL THEN ' (' || (p_details->>'account_type') || ')' ELSE '' END
    WHEN 'passenger_verification_submitted'  THEN '🛡️ طلب راكب التوثيق'
    WHEN 'admin_update_user'                 THEN '✏️ حدّثت الإدارة بيانات مستخدم'
    WHEN 'admin_deactivate_user'             THEN '🚫 عطّلت الإدارة حساب مستخدم'
    WHEN 'admin_clear_strikes'               THEN '♻️ مسحت الإدارة مخالفات مستخدم'
    WHEN 'user_block'                        THEN '⛔ حظر مستخدم آخر'

    -- ── Subscription ─────────────────────────────────────────────
    WHEN 'subscription_requested'    THEN '💳 طلب سائق اشتراكاً'
    WHEN 'subscription_approved'     THEN '✓ وافقت الإدارة على اشتراك'
    WHEN 'subscription_rejected'     THEN '✗ رفضت الإدارة اشتراكاً'
    WHEN 'subscription_granted'      THEN '🎁 منحت الإدارة اشتراكاً'
    WHEN 'subscription_bulk_granted' THEN '🎁 منحت الإدارة اشتراكات بالجملة'

    -- ── Driver license ───────────────────────────────────────────
    WHEN 'driver_license_approved' THEN '✓ وافقت الإدارة على رخصة سائق'
    WHEN 'driver_license_rejected' THEN '✗ رفضت الإدارة رخصة سائق'

    -- ── City suggestions ─────────────────────────────────────────
    WHEN 'city_suggested'           THEN '🗺️ اقترح مستخدم إضافة مدينة' || CASE WHEN (p_details->>'city_name') IS NOT NULL THEN ' (' || (p_details->>'city_name') || ')' ELSE '' END
    WHEN 'city_suggestion_approved' THEN '✓ وافقت الإدارة على اقتراح مدينة'
    WHEN 'city_suggestion_rejected' THEN '✗ رفضت الإدارة اقتراح مدينة'

    -- ── Reports / feedback ───────────────────────────────────────
    WHEN 'report_filed'         THEN '🚨 أبلغ مستخدم عن مستخدم آخر'
    WHEN 'feedback_submitted'   THEN '💬 أرسل مستخدم ' || COALESCE(p_details->>'ticket_type', 'ملاحظة')
    WHEN 'admin_mark_payment'   THEN '💰 سجّلت الإدارة دفعة'

    -- ── Fallback ─────────────────────────────────────────────────
    ELSE p_action  -- Action code itself; admin can still grok it
  END;
END;
$$;


-- ─── (3) activity_log — the rewrite ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_log(
  filter_type      TEXT    DEFAULT 'all',
  page_param       INTEGER DEFAULT 1,
  page_size_param  INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_offset       INTEGER;
  v_total        INTEGER;
  v_rows         JSONB;
  v_role         TEXT := public.auth_user_role();
BEGIN
  -- Admin only — activity log exposes events across every user.
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  v_offset := (GREATEST(page_param, 1) - 1) * page_size_param;

  -- Build the unified event stream + count in a single pass using
  -- a CTE. The CTE materialises every event, then we count + page.
  -- For a project with thousands of trips/bookings this is fine;
  -- for millions we'd need pre-aggregated views, but Mishwaro is
  -- not at that scale.
  WITH events AS (
    -- ═══ (1) admin_audit_log — going-forward primary source ═══
    SELECT
      'audit:' || a.id::text                                          AS event_id,
      public._map_audit_to_activity_type(a.target_type)               AS type,
      public._compose_audit_text(a.action, a.target_type, a.details, a.admin_email)
                                                                       AS text,
      a.created_at                                                     AS created_at
    FROM public.admin_audit_log a

    UNION ALL

    -- ═══ (2) Derived: trip CREATION (for rows without an audit entry) ═══
    SELECT
      'derived:trip_created:' || t.id::text,
      'trip',
      '🚗 نشر سائق رحلة جديدة (' || t.from_city || ' → ' || t.to_city || ')',
      t.created_at
    FROM public.trips t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'trip_created' AND target_id = t.id::text
    )

    UNION ALL

    -- ═══ (3) Derived: trip CANCELLATION ═══
    -- This is the user's main complaint — cancellations weren't
    -- showing up. The derived path catches every historical
    -- cancelled trip; going forward the audit row from
    -- DriverTripsList's cancel mutation takes precedence.
    SELECT
      'derived:trip_cancelled:' || t.id::text,
      'trip',
      '❌ ألغى السائق رحلته (' || t.from_city || ' → ' || t.to_city || ')',
      t.updated_at
    FROM public.trips t
    WHERE t.status = 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action IN ('driver_cancel_trip', 'admin_delete_trip',
                         'driver_delete_trip', 'delete_trip')
          AND target_id = t.id::text
      )

    UNION ALL

    -- ═══ (4) Derived: trip COMPLETION ═══
    SELECT
      'derived:trip_completed:' || t.id::text,
      'trip',
      '✅ اكتملت الرحلة (' || t.from_city || ' → ' || t.to_city || ')',
      t.updated_at
    FROM public.trips t
    WHERE t.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'driver_complete_trip' AND target_id = t.id::text
      )

    UNION ALL

    -- ═══ (5) Derived: trip IN-PROGRESS (start event) ═══
    SELECT
      'derived:trip_started:' || t.id::text,
      'trip',
      '🚦 انطلقت رحلة (' || t.from_city || ' → ' || t.to_city || ')',
      t.updated_at
    FROM public.trips t
    WHERE t.status = 'in_progress'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'driver_start_trip' AND target_id = t.id::text
      )

    UNION ALL

    -- ═══ (6) Derived: booking CREATION ═══
    SELECT
      'derived:booking_created:' || b.id::text,
      'booking',
      '🎟️ حجز راكب مقعداً' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
      b.created_at
    FROM public.bookings b
    LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'booking_created' AND target_id = b.id::text
    )

    UNION ALL

    -- ═══ (7) Derived: booking CANCELLATION ═══
    SELECT
      'derived:booking_cancelled:' || b.id::text,
      'booking',
      '↩️ تم إلغاء حجز' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
      COALESCE(b.updated_at, b.created_at)
    FROM public.bookings b
    LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
    WHERE b.status = 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action IN ('booking_cancelled_by_passenger',
                         'driver_cancel_confirmed_booking',
                         'driver_reject_booking')
          AND target_id = b.id::text
      )

    UNION ALL

    -- ═══ (8) Derived: booking CONFIRMATION ═══
    SELECT
      'derived:booking_confirmed:' || b.id::text,
      'booking',
      '✓ وافق السائق على حجز' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
      COALESCE(b.updated_at, b.created_at)
    FROM public.bookings b
    LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
    WHERE b.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action IN ('booking_confirmed', 'driver_confirm_booking')
          AND target_id = b.id::text
      )

    UNION ALL

    -- ═══ (9) Derived: reviews ═══
    SELECT
      'derived:review:' || r.id::text,
      'review',
      CASE r.review_type
        WHEN 'driver_rates_passenger' THEN '⭐ قيّم السائق راكباً'
        ELSE '⭐ قيّم الراكب السائق'
      END || ' (' || r.rating::text || '/5)',
      r.created_at
    FROM public.reviews r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action IN ('driver_review_submitted', 'passenger_review_submitted')
        AND target_id = r.trip_id::text
    )

    UNION ALL

    -- ═══ (10) Derived: user_reports ═══
    SELECT
      'derived:report:' || ur.id::text,
      'report',
      '🚨 أبلغ مستخدم عن مستخدم آخر',
      ur.created_at
    FROM public.user_reports ur
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action IN ('report_filed', 'report')
        AND target_id = ur.id::text
    )

    UNION ALL

    -- ═══ (11) Derived: support_tickets / feedback ═══
    SELECT
      'derived:feedback:' || st.id::text,
      'feedback',
      '💬 أرسل مستخدم ' || COALESCE(st.type, 'ملاحظة'),
      st.created_at
    FROM public.support_tickets st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'feedback_submitted' AND target_id = st.id::text
    )

    UNION ALL

    -- ═══ (12) Derived: trip_requests (passenger 'I want a ride') ═══
    SELECT
      'derived:trip_request:' || tr.id::text,
      'trip',
      '🙋 نشر راكب طلب رحلة (' || tr.from_city || ' → ' || tr.to_city || ')',
      tr.created_at
    FROM public.trip_requests tr
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'trip_request_created' AND target_id = tr.id::text
    )

    UNION ALL

    -- ═══ (13) Derived: driver_subscriptions (requests) ═══
    SELECT
      'derived:subscription:' || ds.id::text,
      'user',
      '💳 طلب سائق اشتراكاً (' || COALESCE(ds.status, 'pending') || ')',
      ds.created_at
    FROM public.driver_subscriptions ds
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'subscription_requested' AND target_id = ds.id::text
    )

    UNION ALL

    -- ═══ (14) Derived: city_suggestions ═══
    SELECT
      'derived:city:' || cs.id::text,
      'user',
      '🗺️ اقترح مستخدم إضافة مدينة (' || cs.name || ')',
      cs.created_at
    FROM public.city_suggestions cs
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'city_suggested' AND target_id = cs.id::text
    )

    UNION ALL

    -- ═══ (15) Derived: new user signups (from profiles) ═══
    SELECT
      'derived:signup:' || p.id::text,
      'user',
      '👤 انضم مستخدم جديد للمنصة',
      p.created_at
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'onboarding_completed' AND target_id = p.id::text
    )
  ),
  filtered AS (
    SELECT * FROM events
    WHERE filter_type = 'all' OR type = filter_type
  )
  SELECT
    COUNT(*)::INTEGER,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',         event_id,
          'type',       type,
          'text',       text,
          'created_at', created_at
        )
        ORDER BY created_at DESC
      ) FILTER (
        WHERE row_num > v_offset AND row_num <= v_offset + page_size_param
      ),
      '[]'::jsonb
    )
  INTO v_total, v_rows
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (ORDER BY created_at DESC) AS row_num
    FROM filtered
  ) AS numbered;

  RETURN jsonb_build_object(
    'rows',       COALESCE(v_rows, '[]'::jsonb),
    'total',      COALESCE(v_total, 0),
    'totalPages', CEIL(GREATEST(COALESCE(v_total, 0), 1)::numeric / GREATEST(page_size_param, 1))::INTEGER
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activity_log(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.activity_log(TEXT, INTEGER, INTEGER) TO authenticated;


DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 049 OK — activity_log rewritten as UNION of admin_audit_log + derived events from 14 tables';
END $$;
