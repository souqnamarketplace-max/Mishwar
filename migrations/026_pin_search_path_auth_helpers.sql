-- =============================================================================
-- Migration 026 — pin search_path on auth_user_email() and auth_user_role()
-- =============================================================================
--
-- BACKGROUND
--
-- The two functions auth_user_email() and auth_user_role() are the trust root
-- of the entire RLS / RPC security model. Almost every policy in the codebase
-- calls one or both of them to identify the caller and gate access.
--
-- Defined in supabase-production.sql:16-24 as:
--
--    CREATE OR REPLACE FUNCTION public.auth_user_email()
--    RETURNS TEXT AS $$
--      SELECT email FROM auth.users WHERE id = auth.uid();
--    $$ LANGUAGE sql SECURITY DEFINER STABLE;
--
--    CREATE OR REPLACE FUNCTION public.auth_user_role()
--    RETURNS TEXT AS $$
--      SELECT role FROM public.profiles WHERE id = auth.uid();
--    $$ LANGUAGE sql SECURITY DEFINER STABLE;
--
-- Both are SECURITY DEFINER but neither pins search_path explicitly. Every
-- other SECURITY DEFINER function in this codebase (97+ across migrations
-- 002-025) sets `SET search_path = public, pg_catalog [, auth]` as a defence-
-- in-depth measure. The two oldest ones are the only exceptions.
--
-- THE RISK
--
-- A SECURITY DEFINER function without pinned search_path runs with the
-- session's search_path at call time. If an attacker can convince the
-- function to resolve `auth.users` or `public.profiles` to a table they
-- control (by prepending a schema they own to search_path before calling),
-- they could feed the function arbitrary rows and influence what email or
-- role gets returned — bypassing the trust root.
--
-- This is NOT exploitable on Supabase today: the `authenticated` role does
-- not have CREATE ON SCHEMA privileges anywhere, so an attacker can't make
-- a shadow `auth.users` table to redirect lookups. The attack requires
-- privileges they don't have.
--
-- But:
--   1. Defense-in-depth — if a future Supabase change, extension install,
--      or admin mistake ever grants CREATE on a schema users can manipulate,
--      these two unpinned functions become the open door.
--   2. Consistency — every other SECURITY DEFINER function in the codebase
--      pins search_path. Linters (sqlfluff with the security ruleset, the
--      Supabase Security Advisor in the dashboard) flag the unpinned ones
--      as findings. Closing the gap removes the noise so real future issues
--      surface faster.
--   3. App Store / Play Store privacy reviewers occasionally ask for the
--      Supabase Security Advisor output. A clean report is faster to ship.
--
-- THE FIX
--
-- ALTER FUNCTION ... SET search_path. This pins search_path at function
-- creation level — every call resolves identifiers through the same path
-- regardless of the caller's session settings.
--
-- Why ALTER instead of CREATE OR REPLACE: the function bodies are
-- correct as-is. ALTER changes only the metadata (search_path setting)
-- without re-defining the function. Keeps the diff minimal — anyone
-- reviewing this migration sees exactly one thing happening per function.
--
-- COMPATIBILITY
--
-- - Both functions keep their signatures, return types, and bodies.
-- - Every existing call site continues to work unchanged.
-- - Idempotent — re-running this migration is a no-op (ALTER ... SET
--   replaces the previous SET cleanly).
-- =============================================================================

BEGIN;

ALTER FUNCTION public.auth_user_email()
  SET search_path = public, pg_catalog, auth;

ALTER FUNCTION public.auth_user_role()
  SET search_path = public, pg_catalog, auth;

-- Self-check: verify the search_path is now set on both functions. The proconfig
-- column of pg_proc holds the per-function settings array; "search_path=..." is
-- present after ALTER FUNCTION ... SET search_path ran successfully.
DO $$
DECLARE
  v_email_ok BOOLEAN;
  v_role_ok  BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'auth_user_email'
      AND p.proconfig::text LIKE '%search_path=%'
  ) INTO v_email_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'auth_user_role'
      AND p.proconfig::text LIKE '%search_path=%'
  ) INTO v_role_ok;

  IF v_email_ok AND v_role_ok THEN
    RAISE NOTICE 'MIGRATION 026 OK — search_path pinned on auth_user_email and auth_user_role';
  ELSE
    RAISE WARNING 'MIGRATION 026 — pin failed: auth_user_email_ok=% auth_user_role_ok=%',
      v_email_ok, v_role_ok;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually to double-check)
-- =============================================================================
--
-- 1) Confirm search_path is pinned:
--      SELECT proname, proconfig FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname IN ('auth_user_email','auth_user_role');
--    Expected: each row's proconfig contains 'search_path=public, pg_catalog, auth'.
--
-- 2) Confirm functional behaviour unchanged. Call as an authenticated user:
--      SELECT public.auth_user_email();   -- expect: caller's email
--      SELECT public.auth_user_role();    -- expect: caller's role ('user' or 'admin')
-- =============================================================================
