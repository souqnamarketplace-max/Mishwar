-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 023 — restore missing RPCs from the 019/020/021 wave
--                 and align app_settings.app_name with the deployed brand
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS MIGRATION EXISTS:
--
-- Production audit (May 2026) confirmed two SECURITY DEFINER helper functions
-- defined in migrations 019 and 020 are missing in the production database —
-- PostgREST returns 404 ("Could not find the function") when the frontend
-- calls them:
--
--   - is_driver_subscribed(p_email TEXT)  — defined in migration 019
--   - is_passenger_verified(p_email TEXT) — defined in migration 020
--
-- Other RPCs from those same migrations (public_open_requests_count,
-- submit_trip_request, etc.) work fine, so the migrations were partially
-- applied — the helper functions earlier in the file went missing at some
-- point (manual drop, botched rollback, env refresh, schema migration).
--
-- Migration 021 (`request_messaging_fixes`) is in the same wave and the
-- audit explicitly flagged /messages as a likely problem area, so we
-- defensively restore notify_request_contact too — same idempotent
-- CREATE OR REPLACE pattern; if the function already exists with the
-- same signature this is a no-op.
--
-- Production symptoms before this migration:
--
--   1. /passenger-requests bypassed the subscription gate for drivers.
--      Any driver (even unsubscribed) could read passenger requests,
--      defeating the paid-tier model. Direct revenue leak.
--
--   2. /request-trip → submit silently failed because submit_trip_request
--      RPC internally invokes is_passenger_verified, which throws missing-
--      function. The frontend gate (`isVerified === false`) didn't fire
--      either because the rpc throws → useQuery returns undefined →
--      strict equality check skips the gate panel. End result: passengers
--      fill out the form, hit submit, see a generic error, bounce.
--
--   3. (Suspected) /passenger-requests "تواصل" button silently failing
--      to send the "سائق مهتم برحلتك" notification because
--      notify_request_contact may also be missing.
--
-- The migration is idempotent (CREATE OR REPLACE on functions, conditional
-- WHERE clauses on data UPDATE). Re-running is safe.
--
-- The migration also fixes the brand-name drift in app_settings — the
-- prior brand "مِشوار" needs to become the current "مشوارو".
--
-- HOW TO APPLY:
--   1. Open Supabase dashboard → project dimtdwahtwaslmnuakij → SQL editor
--   2. Paste this entire file into a new query
--   3. Click "Run"
--   4. Expected output: "MIGRATION 023 OK — all functions present"
--      (raised by the verification block at the end)
--   5. If you see "MIGRATION 023 FAILED" instead, the transaction will
--      roll back automatically — nothing changes in your DB. Read the
--      error message for the specific failed function and re-run after
--      diagnosing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;


-- ─── A) is_driver_subscribed ──────────────────────────────────────────────
-- Verbatim from migrations/019_trip_requests.sql lines 146–171.
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
-- Verbatim from migrations/020_passenger_verification.sql lines 82–101.
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


-- ─── C) notify_request_contact ────────────────────────────────────────────
-- Verbatim from migrations/021_request_messaging_fixes.sql lines 67–158.
-- Sends the "سائق مهتم برحلتك" notification from a driver to a passenger.
-- SECURITY DEFINER bypasses notifications_insert RLS, but enforces
-- block-pair check + ownership check + auth check.
-- Restored here because migration 021 is in the same partial-apply wave
-- as 019 and 020 — audit flagged /messages as a likely problem area.

