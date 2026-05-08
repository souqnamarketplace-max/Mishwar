-- =============================================================================
-- Migration 016 — Admin manual email confirmation
-- =============================================================================
--
-- WHY: Some Palestinian users register but never receive the confirmation
-- email — common causes are spam filtering, ISP-level blocking of
-- transactional senders, or Supabase's auth tier rate-limiting emails to
-- 3-4/hour. They're left unable to log in despite having registered
-- successfully.
--
-- This migration adds an admin-only RPC that lets the admin manually mark
-- an unconfirmed user as confirmed, after verifying their identity through
-- another channel (phone call, WhatsApp, in-person).
--
-- The RPC writes to auth.users.email_confirmed_at directly, which is the
-- same field Supabase sets when a user clicks a confirmation link. After
-- the call, the user can immediately log in.
--
-- Security:
--   - SECURITY DEFINER so it can write to auth.users (which is normally
--     locked down)
--   - Verifies caller is admin via profiles.role = 'admin'
--   - Logs the action in admin_audit_log for accountability
--   - Cannot be used to confirm an already-confirmed user (idempotent
--     no-op)
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_confirm_user_email(p_user_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_admin_email TEXT;
  v_is_admin    BOOLEAN;
  v_user_id     UUID;
  v_was_confirmed BOOLEAN;
BEGIN
  v_admin_email := auth.email();
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  IF p_user_email IS NULL OR length(trim(p_user_email)) = 0 THEN
    RAISE EXCEPTION 'email required';
  END IF;

  -- Find the user. Returns NULL if no such user exists.
  SELECT id, (email_confirmed_at IS NOT NULL OR confirmed_at IS NOT NULL)
    INTO v_user_id, v_was_confirmed
  FROM auth.users
  WHERE lower(email) = lower(trim(p_user_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'user_not_found'
    );
  END IF;

  IF v_was_confirmed THEN
    -- Idempotent — return success but flag that no change was made
    RETURN jsonb_build_object(
      'success',          true,
      'already_confirmed', true,
      'user_id',          v_user_id
    );
  END IF;

  -- Confirm the email. Setting email_confirmed_at is what unblocks login.
  -- We do NOT touch confirmed_at — in current Supabase versions it's a
  -- GENERATED column (computed from email_confirmed_at and phone_confirmed_at)
  -- and writing to it raises 428C9 "can only be updated to DEFAULT".
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
  WHERE id = v_user_id;

  -- Audit trail — admin actions on user accounts must always be loggable
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, details)
  VALUES (
    v_admin_email,
    'admin_confirm_user_email',
    'user',
    v_user_id::text,
    jsonb_build_object('user_email', p_user_email)
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'confirmed_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_confirm_user_email(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_user_email(TEXT) TO authenticated;

COMMIT;

-- =============================================================================
-- Verification (run as admin):
--   SELECT public.admin_confirm_user_email('test@example.com');
--   Expected: {"success":true,"user_id":"...","confirmed_at":"..."}
--
--   SELECT public.admin_confirm_user_email('test@example.com');
--   Expected: {"success":true,"already_confirmed":true,"user_id":"..."}
--
--   SELECT public.admin_confirm_user_email('nonexistent@example.com');
--   Expected: {"success":false,"reason":"user_not_found"}
-- =============================================================================

-- =============================================================================
-- Bonus: emails_confirmation_status RPC
-- =============================================================================
--
-- Returns confirmation status for a batch of emails. Used by the admin
-- DashboardUsers page to show a yellow warning + "confirm manually"
-- button next to unconfirmed users.
--
-- Read-only, admin-only via the admin role check. Returns a list of
-- (email, confirmed) rows.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.emails_confirmation_status(p_emails TEXT[])
RETURNS TABLE (
  email     TEXT,
  confirmed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
STABLE
AS $$
DECLARE
  v_admin_email TEXT;
  v_is_admin    BOOLEAN;
BEGIN
  v_admin_email := auth.email();
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      lower(u.email)::TEXT AS email,
      (u.email_confirmed_at IS NOT NULL OR u.confirmed_at IS NOT NULL) AS confirmed
    FROM auth.users u
    WHERE lower(u.email) = ANY (
      SELECT lower(unnest(p_emails))
    );
END $$;

REVOKE ALL ON FUNCTION public.emails_confirmation_status(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emails_confirmation_status(TEXT[]) TO authenticated;

COMMIT;
