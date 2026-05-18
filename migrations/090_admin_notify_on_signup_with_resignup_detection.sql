-- ════════════════════════════════════════════════════════════════════════
-- 090_admin_notify_on_signup_with_resignup_detection.sql
-- ════════════════════════════════════════════════════════════════════════
--
-- Two related improvements to deletion+signup observability:
--
--   1. Notify admin on every new user signup. The current flow has no
--      signal — admin only finds out about new users by browsing the
--      Users tab or noticing activity in trips/bookings.
--
--   2. Detect re-registrations: when someone signs up with an email
--      that previously belonged to a deleted account, flag the
--      notification with "🔄 إعادة تسجيل" and write an audit log
--      entry. Admin can then decide whether the re-signup is
--      legitimate (user changed their mind) or suspicious (fraud /
--      ban evasion).
--
-- ─── ARCHITECTURE DECISION: trigger, not frontend call ──────────────
--
-- The frontend signup path (Login.jsx → register → supabase.auth.signUp)
-- doesn't yet have a confirmed session at the moment register() returns
-- — Supabase requires email confirmation before issuing a real JWT.
-- A frontend-issued notifyAdmin() call right after register() would
-- fail the create_notification RLS policy because the caller isn't
-- authenticated.
--
-- Workarounds (login the user briefly, then logout) leak credentials
-- into the email-confirm flow. The clean answer is a Postgres trigger
-- that fires AFTER the auth.users row exists and uses SECURITY DEFINER
-- to bypass RLS. That way:
--   - The notification ALWAYS fires (no client-side failure modes)
--   - No race conditions with confirmation flow
--   - Single source of truth on the DB layer
--
-- ─── DESIGN ─────────────────────────────────────────────────────────
--
-- Trigger fires on auth.users INSERT, AFTER the existing handle_new_user
-- trigger (which creates the profiles row). The new trigger:
--   (a) Searches admin_audit_log for prior 'account_self_deleted' or
--       'account_self_delete_initiated' entries with details->>'email'
--       matching the new signup's email.
--   (b) If found → write an 'account_resigned_after_deletion' audit
--       log entry (admin-visible historical record).
--   (c) Insert a notification for the admin email with appropriate
--       title:
--         - Fresh signup:  "🎉 مستخدم جديد"
--         - Re-registered: "🔄 إعادة تسجيل بعد حذف سابق"
--
-- ─── EDGE CASES HANDLED ─────────────────────────────────────────────
--
-- 1. Notification table doesn't exist yet (legacy DB) → SKIP gracefully
-- 2. admin_audit_log doesn't exist → SKIP re-registration check, just
--    notify as fresh signup
-- 3. Notification insert fails → SWALLOW. The trigger MUST NOT block
--    user signup. Notification is a UX nicety, not a correctness gate.
-- 4. Email confirmation pending → notification fires NOW (admin sees
--    signup intent immediately; useful for fraud detection). We can
--    add a separate "confirmed" notification later if needed.

BEGIN;