CREATE OR REPLACE FUNCTION public.notify_request_contact(
  p_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_email   TEXT := public.auth_user_email();
  v_caller_name    TEXT;
  v_passenger_email TEXT;
  v_passenger_name TEXT;
  v_request_status TEXT;
  v_from_city      TEXT;
  v_to_city        TEXT;
  v_blocked        BOOLEAN;
BEGIN
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- Fetch the request and its owner
  SELECT passenger_email, passenger_name, status, from_city, to_city
    INTO v_passenger_email, v_passenger_name, v_request_status, v_from_city, v_to_city
    FROM public.trip_requests
   WHERE id = p_request_id;

  IF v_passenger_email IS NULL THEN
    RAISE EXCEPTION 'trip request not found' USING ERRCODE = 'P0002';
  END IF;

  -- Drivers contact OTHER people's requests; refuse self-contact.
  IF v_passenger_email = v_caller_email THEN
    -- Silently no-op: the passenger pinged their own request thread,
    -- nothing to notify themselves about.
    RETURN FALSE;
  END IF;

  -- Block-pair check (mirrors messages_no_blocked_insert RLS policy).
  -- If either party blocked the other, no notification — fail closed.
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
     WHERE (blocker_email = v_caller_email   AND blocked_email = v_passenger_email)
        OR (blocker_email = v_passenger_email AND blocked_email = v_caller_email)
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN FALSE;
  END IF;

  -- Best-effort: pull caller's display name. If profile missing, use email prefix.
  SELECT COALESCE(NULLIF(full_name, ''), split_part(v_caller_email, '@', 1))
    INTO v_caller_name
    FROM public.profiles
   WHERE email = v_caller_email;

  IF v_caller_name IS NULL THEN
    v_caller_name := split_part(v_caller_email, '@', 1);
  END IF;

  -- Insert the notification — RLS bypassed via SECURITY DEFINER
  INSERT INTO public.notifications (
    user_email,
    title,
    message,
    type,
    is_read,
    link
  ) VALUES (
    v_passenger_email,
    'سائق مهتم برحلتك! 🚗',
    v_caller_name || ' يريد التواصل بشأن طلب رحلتك من ' || v_from_city ||
      ' إلى ' || v_to_city || '. اضغط لفتح المحادثة.',
    'request_contact',
    FALSE,
    '/messages?to=' || v_caller_email || '&request=' || p_request_id::TEXT
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_request_contact(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_request_contact(UUID) TO authenticated;


-- ─── D) app_settings.app_name brand drift ─────────────────────────────────
-- The deployed brand is "مشوارو" (Mishwaro). Production rows still hold
-- the prior brand "مِشوار". UI reads this column in DashboardSettings + a
-- few other surfaces.

UPDATE public.app_settings
   SET app_name = 'مشوارو'
 WHERE app_name IS DISTINCT FROM 'مشوارو'
   AND app_name IS NOT NULL
   AND TRIM(app_name) <> '';


-- ─── E) Self-validating verification block ────────────────────────────────
-- After the three CREATE OR REPLACE statements above, all three functions
-- MUST exist. If for any reason they don't (silent permissions failure,
-- partial paste, parser error swallowed somewhere), this block raises
-- an exception which rolls back the entire transaction.
--
-- This is belt-and-braces: CREATE OR REPLACE inside BEGIN/COMMIT already
-- guarantees atomicity, but explicit verification surfaces a failure
-- loudly to the operator instead of leaving them to discover it via
-- broken UX three days later.

DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_driver_subscribed'
  ) THEN
    v_missing := array_append(v_missing, 'is_driver_subscribed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_passenger_verified'
  ) THEN
    v_missing := array_append(v_missing, 'is_passenger_verified');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'notify_request_contact'
  ) THEN
    v_missing := array_append(v_missing, 'notify_request_contact');
  END IF;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'MIGRATION 023 FAILED — missing functions: %', array_to_string(v_missing, ', ');
  END IF;

  RAISE NOTICE 'MIGRATION 023 OK — all functions present (is_driver_subscribed, is_passenger_verified, notify_request_contact)';
END $$;


COMMIT;


-- ─── F) Optional manual smoke tests ───────────────────────────────────────
-- Run these AFTER the COMMIT succeeds to confirm the functions return
-- sensible values to a real authenticated caller (not just exist in
-- pg_proc). Both should return FALSE for unknown emails, NOT 404.
-- Uncomment and run as a separate query.
--
-- SELECT public.is_driver_subscribed('nonexistent@example.com');
-- SELECT public.is_passenger_verified('nonexistent@example.com');
--
-- For app_name verification (every row should be 'مشوارو', or NULL/empty):
-- SELECT id, app_name FROM public.app_settings;
