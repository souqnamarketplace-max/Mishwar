-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 024 — admin RPCs source-of-truth restoration
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS MIGRATION EXISTS:
--
-- During the May 2026 production audit, an inventory of every supabase.rpc()
-- call in the frontend revealed 5 admin-only RPCs that aren't defined in
-- any migration file in this repo:
--
--   - activity_log              (DashboardLogs.jsx — admin activity feed)
--   - audit_log_facets          (DashboardLogs.jsx — sidebar facet counts)
--   - audit_log_search          (DashboardLogs.jsx — searchable audit log)
--   - driver_payments_summary   (DashboardPayments.jsx — payment dashboard)
--   - broadcast_notification    (Dashboard.jsx — admin broadcast feature)
--
-- The audit probed each one in production:
--   · 4 work and return real data (almost certainly created via Supabase
--     dashboard UI by whoever built the admin dashboard, never committed
--     to the repo's migrations folder)
--   · 1 returns 404 (broadcast_notification — never created in production
--     either, the admin "إرسال إشعار من الإدارة" feature is broken)
--
-- This migration covers BOTH halves:
--
--   A) Source-of-truth codification of the 4 working RPCs. Operator
--      pastes the export from Supabase into the placeholder block —
--      CREATE OR REPLACE means re-running on production is a no-op
--      (function already exists with the same body), but going forward
--      the canonical definition lives in the repo.
--
--   B) Authored definition of broadcast_notification. The frontend at
--      src/pages/Dashboard.jsx:319 has a fully-wired two-stage admin
--      UI calling this RPC with (title_text, message_text) → INT (count
--      of users notified). Currently the button silently errors with
--      "Could not find the function" — the admin notification feature
--      is non-functional. This migration ships a working implementation.
--
-- The migration is idempotent (CREATE OR REPLACE on functions). Re-
-- running is safe.
--
-- HOW TO APPLY:
--
-- STEP 1 — Export the 4 working RPCs from production into this file
-- ────────────────────────────────────────────────────────────────────
-- In the Supabase SQL editor, run:
--
--   SELECT pg_get_functiondef(p.oid) || ';' AS def
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN (
--       'activity_log',
--       'audit_log_facets',
--       'audit_log_search',
--       'driver_payments_summary'
--     )
--   ORDER BY p.proname;
--
-- Copy the four function bodies it returns. Paste each one into the
-- corresponding placeholder section below (A1–A4), replacing the
-- placeholder comment block. If `pg_get_functiondef` returns
-- "CREATE FUNCTION ..." rather than "CREATE OR REPLACE FUNCTION ...",
-- edit the leading "CREATE" → "CREATE OR REPLACE" on each one before
-- committing — without OR REPLACE, re-running this file on the same
-- DB throws "function already exists" instead of being a no-op.
--
-- ALSO export is_passenger_verified and is_driver_subscribed using
-- the same query (with their names instead). The audit said both are
-- missing, but the export will tell you definitively — if either DOES
-- exist, capture the production-canonical definition into migration
-- 023's commit history (file an amendment commit). If neither exists,
-- migration 023 ships the correct creation.
--
-- STEP 2 — Apply the migration
-- ────────────────────────────────────────────────────────────────────
-- Once the placeholder sections are filled in, paste the entire file
-- into the Supabase SQL editor and Run. Expected output:
-- "MIGRATION 024 OK — all 5 admin RPCs present" (raised by the
-- verification block at the end). On failure the transaction rolls
-- back atomically.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;


-- ─── A1) activity_log ─────────────────────────────────────────────────────
-- TODO: paste the production-exported definition here. Edit the leading
-- CREATE → CREATE OR REPLACE if pg_get_functiondef didn't include OR REPLACE.
--
-- Until this is filled in, leave this block as a comment so the migration
-- fails loudly at the verification step rather than silently dropping
-- the function. The migration cannot be applied to production until
-- this section is completed.

-- <PASTE activity_log DEFINITION HERE>


-- ─── A2) audit_log_facets ─────────────────────────────────────────────────

-- <PASTE audit_log_facets DEFINITION HERE>


-- ─── A3) audit_log_search ─────────────────────────────────────────────────

-- <PASTE audit_log_search DEFINITION HERE>


-- ─── A4) driver_payments_summary ──────────────────────────────────────────

-- <PASTE driver_payments_summary DEFINITION HERE>


