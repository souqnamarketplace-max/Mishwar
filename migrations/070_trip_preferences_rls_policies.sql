-- ════════════════════════════════════════════════════════════════════════
-- Migration 070 — RLS policies for trip_preferences
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- /notifications page lets users save route watchlists ("notify me when
-- a trip from Ramallah → Nablus appears"). Backed by the
-- public.trip_preferences table. The matching trigger (mig 038) reads
-- this table via SECURITY DEFINER, so it doesn't care about RLS.
--
-- The user-facing CRUD goes through PostgREST as the authenticated
-- user. SELECT was already working (users could see their list). But
-- DELETE was silently failing — clicking the trash icon hit the
-- /trip_preferences?id=eq.X DELETE endpoint, PostgREST returned 204
-- success, but RLS blocked the actual row deletion. Same silent-no-op
-- bug as several pre-launch fixes earlier in the migration history.
--
-- ROOT CAUSE
-- trip_preferences has RLS enabled (default for tables in the public
-- schema on Supabase) but no FOR DELETE or FOR UPDATE policy. Without
-- a policy, the operation is denied — but PostgREST returns success
-- because the WHERE clause matched 0 rows (RLS-filtered to nothing).
-- No error, no row deleted, no feedback to the user.
--
-- FIX
-- Add a comprehensive set of owner-scoped policies:
--   - SELECT: user_email = auth.email() — see only your own preferences
--   - INSERT: WITH CHECK user_email = auth.email() — can't impersonate
--   - UPDATE: USING user_email = auth.email() — can only update your own
--   - DELETE: USING user_email = auth.email() — can only delete your own
--
-- Admin override: admin role can do anything (separate FOR ALL policy
-- with EXISTS-based admin check). Mirrors the pattern used in
-- mig 009 (driver_subscriptions) and elsewhere.
--
-- IDEMPOTENT
-- DROP POLICY IF EXISTS guards every policy creation so this migration
-- can be re-run safely.
--
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- Ensure RLS is on (defensive — should already be the case)
ALTER TABLE public.trip_preferences ENABLE ROW LEVEL SECURITY;

-- ─── SELECT: own rows ────────────────────────────────────────────────
DROP POLICY IF EXISTS trip_preferences_select_own ON public.trip_preferences;
CREATE POLICY trip_preferences_select_own ON public.trip_preferences
  FOR SELECT TO authenticated
  USING (user_email = auth.email());

-- ─── INSERT: own rows ────────────────────────────────────────────────
DROP POLICY IF EXISTS trip_preferences_insert_own ON public.trip_preferences;
CREATE POLICY trip_preferences_insert_own ON public.trip_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_email = auth.email());

-- ─── UPDATE: own rows ────────────────────────────────────────────────
-- USING: which existing rows are visible for UPDATE (filters before).
-- WITH CHECK: which new values are allowed (filters after). Both must
-- pass for the UPDATE to succeed. We require user_email = auth.email()
-- in both so a user can't update someone else's row, AND can't change
-- the user_email field to dodge ownership.
DROP POLICY IF EXISTS trip_preferences_update_own ON public.trip_preferences;
CREATE POLICY trip_preferences_update_own ON public.trip_preferences
  FOR UPDATE TO authenticated
  USING      (user_email = auth.email())
  WITH CHECK (user_email = auth.email());

-- ─── DELETE: own rows ────────────────────────────────────────────────
-- THE KEY FIX — without this, clicking the trash icon was a silent
-- no-op. PostgREST returns 204, the React mutation reports success,
-- the toast says "تم حذف التفضيل", but the row was never deleted.
-- After this migration: real deletion.
DROP POLICY IF EXISTS trip_preferences_delete_own ON public.trip_preferences;
CREATE POLICY trip_preferences_delete_own ON public.trip_preferences
  FOR DELETE TO authenticated
  USING (user_email = auth.email());

-- ─── Admin escape hatch ──────────────────────────────────────────────
-- Admin can SELECT/UPDATE/DELETE any preference row — useful for
-- support ("user X says their preferences aren't firing, can you
-- check?"). Doesn't get INSERT because admin shouldn't create
-- preferences on behalf of users (that's impersonation).
DROP POLICY IF EXISTS trip_preferences_admin_all ON public.trip_preferences;
CREATE POLICY trip_preferences_admin_all ON public.trip_preferences
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.email = auth.email() AND p.role = 'admin'
    )
  );

COMMIT;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_select BOOLEAN;
  v_insert BOOLEAN;
  v_update BOOLEAN;
  v_delete BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='trip_preferences'
                    AND policyname='trip_preferences_select_own') INTO v_select;
  SELECT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='trip_preferences'
                    AND policyname='trip_preferences_insert_own') INTO v_insert;
  SELECT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='trip_preferences'
                    AND policyname='trip_preferences_update_own') INTO v_update;
  SELECT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='trip_preferences'
                    AND policyname='trip_preferences_delete_own') INTO v_delete;

  IF NOT (v_select AND v_insert AND v_update AND v_delete) THEN
    RAISE EXCEPTION 'MIGRATION 070 FAILED — policies missing (select=%, insert=%, update=%, delete=%)',
      v_select, v_insert, v_update, v_delete;
  END IF;

  RAISE NOTICE 'MIGRATION 070 OK — trip_preferences RLS policies in place';
END $$;
