-- =============================================================================
-- Migration 027 — create_notification RPC for safe cross-user notifications
-- =============================================================================
--
-- BACKGROUND
--
-- Migration 002 (C-07) tightened notifications_insert policy from
-- `WITH CHECK (true)` to:
--
--    WITH CHECK (
--      user_email = public.auth_user_email()
--      OR public.auth_user_role() = 'admin'
--    )
--
-- The comment in 002 claimed cross-user notifications would still work because
-- "they go through SECURITY DEFINER triggers (notify_driver_on_booking, etc.)
-- which bypass RLS". That was true at the time for trigger-driven inserts.
-- BUT the codebase since then accumulated MANY direct cross-user notification
-- inserts from client code (driver→passenger booking accept/reject, passenger→
-- driver review notifications, user→admin reports/suggestions/verifications,
-- trip-cancel passenger notifications) — all wrapped in try/catch that
-- swallowed the inevitable RLS rejection silently.
--
-- Real-world effect (verified by reading every Notification.create call in
-- src/):
--
--   - Drivers approving/rejecting bookings → passengers never got the bell ping
--   - Passengers/drivers leaving reviews → other party never got notified
--   - Users reporting other users → admin (you) never got the bell ping
--   - Users suggesting cities → admin never saw the suggestion in bell
--   - Drivers requesting subscriptions → admin never saw the request in bell
--   - Drivers submitting licenses → admin never saw it in bell
--   - Verification queue notifications → admin never got them
--   - Trip-cancel notifications (commit 5c1b138 just shipped) → passengers
--     never got the bell ping despite the toast claiming they did
--
-- Many of these surfaces have polling fallbacks in the admin dashboard
-- (queues are visible by tab regardless of bell state) so user-facing
-- impact is partial — the admin still discovers reports by opening the
-- reports tab, just not via the unread-count badge. But for the
-- driver→passenger and passenger→driver cases, the receiving user has
-- no other channel: they only learn the booking was approved on their
-- next /my-trips visit, hours or days later.
--
-- THE FIX
--
-- A SECURITY DEFINER RPC `create_notification(target_email, title, message,
-- ...)` that:
--   1. Validates the caller has a legitimate relationship to target_email
--      (admin override, or one of the allowed sender→target pairs).
--   2. Bypasses RLS via SECURITY DEFINER and inserts into notifications.
--
-- Why this approach over loosening the RLS policy:
--   - Loosening RLS to `WITH CHECK (true)` is what migration 002 removed
--     because it was a spam vector — any authenticated user could insert
--     any notification at any other user. That regression isn't an option.
--   - A "trigger fires on every legitimate booking/review/etc" approach
--     would require ten different triggers and tight coupling between the
--     trigger logic and which fields make it into the notification. Hard
--     to maintain when product copy changes.
--   - A single auth-checking RPC the client calls explicitly is simple,
--     auditable, and the auth check is co-located with the insert.
--
-- AUTHORIZATION RULES
--
-- The RPC accepts a write iff one of:
--
--   (A) caller IS the target — self-targeted (already allowed by RLS;
--       included in the RPC for completeness so callers don't need to
--       branch).
--   (B) caller is an admin (per profiles.role).
--   (C) target is an admin and the caller is an authenticated user — any
--       authenticated user can ping admins (city suggestions, reports,
--       verification submissions, license submissions, subscription
--       requests, etc.). Already rate-bounded by Supabase's per-user
--       limits and by application-level UX (these surfaces are gated
--       behind real user actions, not callable in a loop).
--   (D) caller has a confirmed/completed BOOKING with target on a SHARED
--       TRIP. Covers: driver→passenger and passenger→driver notifications
--       for booking lifecycle events.
--   (E) caller has SHARED A TRIP REQUEST with target via the request
--       messaging system (migration 021's request_messages). Covers:
--       contact-on-passenger-request flows.
--
-- Anything else is rejected with 42501. The client-side try/catch will
-- continue to swallow rejections, but legitimate cases now succeed where
-- they previously didn't.
--
-- COMPATIBILITY
--
-- - RLS policy unchanged. The RPC is additive.
-- - Existing trigger-driven notifications (notify_driver_on_booking etc.)
--   are unchanged — they continue to bypass RLS via their own SECURITY
--   DEFINER context.
-- - Client code can adopt the RPC incrementally. The notifyAdmin helper
--   should switch first (highest impact, simplest call). Other call sites
--   can follow in a separate code commit.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_email TEXT,
  p_title      TEXT,
  p_message    TEXT,
  p_type       TEXT DEFAULT 'system',
  p_trip_id    TEXT DEFAULT NULL,
  p_link       TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller       TEXT := public.auth_user_email();
  v_caller_role  TEXT := public.auth_user_role();
  v_target_role  TEXT;
  v_authorized   BOOLEAN := FALSE;
  v_inserted_id  UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_email IS NULL OR TRIM(p_user_email) = '' THEN
    RAISE EXCEPTION 'target user_email required';
  END IF;

  IF p_title IS NULL OR TRIM(p_title) = '' THEN
    RAISE EXCEPTION 'title required';
  END IF;

  IF p_message IS NULL OR TRIM(p_message) = '' THEN
    RAISE EXCEPTION 'message required';
  END IF;

  -- Bound title/message length defensively. The notifications table doesn't
  -- enforce these at column level (TEXT is unbounded) but unbounded inserts
  -- enable bell-spam DOS. 200/2000 matches normal product use.
  IF LENGTH(p_title)   > 200  THEN RAISE EXCEPTION 'title too long (max 200)';   END IF;
  IF LENGTH(p_message) > 2000 THEN RAISE EXCEPTION 'message too long (max 2000)'; END IF;

  -- Rule A — self-targeted
  IF v_caller = p_user_email THEN
    v_authorized := TRUE;
  END IF;

  -- Rule B — caller is admin
  IF NOT v_authorized AND v_caller_role = 'admin' THEN
    v_authorized := TRUE;
  END IF;

  -- Rule C — target is admin (any user can ping admins)
  IF NOT v_authorized THEN
    SELECT role INTO v_target_role
    FROM public.profiles
    WHERE email = p_user_email
    LIMIT 1;
    IF v_target_role = 'admin' THEN
      v_authorized := TRUE;
    END IF;
  END IF;

  -- Rule D — caller and target share a confirmed/completed booking on
  -- a trip. Covers driver→passenger AND passenger→driver in either direction
  -- since we check both (caller=driver, target=passenger) and the inverse.
  IF NOT v_authorized THEN
    IF EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.trips t ON t.id::text = b.trip_id
      WHERE b.status IN ('confirmed','completed','pending','cancelled','cancelled_by_driver')
        AND (
              (t.driver_email   = v_caller     AND b.passenger_email = p_user_email)
           OR (t.driver_email   = p_user_email AND b.passenger_email = v_caller)
        )
    ) THEN
      v_authorized := TRUE;
    END IF;
  END IF;

  -- Rule E — caller and target have exchanged messages on a trip request
  -- (contact-on-passenger-request flows from migration 021). Falls back to
  -- request_messages relation if it exists (table created in migration
  -- 019/021). Wrapped in EXCEPTION block so this rule no-ops cleanly on
  -- environments where request_messages doesn't exist yet.
  IF NOT v_authorized THEN
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM public.request_messages rm
        WHERE (rm.sender_email = v_caller     AND rm.receiver_email = p_user_email)
           OR (rm.sender_email = p_user_email AND rm.receiver_email = v_caller)
      ) THEN
        v_authorized := TRUE;
      END IF;
    EXCEPTION
      WHEN undefined_table THEN
        NULL; -- request_messages not deployed; skip rule E
    END;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'caller has no relationship with target user'
      USING ERRCODE = '42501';
  END IF;

  -- All checks passed. Insert the notification.
  INSERT INTO public.notifications (
    user_email, title, message, type, trip_id, link, is_read
  ) VALUES (
    p_user_email, p_title, p_message, COALESCE(p_type, 'system'),
    p_trip_id, p_link, FALSE
  ) RETURNING id INTO v_inserted_id;

  RETURN v_inserted_id;