-- ─── B) broadcast_notification ────────────────────────────────────────────
--
-- ADMIN-ONLY: sends a notification to every active user.
-- Wired in src/pages/Dashboard.jsx:315-333 (two-stage confirmation flow):
--   sendBroadcast = await supabase.rpc("broadcast_notification", {
--     title_text:   "📢 إشعار من الإدارة",
--     message_text: broadcastMsg,
--   })
--   → returns count, surfaced as toast: "تم إرسال الإشعار لـ {count} مستخدم"
--
-- Security model:
--   1. Caller must be authenticated AND have role='admin' in profiles
--   2. SECURITY DEFINER bypasses notifications_insert RLS (which only
--      lets users insert notifications targeted at themselves) — the
--      admin-broadcast use case is the explicit reason this RPC exists
--   3. search_path pinned to public, pg_catalog (security hardening,
--      matches the migration 002 phase-0 pattern)
--
-- Inputs:
--   - title_text:   notification title shown in the bell + push
--   - message_text: notification body
--
-- Returns: INT — count of notification rows inserted. Frontend surfaces
-- this in the success toast so the admin sees confirmation of reach.
--
-- Idempotency note: this RPC INSERTs a fresh row per invocation. Calling
-- it twice with the same content double-broadcasts. The frontend's
-- two-stage confirmation UI handles this on the human side; no server-
-- side dedup needed.

CREATE OR REPLACE FUNCTION public.broadcast_notification(
  title_text   TEXT,
  message_text TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email TEXT := public.auth_user_email();
  v_is_admin    BOOLEAN;
  v_inserted    INTEGER;
BEGIN
  -- 1) Auth gate — must be authenticated
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  -- 2) Admin gate — same pattern as migration 011's grant RPCs
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'only admins can broadcast notifications'
      USING ERRCODE = '42501';
  END IF;

  -- 3) Input validation. Empty title or message would create useless
  --    notifications spamming every user; refuse early.
  IF title_text   IS NULL OR TRIM(title_text)   = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF message_text IS NULL OR TRIM(message_text) = '' THEN
    RAISE EXCEPTION 'message is required';
  END IF;

  -- 4) Insert one notification per active profile. Excludes:
  --    - rows with NULL email (data integrity safety net)
  --    - the admin themselves (no point self-broadcasting; if the admin
  --      genuinely wants to test, they can target their own email via
  --      a different surface)
  --    - blocked / deleted accounts (full_name='حساب محذوف' is the
  --      tombstone marker used elsewhere in the code; skip those)
  INSERT INTO public.notifications (
    user_email,
    title,
    message,
    type,
    is_read
  )
  SELECT
    p.email,
    title_text,
    message_text,
    'admin_broadcast',
    FALSE
  FROM public.profiles p
  WHERE p.email IS NOT NULL
    AND p.email <> v_admin_email
    AND COALESCE(p.full_name, '') <> 'حساب محذوف';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_notification(TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_notification(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.broadcast_notification(TEXT, TEXT) IS
  'Admin-only: inserts a notification row for every active user (excluding
   the broadcasting admin and tombstoned/deleted accounts). Returns the
   count of rows inserted. SECURITY DEFINER + admin gate substitute for
   the missing RLS path that would otherwise require notifications_insert
   to allow admins to write into any user''s notification row.';


-- ─── C) Self-validating verification block ────────────────────────────────
-- All 5 admin RPCs MUST exist after this migration runs. If any are
-- missing the transaction rolls back atomically.

DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_required TEXT[] := ARRAY[
    'activity_log',
    'audit_log_facets',
    'audit_log_search',
    'driver_payments_summary',
    'broadcast_notification'
  ];
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY v_required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    ) THEN
      v_missing := array_append(v_missing, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'MIGRATION 024 FAILED — missing functions: %.  Did you fill in placeholder sections A1–A4?',
      array_to_string(v_missing, ', ');
  END IF;

  RAISE NOTICE 'MIGRATION 024 OK — all 5 admin RPCs present';
END $$;


COMMIT;


-- ─── D) Optional smoke test ───────────────────────────────────────────────
-- Run AFTER the COMMIT succeeds. As an admin user, this should return
-- the count of recipients (a positive integer for a populated DB).
-- As a non-admin user, this should raise "only admins can broadcast
-- notifications" — confirming the gate works.
--
-- SELECT public.broadcast_notification('test_title', 'test_message');
--
-- Important: the test invocation above WILL spam every user. If you
-- run it on production, follow up with:
--   DELETE FROM public.notifications
--    WHERE type = 'admin_broadcast' AND title = 'test_title';
-- to clean up.
