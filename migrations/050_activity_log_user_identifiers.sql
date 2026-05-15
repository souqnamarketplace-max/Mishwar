-- ════════════════════════════════════════════════════════════════════════
-- Migration 050 — activity_log v2: user identifiers + search by user
-- ════════════════════════════════════════════════════════════════════════
--
-- USER REPORT
-- 'I would suggest using the user ID instead of generic words like driver,
--  passenger, etc. — it won't help admin track complaints. The activity log
--  is to help identify issues for complaints. You might add search by user.'
--
-- WHAT CHANGES
--
-- 1. EVERY activity row now includes the actor's identifier inline. Format:
--      preferred:  M-1234   (account_number, the 4-digit user ID)
--      fallback:   profile.full_name
--      last resort: the email
--    So 'حجز راكب مقعداً' becomes 'حجز M-1234 مقعداً'. Admin investigating
--    a complaint can now follow a thread of activity by a specific user
--    instead of seeing anonymous events.
--
-- 2. NEW activity_log() signature adds a `search_email` parameter. The
--    dashboard's existing email-search box (currently audit-only) now
--    works for the activity view too. Filters every row by the row's
--    actor_email — matches partial substrings (ILIKE %x%).
--
-- 3. Missing action codes added to _compose_audit_text:
--      - account_self_delete_initiated → 'بدأ حذف حسابه'
--      - account_self_deleted          → 'حذف حسابه'
--      - admin_activate_user           → 'فعّلت الإدارة حساب مستخدم'
--      - admin_update_booking_status   → 'حدّثت الإدارة حالة حجز'
--      - passenger_verification_approved/_rejected/_revoked
--      - admin_update_user, admin_clear_strikes (already present, kept)
--    Plus translations for feedback ticket_type so 'complaint' renders as
--    'شكوى', 'suggestion' as 'اقتراح', 'praise' as 'إشادة'.
--
-- 4. The events CTE gains an `actor_email` column used for the
--    search_email filter. Each event type knows where to find the
--    primary actor:
--      - trips           → driver_email
--      - bookings        → passenger_email (or driver if status flipped by driver)
--      - reviews         → reviewer_email
--      - support_tickets → user_email
--      - city_suggestions/trip_requests/etc → user_email/passenger_email
--      - audit log rows  → details->>'driver_email' || details->>'passenger_email'
--                          || details->>'user_email' || admin_email
--
-- IDEMPOTENT
-- CREATE OR REPLACE. Re-running is safe.
-- ════════════════════════════════════════════════════════════════════════


