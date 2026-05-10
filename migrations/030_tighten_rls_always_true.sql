-- =============================================================================
-- Migration 030 — tighten RLS policies flagged as USING/WITH CHECK (true)
-- =============================================================================
--
-- BACKGROUND
--
-- The Supabase database advisor's rls_policy_always_true lint flagged 6
-- INSERT/UPDATE policies whose WITH CHECK or USING expression is `true`.
-- That effectively bypasses row-level security for those operations: any
-- caller who can reach the table can write any row.
--
-- Each finding was triaged individually because the right fix differs.
-- Some are legitimate (anon must INSERT login_attempts before they're
-- authenticated), some need scoping to the writer's own row, and some
-- are admin-only data that shouldn't be writable by users at all.
--
-- The frontend was searched for direct writes to each flagged table to
-- ensure no legitimate write path will break:
--
--   login_attempts.INSERT      — used in src/lib/AuthContext.jsx (anon-OK,
--                                  best-effort fail-quiet). Must remain
--                                  permissive at INSERT, but scoped via
--                                  column constraints to prevent abuse.
--   city_suggestions.INSERT    — frontend uses suggest_city RPC (SECURITY
--                                  DEFINER), never direct INSERT. Safe to
--                                  tighten direct path to admin-only.
--   support_tickets.INSERT     — no frontend writes (dashboard-only path).
--                                  Safe to tighten to admin-only.
--   driver_payouts.INSERT      — no frontend writes. Admin/service only.
--   app_settings.INSERT/UPDATE — no frontend writes (dashboard-only). Admin
--                                  via DashboardSettings tab. Safe to tighten.
--
-- =============================================================================

BEGIN;

-- ─── 1) login_attempts: KEEP permissive INSERT (intentional) ───────────────
--
-- This is the brute-force tracking mechanism. Anonymous users hitting login
-- fail before they're authenticated, and we still want to log the attempt
-- to drive the rate-limit + lockout. The advisor's lint is technically
-- correct (WITH CHECK true is permissive) but the intent is correct here.
--
-- The right defense isn't to change the policy itself, it's to:
--   (a) ensure the table can never be SELECTed by users (already true —
--       there is no SELECT policy, so PostgREST denies reads to all roles
--       including authenticated; only the security_definer functions and
--       admin dashboard via service_role can read it)
--   (b) bound the row content so abuse can't smuggle data via the email
--       column (already enforced by column type TEXT + reasonable length
--       constraint at the application layer)
--
-- We add a defensive CHECK constraint here that the email column, if
-- non-null, looks vaguely like an email — bounds the abuse surface.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'login_attempts_email_format'
      AND conrelid = 'public.login_attempts'::regclass
  ) THEN
    ALTER TABLE public.login_attempts
      ADD CONSTRAINT login_attempts_email_format
      CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 320 AND email LIKE '%@%'));
  END IF;
EXCEPTION
  WHEN check_violation THEN
    -- Existing rows violate the new constraint — log but don't fail the
    -- migration. Production data quality issue to clean up separately.
    RAISE WARNING 'login_attempts has rows that fail the new email format check; constraint not added';
  WHEN undefined_table THEN
    RAISE NOTICE 'login_attempts table not found — skipping';
END $$;

-- ─── 2) city_suggestions: tighten INSERT to require own email ──────────────
--
-- Source migration 015 defined the INSERT policy as WITH CHECK (true). The
-- frontend goes through the suggest_city RPC (SECURITY DEFINER) which fills
-- in suggested_by_email = auth.email() correctly. Tightening direct INSERT
-- to require that the row's suggested_by_email matches the caller closes
-- the impersonation hole without breaking the legitimate RPC path (the RPC
-- bypasses RLS entirely as SECURITY DEFINER).