-- ─── 1. Helper RPC: check whether an email was previously deleted ─────
--
-- Returns TRUE if there's at least one 'account_self_deleted' audit
-- entry with this email. Used both by the trigger AND optionally by
-- the frontend (e.g. signup form could warn "this email was previously
-- registered — re-creating account").
--
-- SECURITY DEFINER + admin-only. Email is sensitive — we don't want
-- to leak "this email was previously deleted" to attackers probing
-- for valid emails. Only admin role can call.

CREATE OR REPLACE FUNCTION public.check_email_was_deleted(
  p_email TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_role TEXT := public.auth_user_role();
BEGIN
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN FALSE;  -- non-admins always get FALSE (no enumeration leak)
  END IF;

  IF p_email IS NULL OR TRIM(p_email) = '' THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.admin_audit_log
     WHERE action IN ('account_self_deleted', 'account_self_delete_initiated')
       AND LOWER(details->>'email') = LOWER(TRIM(p_email))
  );
END $$;

REVOKE ALL ON FUNCTION public.check_email_was_deleted(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_email_was_deleted(TEXT) TO authenticated;

-- ─── 2. Trigger function: notify admin on new signup ─────────────────

CREATE OR REPLACE FUNCTION public.notify_admin_on_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_admin_email     TEXT := 'souqnamarketplace@gmail.com';
  v_full_name       TEXT;
  v_was_deleted     BOOLEAN := FALSE;
  v_prior_count     INT;
  v_title           TEXT;
  v_message         TEXT;
BEGIN
  -- Pull the display name. handle_new_user already resolved this for
  -- the profile row; we read it back out for the notification body.
  -- raw_user_meta_data is the canonical source on auth.users.
  v_full_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    'مستخدم جديد'
  );

  -- ─── Detect re-registration ───────────────────────────────────────
  -- Search audit log for ANY prior deletion attempt with this email.
  -- Both 'account_self_deleted' and 'account_self_delete_initiated'
  -- count — the initiated event proves the user expressed intent,
  -- even if the deletion mechanically didn't complete.
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
    ) THEN
      SELECT COUNT(*) INTO v_prior_count
        FROM public.admin_audit_log
       WHERE action IN ('account_self_deleted', 'account_self_delete_initiated')
         AND LOWER(details->>'email') = LOWER(NEW.email);
      v_was_deleted := COALESCE(v_prior_count, 0) > 0;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Defensive: never fail the signup over a missing column or
    -- table-not-exists. The user must be able to sign up even if
    -- our observability tooling has issues.
    v_was_deleted := FALSE;
  END;

  -- ─── Write a re-registration audit entry ──────────────────────────
  -- Only when re-registration is detected. This creates a discoverable
  -- record in the audit log for admin's later review. Wrapped in its
  -- own BEGIN block so any error here doesn't break the notification.
  IF v_was_deleted THEN
    BEGIN
      INSERT INTO public.admin_audit_log (
        admin_email, action, target_type, target_id, details
      ) VALUES (
        v_admin_email,                    -- "who did this" — system on
                                          -- behalf of admin, since the
                                          -- new user isn't authenticated
                                          -- yet at trigger time
        'account_resigned_after_deletion',
        'user',
        NEW.id::text,
        jsonb_build_object(
          'email',         NEW.email,
          'full_name',     v_full_name,
          'prior_events',  v_prior_count,
          'signup_at',     NEW.created_at
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Best effort. Notification still fires below.
      NULL;
    END;
  END IF;

  -- ─── Compose admin notification ──────────────────────────────────
  IF v_was_deleted THEN
    v_title   := '🔄 إعادة تسجيل بعد حذف سابق';
    v_message := v_full_name || ' أعاد تسجيل حسابه (' || NEW.email || ') بعد حذفه سابقاً. راجع السجل لمعرفة السبب.';
  ELSE
    v_title   := '🎉 مستخدم جديد';
    v_message := v_full_name || ' (' || NEW.email || ') سجّل في مشوارو. بانتظار تأكيد البريد.';
  END IF;

  -- ─── Insert the notification ─────────────────────────────────────
  -- Direct INSERT (not create_notification RPC) because this trigger
  -- runs BEFORE the new user has a session — create_notification's
  -- auth.email() check would fail. SECURITY DEFINER on the trigger
  -- function bypasses RLS on notifications.
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'notifications'
    ) THEN
      INSERT INTO public.notifications (
        user_email, title, message, type, link, is_read, created_at
      ) VALUES (
        v_admin_email,
        v_title,
        v_message,
        'system',
        CASE WHEN v_was_deleted
             THEN '/dashboard?tab=deletions'
             ELSE '/dashboard?tab=users'
        END,
        FALSE,
        NOW()
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- If notifications table schema differs (missing column, RLS
    -- quirk, anything else), just swallow. The signup itself MUST
    -- succeed; the bell notification is a UX enhancement.
    NULL;
  END;

  RETURN NEW;
END $$;

-- ─── 3. Install the trigger on auth.users INSERT ─────────────────────
--
-- AFTER INSERT, FOR EACH ROW. Fires after handle_new_user (which is
-- BEFORE INSERT in mig 058) so the profiles row exists by the time
-- our notification logic runs. Not strictly necessary — our function
-- doesn't read profiles — but a safer ordering for any future logic
-- that might want to.

DROP TRIGGER IF EXISTS trg_notify_admin_on_new_user ON auth.users;
CREATE TRIGGER trg_notify_admin_on_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_on_new_user();

-- ─── 4. Extend admin_deletion_stats with resignup count ─────────────
--
-- The dashboard would benefit from knowing: "of the deletions we have,
-- how many were followed by a re-registration?". This adds a new key
-- 'resigned_count' to the stats response.

CREATE OR REPLACE FUNCTION public.admin_deletion_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_role TEXT := public.auth_user_role();
  v_result      jsonb;
BEGIN
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'admin_only');
  END IF;

  WITH unified_deletions AS (
    -- (A) Soft-deleted profile rows
    SELECT p.deleted_at,
           NULLIF(TRIM(p.deletion_reason), '')  AS deletion_reason,
           p.account_type
      FROM public.profiles p
     WHERE p.deleted_at IS NOT NULL

    UNION ALL

    -- (B) Audit-log orphans
    SELECT al.created_at      AS deleted_at,
           NULL::text          AS deletion_reason,
           NULL::text          AS account_type
      FROM (
        SELECT DISTINCT ON (target_id)
               id, created_at, target_id
          FROM public.admin_audit_log
         WHERE action = 'account_self_deleted'
           AND target_id IS NOT NULL
         ORDER BY target_id, created_at ASC
      ) al
     WHERE NOT EXISTS (
       SELECT 1 FROM public.profiles p2
        WHERE p2.id::text = al.target_id
          AND p2.deleted_at IS NOT NULL
     )
  )
  SELECT jsonb_build_object(
    'total_deleted', (SELECT COUNT(*) FROM unified_deletions),
    'deleted_today', (
      SELECT COUNT(*) FROM unified_deletions
       WHERE deleted_at >= date_trunc('day', NOW())
    ),
    'deleted_this_week', (
      SELECT COUNT(*) FROM unified_deletions
       WHERE deleted_at >= date_trunc('week', NOW())
    ),
    'deleted_this_month', (
      SELECT COUNT(*) FROM unified_deletions
       WHERE deleted_at >= date_trunc('month', NOW())
    ),
    'resigned_count', (
      -- New in mig 090: count of 'account_resigned_after_deletion'
      -- audit entries — i.e. people who deleted then signed up again.
      SELECT COUNT(*)
        FROM public.admin_audit_log
       WHERE action = 'account_resigned_after_deletion'
    ),
    'by_reason', (
      SELECT COALESCE(jsonb_object_agg(reason_label, cnt), '{}'::jsonb)
        FROM (
          SELECT COALESCE(deletion_reason, 'لم يُحدَّد') AS reason_label,
                 COUNT(*) AS cnt
            FROM unified_deletions
           GROUP BY reason_label
           ORDER BY cnt DESC
           LIMIT 20
        ) r
    ),
    'by_account_type', (
      SELECT COALESCE(jsonb_object_agg(t, cnt), '{}'::jsonb)
        FROM (
          SELECT COALESCE(account_type, 'unknown') AS t,
                 COUNT(*) AS cnt
            FROM unified_deletions
           GROUP BY account_type
        ) a
    ),
    'daily_last_30', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day_str, 'count', cnt) ORDER BY day_str), '[]'::jsonb)
        FROM (
          SELECT to_char(date_trunc('day', deleted_at), 'YYYY-MM-DD') AS day_str,
                 COUNT(*) AS cnt
            FROM unified_deletions
           WHERE deleted_at >= NOW() - INTERVAL '30 days'
           GROUP BY day_str
        ) d
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_deletion_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deletion_stats() TO authenticated;