-- ─── Helper: resolve an actor email to a display label ──────────────
-- Priority:
--   1. 'M-' + account_number (the 4-digit user ID — short and trackable)
--   2. full_name (when account_number is missing on legacy rows)
--   3. The email itself (last-ditch fallback)
--   4. Hard-coded 'مستخدم' if everything is NULL
--
-- STABLE not IMMUTABLE — reads from a table. Function is hot inside the
-- main CTE so we lean on the planner's query-level caching.
CREATE OR REPLACE FUNCTION public._actor_label(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_account_number BIGINT;
  v_name           TEXT;
BEGIN
  IF p_email IS NULL THEN
    RETURN 'مستخدم';
  END IF;

  SELECT account_number, full_name
    INTO v_account_number, v_name
    FROM public.profiles
   WHERE email = p_email
   LIMIT 1;

  -- Priority 1: account_number (the M-#### ID)
  IF v_account_number IS NOT NULL THEN
    RETURN 'M-' || v_account_number::text;
  END IF;

  -- Priority 2: full_name (trimmed, only if non-blank)
  IF v_name IS NOT NULL AND length(trim(v_name)) > 0 THEN
    RETURN trim(v_name);
  END IF;

  -- Priority 3: email
  RETURN p_email;
END;
$$;


-- ─── Helper: map admin_audit_log target_type → activity_log type ────
-- (Same as migration 049 — kept here for completeness so migration 050
-- can be applied without 049 if needed.)
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


-- ─── Helper: pick the primary actor email for an audit-log row ──────
-- For each action, the 'primary actor' is the user the admin would
-- want to click through to. e.g. for 'trip_created' that's the driver;
-- for 'booking_created' that's the passenger; for admin actions it's
-- the admin themselves (admin_email column).
CREATE OR REPLACE FUNCTION public._audit_primary_actor(
  p_action      TEXT,
  p_details     JSONB,
  p_admin_email TEXT
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  -- Driver-initiated actions: driver_email in details is the actor
  IF p_action IN (
    'trip_created', 'driver_cancel_trip', 'driver_delete_trip',
    'driver_start_trip', 'driver_complete_trip', 'driver_change_trip_time',
    'driver_confirm_booking', 'driver_reject_booking',
    'driver_cancel_confirmed_booking', 'driver_review_submitted',
    'subscription_requested'
  ) THEN
    RETURN COALESCE(p_details->>'driver_email', p_admin_email);
  END IF;

  -- Passenger-initiated actions
  IF p_action IN (
    'booking_created', 'booking_cancelled_by_passenger',
    'passenger_review_submitted', 'trip_request_created',
    'passenger_verification_submitted'
  ) THEN
    RETURN COALESCE(p_details->>'passenger_email', p_admin_email);
  END IF;

  -- User-generic actions
  IF p_action IN (
    'onboarding_completed', 'feedback_submitted', 'city_suggested',
    'account_self_delete_initiated', 'account_self_deleted',
    'user_block', 'report_filed'
  ) THEN
    RETURN COALESCE(
      p_details->>'user_email',
      p_details->>'reporter_email',
      p_admin_email
    );
  END IF;

  -- Admin actions — the admin IS the actor
  RETURN COALESCE(p_admin_email, p_details->>'user_email');
END;
$$;


-- ─── Helper: compose Arabic display text with user identifier ───────
-- Critical change vs migration 049: every text now embeds the actor
-- label so admins can scan the feed and identify specific users.
CREATE OR REPLACE FUNCTION public._compose_audit_text(
  p_action      TEXT,
  p_target_type TEXT,
  p_details     JSONB,
  p_admin_email TEXT
)
RETURNS TEXT
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_actor_email TEXT;
  v_actor_label TEXT;
  v_route       TEXT := COALESCE(p_details->>'route', '');
  v_ticket_type TEXT;
BEGIN
  v_actor_email := public._audit_primary_actor(p_action, p_details, p_admin_email);
  v_actor_label := public._actor_label(v_actor_email);

  -- Translate ticket_type codes if present
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

    -- ── Subscription ─────────────────────────────────────────────
    WHEN 'subscription_requested'    THEN '💳 طلب السائق ' || v_actor_label || ' اشتراكاً'
    WHEN 'subscription_approved'     THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اشتراك'
    WHEN 'subscription_rejected'     THEN '✗ رفضت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_granted'      THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكاً'
    WHEN 'subscription_bulk_granted' THEN '🎁 منحت الإدارة (' || v_actor_label || ') اشتراكات بالجملة'

    -- ── Driver license ───────────────────────────────────────────
    WHEN 'driver_license_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على رخصة سائق'
    WHEN 'driver_license_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') رخصة سائق'

    -- ── City suggestions ─────────────────────────────────────────
    WHEN 'city_suggested'           THEN '🗺️ اقترح ' || v_actor_label || ' إضافة مدينة' || CASE WHEN (p_details->>'city_name') IS NOT NULL THEN ' (' || (p_details->>'city_name') || ')' ELSE '' END
    WHEN 'city_suggestion_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اقتراح مدينة'
    WHEN 'city_suggestion_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') اقتراح مدينة'

    -- ── Reports / feedback ───────────────────────────────────────
    WHEN 'report_filed'         THEN '🚨 أبلغ ' || v_actor_label || ' عن مستخدم آخر'
    WHEN 'feedback_submitted'   THEN '💬 أرسل ' || v_actor_label || ' ' || v_ticket_type
    WHEN 'admin_mark_payment'   THEN '💰 سجّلت الإدارة (' || v_actor_label || ') دفعة'

    -- ── Fallback — show action with the actor label so admins still
    -- have something to grep on
    ELSE p_action || ' (' || v_actor_label || ')'
  END;
END;
$$;


-- ─── (Main) activity_log v2 ──────────────────────────────────────────
-- Note: drops the v1 (3-arg) signature and adds the new 4-arg version
-- with search_email.
DROP FUNCTION IF EXISTS public.activity_log(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.activity_log(
  filter_type      TEXT    DEFAULT 'all',
  search_email     TEXT    DEFAULT NULL,
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
  -- Normalize search_email — empty string == NULL == no filter.
  v_email_q := NULLIF(trim(COALESCE(search_email, '')), '');

  WITH events AS (
    -- ═══ (1) admin_audit_log entries ═══
    SELECT
      'audit:' || a.id::text                                    AS event_id,
      public._map_audit_to_activity_type(a.target_type)         AS type,
      public._compose_audit_text(a.action, a.target_type, a.details, a.admin_email) AS text,
      a.created_at                                              AS created_at,
      public._audit_primary_actor(a.action, a.details, a.admin_email) AS actor_email
    FROM public.admin_audit_log a

    UNION ALL

    -- ═══ (2) trips — creation ═══
    SELECT
      'derived:trip_created:' || t.id::text,
      'trip',
      '🚗 نشر السائق ' || public._actor_label(t.driver_email) ||
        ' رحلة جديدة (' || t.from_city || ' → ' || t.to_city || ')',
      t.created_at,
      t.driver_email
    FROM public.trips t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'trip_created' AND target_id = t.id::text
    )

    UNION ALL

    -- ═══ (3) trips — cancellations ═══
    SELECT
      'derived:trip_cancelled:' || t.id::text,
      'trip',
      '❌ ألغى السائق ' || public._actor_label(t.driver_email) ||
        ' رحلته (' || t.from_city || ' → ' || t.to_city || ')',
      t.updated_at,
      t.driver_email
    FROM public.trips t
    WHERE t.status = 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action IN ('driver_cancel_trip', 'admin_delete_trip',
                         'driver_delete_trip', 'delete_trip')
          AND target_id = t.id::text
      )

    UNION ALL

    -- ═══ (4) trips — completions ═══
    SELECT
      'derived:trip_completed:' || t.id::text,
      'trip',
      '✅ أنهى السائق ' || public._actor_label(t.driver_email) ||
        ' الرحلة (' || t.from_city || ' → ' || t.to_city || ')',
      t.updated_at,
      t.driver_email
    FROM public.trips t
    WHERE t.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'driver_complete_trip' AND target_id = t.id::text
      )

    UNION ALL

    -- ═══ (5) trips — in-progress (started) ═══
    SELECT
      'derived:trip_started:' || t.id::text,
      'trip',
      '🚦 بدأ السائق ' || public._actor_label(t.driver_email) ||
        ' الرحلة (' || t.from_city || ' → ' || t.to_city || ')',
      t.updated_at,
      t.driver_email
    FROM public.trips t
    WHERE t.status = 'in_progress'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action = 'driver_start_trip' AND target_id = t.id::text
      )

    UNION ALL

    -- ═══ (6) bookings — created ═══
    SELECT
      'derived:booking_created:' || b.id::text,
      'booking',
      '🎟️ حجز الراكب ' || public._actor_label(b.passenger_email) || ' مقعداً' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
      b.created_at,
      b.passenger_email
    FROM public.bookings b
    LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'booking_created' AND target_id = b.id::text
    )

    UNION ALL

    -- ═══ (7) bookings — cancelled ═══
    SELECT
      'derived:booking_cancelled:' || b.id::text,
      'booking',
      '↩️ ألغى ' || public._actor_label(b.passenger_email) || ' حجزه' ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
      COALESCE(b.updated_at, b.created_at),
      b.passenger_email
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

    -- ═══ (8) bookings — confirmed ═══
    SELECT
      'derived:booking_confirmed:' || b.id::text,
      'booking',
      '✓ وافق السائق ' || public._actor_label(t.driver_email) ||
        ' على حجز الراكب ' || public._actor_label(b.passenger_email) ||
        COALESCE(' (' || t.from_city || ' → ' || t.to_city || ')', ''),
      COALESCE(b.updated_at, b.created_at),
      t.driver_email
    FROM public.bookings b
    LEFT JOIN public.trips t ON t.id::text = b.trip_id::text
    WHERE b.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE action IN ('booking_confirmed', 'driver_confirm_booking')
          AND target_id = b.id::text
      )

    UNION ALL

    -- ═══ (9) reviews ═══
    SELECT
      'derived:review:' || r.id::text,
      'review',
      CASE r.review_type
        WHEN 'driver_rates_passenger' THEN '⭐ قيّم السائق ' || public._actor_label(r.reviewer_email) || ' راكباً'
        ELSE '⭐ قيّم الراكب ' || public._actor_label(r.reviewer_email) || ' السائق'
      END || ' (' || r.rating::text || '/5)',
      r.created_at,
      r.reviewer_email
    FROM public.reviews r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action IN ('driver_review_submitted', 'passenger_review_submitted')
        AND target_id = r.trip_id::text
    )

    UNION ALL

    -- ═══ (10) user_reports ═══
    SELECT
      'derived:report:' || ur.id::text,
      'report',
      '🚨 أبلغ ' || public._actor_label(ur.reporter_email) || ' عن مستخدم آخر',
      ur.created_at,
      ur.reporter_email
    FROM public.user_reports ur
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action IN ('report_filed', 'report')
        AND target_id = ur.id::text
    )

    UNION ALL

    -- ═══ (11) support_tickets ═══
    SELECT
      'derived:feedback:' || st.id::text,
      'feedback',
      '💬 أرسل ' || public._actor_label(st.user_email) || ' ' ||
        CASE st.type
          WHEN 'complaint'  THEN 'شكوى'
          WHEN 'suggestion' THEN 'اقتراح'
          WHEN 'praise'     THEN 'إشادة'
          ELSE COALESCE(st.type, 'ملاحظة')
        END,
      st.created_at,
      st.user_email
    FROM public.support_tickets st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'feedback_submitted' AND target_id = st.id::text
    )

    UNION ALL

    -- ═══ (12) trip_requests ═══
    SELECT
      'derived:trip_request:' || tr.id::text,
      'trip',
      '🙋 نشر الراكب ' || public._actor_label(tr.passenger_email) ||
        ' طلب رحلة (' || tr.from_city || ' → ' || tr.to_city || ')',
      tr.created_at,
      tr.passenger_email
    FROM public.trip_requests tr
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'trip_request_created' AND target_id = tr.id::text
    )

    UNION ALL

    -- ═══ (13) driver_subscriptions ═══
    SELECT
      'derived:subscription:' || ds.id::text,
      'user',
      '💳 طلب السائق ' || public._actor_label(ds.driver_email) ||
        ' اشتراكاً (' || COALESCE(ds.status, 'pending') || ')',
      ds.created_at,
      ds.driver_email
    FROM public.driver_subscriptions ds
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'subscription_requested' AND target_id = ds.id::text
    )

    UNION ALL

    -- ═══ (14) city_suggestions ═══
    SELECT
      'derived:city:' || cs.id::text,
      'user',
      '🗺️ اقترح ' || public._actor_label(cs.user_email) ||
        ' إضافة مدينة (' || cs.name || ')',
      cs.created_at,
      cs.user_email
    FROM public.city_suggestions cs
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'city_suggested' AND target_id = cs.id::text
    )

    UNION ALL

    -- ═══ (15) profiles — new signups ═══
    SELECT
      'derived:signup:' || p.id::text,
      'user',
      '👤 انضم ' || public._actor_label(p.email) || ' للمنصة',
      p.created_at,
      p.email
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log
      WHERE action = 'onboarding_completed' AND target_id = p.id::text
    )
  ),
  filtered AS (
    SELECT * FROM events
    WHERE (filter_type = 'all' OR type = filter_type)
      -- search_email match: exact substring on the actor email (ILIKE
      -- so partial matches like 'M-1234' won't work BUT 'gmail.com'
      -- or 'ahmed' will). For UID search we look up by account_number
      -- separately below.
      AND (
        v_email_q IS NULL
        OR actor_email ILIKE '%' || v_email_q || '%'
        -- If query starts with 'M-' or is all digits, resolve to email
        -- via profiles.account_number and match exactly.
        OR (
          (v_email_q ~ '^M-?\d+$' OR v_email_q ~ '^\d+$')
          AND actor_email = (
            SELECT email FROM public.profiles
             WHERE account_number = (regexp_replace(v_email_q, '\D', '', 'g'))::BIGINT
             LIMIT 1
          )
        )
      )
  )
  SELECT
    COUNT(*)::INTEGER,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',           event_id,
          'type',         type,
          'text',         text,
          'created_at',   created_at,
          'actor_email',  actor_email
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

REVOKE EXECUTE ON FUNCTION public.activity_log(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.activity_log(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;


DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 050 OK — activity_log now includes user identifiers + search_email parameter';
END $$;