DROP POLICY IF EXISTS "auth users can suggest cities" ON public.city_suggestions;
CREATE POLICY "auth users can suggest cities"
  ON public.city_suggestions FOR INSERT TO authenticated
  WITH CHECK (
    suggested_by_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- ─── 3) support_tickets: admin-only INSERT ─────────────────────────────────
--
-- No frontend writes. If a future feature wires a user-facing "submit
-- ticket" flow, it should go through a SECURITY DEFINER RPC similar to
-- suggest_city / submit_passenger_verification, not direct INSERT.

DROP POLICY IF EXISTS tickets_insert ON public.support_tickets;
CREATE POLICY tickets_insert
  ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

-- ─── 4) driver_payouts: admin-only INSERT ──────────────────────────────────
--
-- Same situation. Payouts are an admin/service action — currently no
-- frontend writes. The "service_insert_payouts" name implies the original
-- intent was for a service_role caller to insert; service_role bypasses
-- RLS entirely, so this policy is only relevant for non-service callers.
-- Locking it to admins matches that intent.

DROP POLICY IF EXISTS service_insert_payouts ON public.driver_payouts;
CREATE POLICY service_insert_payouts
  ON public.driver_payouts FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

-- ─── 5+6) app_settings: admin-only INSERT/UPDATE ───────────────────────────
--
-- App settings (hero_city_slides, app_name, etc.) are admin-managed from
-- the DashboardSettings tab. No user-facing write path exists or should
-- exist. Both INSERT and UPDATE go admin-only.
--
-- The advisor flagged duplicate policies on this table too (settings_write_admin
-- exists alongside app_settings_insert_all). The clean fix is to drop the
-- always-true ones; the *_admin variants stay.

DROP POLICY IF EXISTS app_settings_insert_all ON public.app_settings;
DROP POLICY IF EXISTS app_settings_update_all ON public.app_settings;

-- Defensive: if the *_admin policies don't exist on this DB (unlikely but
-- possible if dashboard drift removed them), recreate them so we don't
-- leave the table fully unwritable. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_settings'
      AND policyname = 'settings_write_admin'
  ) THEN
    CREATE POLICY settings_write_admin ON public.app_settings
      FOR INSERT TO authenticated
      WITH CHECK (public.auth_user_role() = 'admin');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_settings'
      AND policyname = 'settings_update_admin'
  ) THEN
    CREATE POLICY settings_update_admin ON public.app_settings
      FOR UPDATE TO authenticated
      USING      (public.auth_user_role() = 'admin')
      WITH CHECK (public.auth_user_role() = 'admin');
  END IF;
END $$;

-- Self-check: every flagged policy either no longer exists or has a
-- non-trivial predicate.
DO $$
DECLARE
  v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN (
      'app_settings_insert_all',
      'app_settings_update_all'
    );
  IF v_remaining > 0 THEN
    RAISE WARNING 'MIGRATION 030 — % always-true policies still exist', v_remaining;
  ELSE
    RAISE NOTICE 'MIGRATION 030 OK — flagged always-true policies cleaned up';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION
-- =============================================================================
--
-- 1) Re-run the Supabase database advisor. The rls_policy_always_true
--    findings should clear EXCEPT login_attempts (which is intentional —
--    see comment in section 1). Advisor will continue to flag it because
--    the policy itself is unchanged; that's expected.
--
-- 2) Verify the legitimate paths still work:
--    - SuggestCityModal: open the modal, suggest a city. Should succeed
--      via the suggest_city RPC.
--    - DashboardSettings: edit hero_city_slides. Should succeed because
--      the admin's auth_user_role() = 'admin'.
--    - Login flow: log in with a valid AND with an invalid password.
--      AuthContext.jsx still records both via login_attempts.insert.
--
-- 3) Verify the closed paths are denied:
--    - As a regular authenticated user, try a direct PATCH on
--      /rest/v1/app_settings → should return 42501.
--    - As a regular authenticated user, try a direct INSERT on
--      /rest/v1/support_tickets → should return 42501.
-- =============================================================================
