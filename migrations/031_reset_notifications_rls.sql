-- ════════════════════════════════════════════════════════════════════════
-- Migration 031 — Reset notifications RLS to canonical 4-policy state
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- Production drift discovered 2026-05-10: notifications had 7 RLS
-- policies (4 from migration 028's intended state + 3 legacy policies
-- from before 028: users_read_own_notifications, users_update_own_notifications,
-- users_insert_notifications, plus admins_manage_notifications).
--
-- The legacy users_read_own_notifications used:
--   user_email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
-- which evaluated to false at runtime against the admin email, causing
-- a 403 Forbidden on GET /rest/v1/notifications?user_email=eq.<admin-email>.
--
-- Migration 028 created notifications_select, notifications_insert,
-- notifications_update, notifications_delete — but did NOT drop the
-- legacy policy names. RLS evaluates ANY-true across all matching
-- policies, so the legacy buggy policy was the active denier.
--
-- WHAT THIS DOES
-- 1. Drops all 7 known existing policies (legacy + 028) with IF EXISTS
--    so we are starting from zero.
-- 2. Recreates the 4 canonical policies matching supabase-production.sql
--    lines 516-547 (and matching the prior session's 028 commit message).
-- 3. Verifies exactly 4 policies exist after the migration.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. DROP EVERY KNOWN POLICY (clean slate) ──────────────────────────
DROP POLICY IF EXISTS users_read_own_notifications   ON public.notifications;
DROP POLICY IF EXISTS users_update_own_notifications ON public.notifications;
DROP POLICY IF EXISTS users_insert_notifications     ON public.notifications;
DROP POLICY IF EXISTS admins_manage_notifications    ON public.notifications;
DROP POLICY IF EXISTS notifications_select           ON public.notifications;
DROP POLICY IF EXISTS notifications_insert           ON public.notifications;
DROP POLICY IF EXISTS notifications_update           ON public.notifications;
DROP POLICY IF EXISTS notifications_delete           ON public.notifications;

-- ─── 2. RECREATE CANONICAL 4-POLICY STATE ──────────────────────────────

-- SELECT — users see their own, admins see all
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- INSERT — any authenticated user (so the create_notification RPC can
-- write cross-user notifications via SECURITY DEFINER)
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE — users update their own, admins update all
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- DELETE — users delete their own, admins delete all
CREATE POLICY notifications_delete ON public.notifications
  FOR DELETE TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- ─── 3. VERIFY EXACTLY 4 POLICIES ──────────────────────────────────────
DO $$
DECLARE
  policy_count INTEGER;
  policy_list  TEXT;
BEGIN
  SELECT COUNT(*), string_agg(policyname, ', ' ORDER BY policyname)
    INTO policy_count, policy_list
  FROM pg_policies
  WHERE tablename = 'notifications' AND schemaname = 'public';

  RAISE NOTICE 'notifications policies after 031: % (%)', policy_count, policy_list;

  IF policy_count <> 4 THEN
    RAISE EXCEPTION
      'MIGRATION 031 FAILED: expected 4 policies on notifications, got %', policy_count;
  END IF;

  RAISE NOTICE 'MIGRATION 031 OK';
END $$;
