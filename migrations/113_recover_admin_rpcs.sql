-- Migration 113: Recover 5 admin RPCs that existed in DB but had no migration file
-- Applied: 2026-05-29
-- These RPCs were created in earlier sessions but never committed to migrations/.
-- Recovering them here for version control completeness.
--
-- Skipping: driver_payments_summary (in migration 110)
--           activity_log (recovered separately - too large, see 114)
--           audit_log_search, audit_log_facets (recovered in 115)

-- emails_confirmation_status: used by DashboardUsers to show email confirmation state
CREATE OR REPLACE FUNCTION public.emails_confirmation_status(p_emails text[])
RETURNS TABLE(email text, confirmed boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_catalog'
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

-- broadcast_notification: bulk insert notification to all users
CREATE OR REPLACE FUNCTION public.broadcast_notification(title_text text, message_text text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_admin_email TEXT := public.auth_user_email();
  v_is_admin    BOOLEAN;
  v_inserted    INTEGER;
BEGIN
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'only admins can broadcast notifications' USING ERRCODE = '42501';
  END IF;

  IF title_text IS NULL OR TRIM(title_text) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF message_text IS NULL OR TRIM(message_text) = '' THEN
    RAISE EXCEPTION 'message is required';
  END IF;

  INSERT INTO public.notifications (user_email, title, message, type, is_read)
  SELECT p.email, title_text, message_text, 'admin_broadcast', FALSE
  FROM public.profiles p
  WHERE p.email IS NOT NULL
    AND p.email <> v_admin_email
    AND COALESCE(p.full_name, '') <> 'حساب محذوف';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_notification(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_notification(text,text) TO authenticated;
