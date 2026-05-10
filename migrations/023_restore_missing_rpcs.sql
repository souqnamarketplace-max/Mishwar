-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 023 — restore is_driver_subscribed + is_passenger_verified RPCs
--                 and align app_settings.app_name with the deployed brand
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS MIGRATION EXISTS:
--
-- Production audit (May 2026) found that two SECURITY DEFINER helper
-- functions defined in migrations 019 and 020 are missing in production:
--
--   - is_driver_subscribed(p_email TEXT)  — defined in migration 019
--   - is_passenger_verified(p_email TEXT) — defined in migration 020
--
-- PostgREST returns 404 ("Could not find the function") when the frontend
-- calls them. Symptoms:
--
--   1. /passenger-requests bypasses the subscription gate for drivers — any
--      driver (even unsubscribed) can read passenger requests, defeating
--      the paid-tier model. Revenue leak.
--
--   2. /request-trip → submit silently fails because submit_trip_request
--      RPC internally invokes is_passenger_verified, which throws missing-
--      function. Frontend gate (`isVerified === false`) doesn't fire either
--      because the rpc throws → useQuery returns undefined → the strict
--      equality check skips the gate panel. End result: passengers fill
--      out the form, hit submit, see a generic error, and bounce.
--
-- Other RPCs from these migrations (public_open_requests_count,
-- submit_trip_request, etc.) DO work in production, which means the
-- migrations were partially applied. The two missing functions have to
-- be restored individually.
--
-- This migration is idempotent (CREATE OR REPLACE on functions, IF NOT
-- EXISTS / WHERE clauses on data). Re-running is safe.
--
-- The migration also fixes the brand-name drift in app_settings — the
-- prior brand "مِشوار" needs to become the current "مشوارو" wherever
-- the column is read by the UI.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── A) is_driver_subscribed ──────────────────────────────────────────────
-- Verbatim copy from migrations/019_trip_requests.sql lines 146–171.
-- Used by RLS policies on trip_requests + the /passenger-requests gate.
-- Returns TRUE if the user has an active subscription whose period_end
-- is in the future. Admins always pass.

CREATE OR REPLACE FUNCTION public.is_driver_subscribed(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_active BOOLEAN;
BEGIN
  IF p_email IS NULL THEN RETURN FALSE; END IF;

  -- Admins always pass — they need to moderate
  IF (SELECT role FROM public.profiles WHERE email = p_email LIMIT 1) = 'admin' THEN
    RETURN TRUE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.driver_subscriptions
    WHERE driver_email = p_email
      AND status = 'active'
      AND (period_end IS NULL OR period_end > now())
  ) INTO v_active;

  RETURN COALESCE(v_active, FALSE);
END $$;

GRANT EXECUTE ON FUNCTION public.is_driver_subscribed(TEXT) TO authenticated;


-- ─── B) is_passenger_verified ─────────────────────────────────────────────
-- Verbatim copy from migrations/020_passenger_verification.sql lines 82–101.
-- Used by submit_trip_request RPC + UI gate. SECURITY DEFINER so it can
-- read the verifications table without granting the caller direct rights.
-- Admins always pass.

CREATE OR REPLACE FUNCTION public.is_passenger_verified(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_email IS NULL THEN RETURN FALSE; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE email = p_email LIMIT 1;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.passenger_verifications
    WHERE user_email = p_email AND status = 'approved'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.is_passenger_verified(TEXT) TO authenticated;


-- ─── C) app_settings.app_name brand drift ────────────────────────────────
-- The deployed brand is "مشوارو" (Mishwaro). Production rows still hold
-- the prior brand "مِشوار". The UI reads app_settings.app_name in
-- DashboardSettings + anywhere else that surfaces the platform name.
--
-- Update every row that holds the old brand. Rows already on the new
-- brand (or NULL / empty) are left alone.

UPDATE public.app_settings
   SET app_name = 'مشوارو'
 WHERE app_name IS DISTINCT FROM 'مشوارو'
   AND app_name IS NOT NULL
   AND TRIM(app_name) <> '';


-- ─── D) Verification queries ─────────────────────────────────────────────
-- Run these AFTER applying the migration to confirm the fixes landed.
-- Each should return the expected value; if any row is wrong the
-- migration failed silently and needs investigation.

-- Expected: 1 row, both columns = 't' (true)
-- SELECT
--   EXISTS (
--     SELECT 1 FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'is_driver_subscribed'
--   ) AS is_driver_subscribed_exists,
--   EXISTS (
--     SELECT 1 FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'is_passenger_verified'
--   ) AS is_passenger_verified_exists;

-- Expected: every row has app_name = 'مشوارو' (or NULL/empty)
-- SELECT id, app_name FROM public.app_settings;

-- Smoke-test the RPCs as the authenticated role. Both should return
-- a boolean (FALSE for non-existent emails, TRUE for admins). Should
-- NOT 404.
-- SELECT public.is_driver_subscribed('nonexistent@example.com');
-- SELECT public.is_passenger_verified('nonexistent@example.com');