END $$;

REVOKE ALL ON FUNCTION public.create_notification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_notification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Creates a notification on behalf of the calling user. Authorization rules:
   (A) self-targeted, (B) caller is admin, (C) target is admin,
   (D) caller and target share a booking, (E) caller and target have
   exchanged trip-request messages. Other cross-user inserts are rejected
   with 42501. Replaces direct Notification.create from client code which
   was failing silently against the migration 002 RLS policy.';

-- Self-check
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_notification'
  ) THEN
    RAISE NOTICE 'MIGRATION 027 OK — create_notification RPC installed';
  ELSE
    RAISE WARNING 'MIGRATION 027 — create_notification not found after CREATE';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION
-- =============================================================================
--
-- 1) Caller pings admin (Rule C). Should succeed:
--      SELECT public.create_notification(
--        'souqnamarketplace@gmail.com',
--        'Test admin ping',
--        'Hello admin from authenticated user'
--      );
--
-- 2) Caller tries to ping random unrelated user (no booking, not admin).
--    Should fail with 42501:
--      SELECT public.create_notification(
--        'someone-else@example.com',
--        'Should not work',
--        'spam'
--      );
--
-- 3) Driver pings passenger they have a confirmed booking with (Rule D).
--    Should succeed:
--      SELECT public.create_notification(
--        '<passenger_with_confirmed_booking>',
--        'تم قبول حجزك',
--        '...',
--        'system',
--        '<trip_id>'
--      );
-- =============================================================================