COMMIT;

-- ─── VERIFICATION QUERIES ─────────────────────────────────────────────
--
--   -- After applying, test the notification trigger:
--   -- Sign up a test user (e.g. test-mig090@example.com) via the app.
--   -- Then check:
--   SELECT * FROM public.notifications
--    WHERE user_email = 'souqnamarketplace@gmail.com'
--      AND title LIKE '%مستخدم جديد%'
--    ORDER BY created_at DESC
--    LIMIT 5;
--   -- Expect 1+ row.
--
--   -- Test re-registration detection. If you've already deleted
--   -- engallam27@gmail.com previously, and they re-signed up,
--   -- check the audit log:
--   SELECT created_at, details
--     FROM public.admin_audit_log
--    WHERE action = 'account_resigned_after_deletion'
--    ORDER BY created_at DESC;
--   -- New re-registrations will appear here going forward.
--
--   -- Test the dashboard stats includes the new field:
--   SELECT (public.admin_deletion_stats())->'resigned_count';
--   -- Expect a number (0 if no re-registrations have happened YET
--   -- since the trigger only fires on FUTURE signups).
--
-- ─── ABOUT THE EXISTING engallam27 CASE ───────────────────────────────
--
-- This trigger fires on FUTURE signups only. The fact that
-- engallam27@gmail.com already deleted + re-signed up before this
-- migration was applied means there's no 'account_resigned_after_deletion'
-- entry for them. To backfill that one historical case (optional but
-- nice for completeness), run:
--
--   INSERT INTO public.admin_audit_log (
--     admin_email, action, target_type, target_id, details
--   )
--   SELECT
--     'souqnamarketplace@gmail.com',
--     'account_resigned_after_deletion',
--     'user',
--     au.id::text,
--     jsonb_build_object(
--       'email',        au.email,
--       'full_name',    COALESCE(au.raw_user_meta_data->>'full_name', ''),
--       'prior_events', (
--         SELECT COUNT(*) FROM public.admin_audit_log
--          WHERE action IN ('account_self_deleted', 'account_self_delete_initiated')
--            AND LOWER(details->>'email') = LOWER(au.email)
--       ),
--       'signup_at',    au.created_at,
--       'backfilled',   TRUE
--     )
--     FROM auth.users au
--    WHERE au.email = 'engallam27@gmail.com'
--      AND au.deleted_at IS NULL
--      AND EXISTS (
--        SELECT 1 FROM public.admin_audit_log
--         WHERE action IN ('account_self_deleted', 'account_self_delete_initiated')
--           AND LOWER(details->>'email') = 'engallam27@gmail.com'
--      );
--
-- Run that ONLY if you want the historical case visible in
-- the dashboard's re-registration count. Optional.
