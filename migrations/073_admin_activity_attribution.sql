-- ════════════════════════════════════════════════════════════════════════
-- Migration 073 — Admin attribution in activity log + password-reset events
-- ════════════════════════════════════════════════════════════════════════
--
-- Two related fixes for the /dashboard activity log page:
--
-- 1. ADMIN ATTRIBUTION
--    Migration 050 added v_actor_label to admin-action sentences, e.g.
--    'حدّثت الإدارة (M-1) بيانات مستخدم'. But _actor_label() returned
--    the M-#### account number for admins, which is meaningless to a
--    human reading the log — you'd have to look up M-1 in the users
--    table to know which admin. The fix: when the profile.role='admin',
--    _actor_label returns full_name (or email fallback), NEVER the
--    account number. End-user actors keep the M-#### priority since
--    that's the user-facing identifier.
--
-- 2. PASSWORD RESET REQUESTS
--    Supabase Auth's resetPasswordForEmail() flow happens entirely
--    inside the GoTrue server and writes nothing to our app schema.
--    The activity log was therefore blind to password resets — admins
--    couldn't tell who'd asked for one or whether a flood of requests
--    suggested a credential-stuffing attempt.
--
--    Fix: a new RPC public.log_password_reset_request(p_email) writes
--    a row to admin_audit_log with action='password_reset_requested'.
--    Login.jsx calls it from the frontend immediately after
--    supabase.auth.resetPasswordForEmail succeeds.
--
--    Rate limit: 5 inserts per email per hour. Beyond that the function
--    silently no-ops (returns without inserting). This prevents a
--    spammer from filling the audit log by repeatedly hitting the
--    'forgot password' endpoint — the Supabase Auth layer has its own
--    rate limit on the actual email send, and our audit doesn't need
--    to be more granular than that.
--
--    The RPC is callable by anon and authenticated since password
--    reset happens before the user is logged in. Insert path is
--    SECURITY DEFINER so it bypasses RLS on admin_audit_log (which
--    normally blocks non-admin writes).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Update _actor_label to handle admins specially ─────────────────
CREATE OR REPLACE FUNCTION public._actor_label(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_account_number BIGINT;
  v_name           TEXT;
  v_role           TEXT;
BEGIN
  IF p_email IS NULL THEN
    RETURN 'مستخدم';
  END IF;

  SELECT account_number, full_name, role
    INTO v_account_number, v_name, v_role
    FROM public.profiles
   WHERE email = p_email
   LIMIT 1;

  -- ADMINS: a log entry like 'حذفت الإدارة (M-1) رحلة' tells the
  -- reader nothing about WHICH admin did this. Names are the useful
  -- piece for admin actors. Priority: full_name → email. Never
  -- account_number, because every admin would otherwise look like
  -- 'M-1' / 'M-2' which still requires a lookup to interpret.
  IF v_role = 'admin' THEN
    IF v_name IS NOT NULL AND length(trim(v_name)) > 0 THEN
      RETURN trim(v_name);
    END IF;
    RETURN p_email;
  END IF;

  -- Non-admins: existing priority — account_number is the user-facing
  -- ID surfaced everywhere (booking cards, trip detail page, support
  -- tickets), so it's what an admin would expect to see in the log.
  IF v_account_number IS NOT NULL THEN
    RETURN 'M-' || v_account_number::text;
  END IF;

  IF v_name IS NOT NULL AND length(trim(v_name)) > 0 THEN
    RETURN trim(v_name);
  END IF;

  RETURN p_email;
END;
$$;


-- ─── 2. Extend _compose_audit_text with password_reset_requested ────────
-- Rather than rewriting the whole function (large + risky), we use a
-- thin wrapper: the existing function handles all current cases, and
-- we patch the new case via a per-action insert before the WHEN clauses.
-- Since the existing function is CREATE OR REPLACE and we don't want
-- to copy 90 lines just to add one WHEN, we instead extend by adding
-- the new action code to the WHEN list.
--
-- The existing _compose_audit_text in migration 050 lines 203-267 has
-- ELSE clause `p_action || ' (' || v_actor_label || ')'`. For the
-- password_reset_requested action this would produce:
--   "password_reset_requested (user@example.com)"
-- which is functional but ugly. We add a real WHEN clause for a
-- friendly Arabic message.
--
-- Strategy: re-issue the full _compose_audit_text via CREATE OR REPLACE
-- with the new WHEN added. The body is identical to mig 050 except for
-- the inserted line in the CASE block.

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

    -- ── Authentication actions (NEW in migration 073) ────────────
    -- Password reset request is logged client-side after Supabase Auth's
    -- resetPasswordForEmail() resolves. v_actor_label resolves to the
    -- email that requested the reset (passed as p_admin_email since the
    -- request happens pre-auth, with no admin context). We surface it
    -- as the M-#### or name of the target user when possible — so an
    -- admin scanning the log sees 'M-456 requested a password reset'
    -- rather than the raw email.
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

    -- ── City suggestions ─────────────────────────────────────────
    WHEN 'city_suggested'           THEN '🗺️ اقترح ' || v_actor_label || ' إضافة مدينة' || CASE WHEN (p_details->>'city_name') IS NOT NULL THEN ' (' || (p_details->>'city_name') || ')' ELSE '' END
    WHEN 'city_suggestion_approved' THEN '✓ وافقت الإدارة (' || v_actor_label || ') على اقتراح مدينة'
    WHEN 'city_suggestion_rejected' THEN '✗ رفضت الإدارة (' || v_actor_label || ') اقتراح مدينة'

    -- ── Reports / feedback ───────────────────────────────────────
    WHEN 'report_filed'         THEN '🚨 أبلغ ' || v_actor_label || ' عن مستخدم آخر'
    WHEN 'feedback_submitted'   THEN '💬 أرسل ' || v_actor_label || ' ' || v_ticket_type
    WHEN 'admin_mark_payment'   THEN '💰 سجّلت الإدارة (' || v_actor_label || ') دفعة'

    -- ── Fallback ─────────────────────────────────────────────────
    ELSE p_action || ' (' || v_actor_label || ')'
  END;
END;
$$;


-- ─── 3. RPC: log password reset request ────────────────────────────────
--
-- Called by frontend after supabase.auth.resetPasswordForEmail() succeeds.
-- Records the event in admin_audit_log so admins can see who's requested
-- resets in the dashboard activity log + audit trail.
--
-- WHY SECURITY DEFINER:
--   - Password reset is a pre-auth flow (the user isn't logged in)
--   - The caller's role is therefore 'anon'
--   - admin_audit_log RLS denies INSERT for everyone except SECURITY
--     DEFINER paths (it's an admin-only table by design)
--   - Without SECURITY DEFINER, INSERT silently fails / errors
--
-- WHY RATE LIMITED:
--   - This RPC is callable by anon, which is unusual
--   - Without a limit, a script could spam the log table with millions
--     of fake password-reset rows
--   - 5 per email per hour matches typical Supabase Auth rate limits
--     and gives admins enough signal to detect credential-stuffing
--     (a flood of distinct emails)
--   - When limit is hit, function returns silently (no exception) so
--     the frontend UX isn't disrupted by audit-logging concerns
--
-- WHY NO TARGET_ID:
--   - The user hasn't necessarily got a profile (password reset works
--     even for emails not in profiles, Supabase Auth still sends a
--     "if this account exists..." email)
--   - target_id is the *user's* id; we don't know it client-side and
--     server-side lookup would couple this to profiles which is fragile
CREATE OR REPLACE FUNCTION public.log_password_reset_request(
  p_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_recent_count INTEGER;
  v_normalized   TEXT;
BEGIN
  -- Defensive normalization — lowercase + trim. Matches what Supabase
  -- Auth does internally; ensures rate-limit counts the same email
  -- across casing variations.
  v_normalized := lower(trim(p_email));

  -- Skip if email is obviously bogus. This is just a safety net —
  -- Supabase Auth's resetPasswordForEmail also rejects these.
  IF v_normalized IS NULL OR v_normalized = '' OR position('@' in v_normalized) = 0 THEN
    RETURN;
  END IF;

  -- Rate limit: 5 inserts per email per hour
  SELECT COUNT(*) INTO v_recent_count
    FROM public.admin_audit_log
   WHERE action = 'password_reset_requested'
     AND admin_email = v_normalized
     AND created_at > NOW() - INTERVAL '1 hour';

  IF v_recent_count >= 5 THEN
    -- Silent no-op. Don't expose rate-limit info to the caller because
    -- (a) the caller is anon, and (b) we don't want to leak whether
    -- an email has been used for resets recently — that would help
    -- account-enumeration attacks.
    RETURN;
  END IF;

  INSERT INTO public.admin_audit_log (
    admin_email, action, target_type, target_id, details
  ) VALUES (
    v_normalized,             -- placed in admin_email column because
                              -- that's the actor field; it's not actually
                              -- an admin, just the requester. _actor_label
                              -- will render it nicely via the M-#### or
                              -- name lookup. Future schema cleanup could
                              -- add an 'actor_email' column to better
                              -- reflect this.
    'password_reset_requested',
    'user',
    NULL,                     -- target_id intentionally NULL — see docstring
    jsonb_build_object(
      'email',        v_normalized,
      'requested_at', NOW()::TEXT
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_password_reset_request(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_password_reset_request(TEXT) TO anon, authenticated;

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_actor_fn  BOOLEAN;
  v_compose_fn BOOLEAN;
  v_logger_fn  BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='_actor_label')   INTO v_actor_fn;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='_compose_audit_text') INTO v_compose_fn;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='log_password_reset_request') INTO v_logger_fn;

  IF NOT v_actor_fn   THEN RAISE EXCEPTION 'MIGRATION 073 FAILED — _actor_label missing'; END IF;
  IF NOT v_compose_fn THEN RAISE EXCEPTION 'MIGRATION 073 FAILED — _compose_audit_text missing'; END IF;
  IF NOT v_logger_fn  THEN RAISE EXCEPTION 'MIGRATION 073 FAILED — log_password_reset_request missing'; END IF;

  RAISE NOTICE 'MIGRATION 073 OK — admin attribution + password-reset logging in place';
END;
$$;
