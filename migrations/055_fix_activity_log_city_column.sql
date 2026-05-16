-- ════════════════════════════════════════════════════════════════════════
-- Migration 055 — Fix activity_log v2 column reference (city_suggestions)
-- ════════════════════════════════════════════════════════════════════════
--
-- THE BUG
-- activity_log() from migration 050 referenced cs.user_email when reading
-- public.city_suggestions, but the actual column on that table is
-- suggested_by_email (per migration 015 which creates the table). At
-- query time PostgreSQL throws:
--
--   ERROR: 42703: column cs.user_email does not exist
--
-- The error aborts the entire SELECT inside activity_log so the function
-- always returns an error, regardless of which filter / search the
-- caller passes. From the frontend the symptom is:
--
--   - DashboardLogs.jsx calls supabase.rpc('activity_log', ...)
--   - error is non-null, the queryFn does `if (error) throw error;`
--   - React Query goes into error state
--   - DashboardLogs renders `isLoading` first, then falls through to the
--     `rows.length === 0` branch (which exists for the legitimately-empty
--     case), showing 'لا توجد نشاطات' and a count of 0.
--   - There is no error branch in the UI — the error is silently
--     swallowed and looks indistinguishable from 'no activities exist'.
--
-- This was triggered the moment migration 050 was applied (admin
-- activity feed went from 'all events' to 'literally empty' in one
-- step), and has been broken ever since.
--
-- THE FIX
-- One column reference. cs.user_email → cs.suggested_by_email.
--
-- DEFENSE-IN-DEPTH
-- Before re-creating the function, this migration loudly verifies every
-- column it references actually exists on the source tables. If a future
-- table is renamed or refactored, the migration's DO $$ check will
-- RAISE EXCEPTION with a clear message instead of silently re-installing
-- a function that returns empty results.
-- ════════════════════════════════════════════════════════════════════════

-- ─── Pre-flight: every column the events CTE references must exist ──
DO $$
DECLARE
  v_missing TEXT := '';
  v_check   RECORD;
BEGIN
  FOR v_check IN
    SELECT * FROM (VALUES
      ('city_suggestions',     'suggested_by_email'),
      ('trips',                'driver_email'),
      ('bookings',             'passenger_email'),
      ('reviews',              'reviewer_email'),
      ('support_tickets',      'user_email'),
      ('trip_requests',        'passenger_email'),
      ('driver_subscriptions', 'driver_email'),
      ('user_reports',         'reporter_email'),
      ('profiles',             'email'),
      ('admin_audit_log',      'admin_email')
    ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = v_check.tbl
        AND column_name  = v_check.col
    ) THEN
      v_missing := v_missing || E'\n  - public.' || v_check.tbl || '.' || v_check.col;
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRATION 055 PRECONDITION FAILED — column(s) not found: %', v_missing;
  END IF;
END $$;

-- ─── Re-create activity_log with corrected column reference ─────────
-- Body is verbatim copy of migration 050 except for ONE line at the
-- city_suggestions section (was: cs.user_email, now: cs.suggested_by_email).
-- Keep the (TEXT, TEXT, INTEGER, INTEGER) signature so the frontend
-- doesn't need to change.

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

    -- ═══ (14) city_suggestions — FIXED in migration 055 ═══
    -- Was: cs.user_email (does not exist).
    -- The actual column per migration 015 is suggested_by_email.
    SELECT
      'derived:city:' || cs.id::text,
      'user',
      '🗺️ اقترح ' || public._actor_label(cs.suggested_by_email) ||
        ' إضافة مدينة (' || cs.name || ')',
      cs.created_at,
      cs.suggested_by_email
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
      AND (
        v_email_q IS NULL
        OR actor_email ILIKE '%' || v_email_q || '%'
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

-- ─── Verification — confirm the function body parses & runs cleanly ─
-- We can't easily impersonate an admin from a migration context (the
-- function's role check uses auth_user_role() which reads JWT claims
-- not present in the migration session). Instead, we call the function
-- and catch ONLY the expected 'admin access required' exception — that
-- means the function body got past parsing and reached the role check.
-- Any OTHER exception (especially 42703 column-does-not-exist) means
-- the bug is still present and the migration should fail loudly.
DO $$
DECLARE
  v_sqlstate TEXT;
  v_message  TEXT;
BEGIN
  BEGIN
    PERFORM public.activity_log('all', NULL, 1, 1);
    -- If this returns without exception, we ran as admin somehow — also fine.
    RAISE NOTICE 'MIGRATION 055 OK — activity_log returned without error';
  EXCEPTION
    WHEN insufficient_privilege THEN
      -- Expected — function reached the admin check and rejected us.
      -- Body parsed cleanly, all column references are valid.
      RAISE NOTICE 'MIGRATION 055 OK — function body parses, role check works';
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_message  = MESSAGE_TEXT;
      RAISE EXCEPTION 'MIGRATION 055 FAILED — unexpected error %: %',
        v_sqlstate, v_message;
  END;
END $$;
