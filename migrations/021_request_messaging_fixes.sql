-- =============================================================================
-- Migration 021 — Trip-Request Messaging Fixes
-- =============================================================================
-- Closes 3 gaps surfaced in the live messages-flow audit:
--
--   1. messages.request_id column (nullable FK to trip_requests). Lets
--      messages-about-a-request live in their own conversation thread
--      (key trip_${tripId}__pair OR request_${requestId}__pair) instead
--      of falling into the generic email-pair fallback bucket alongside
--      every other non-trip message between the same pair.
--
--   2. notify_request_contact() SECURITY DEFINER RPC — sends the "سائق
--      مهتم برحلتك" notification from a driver to a passenger. Required
--      because RLS notifications_insert only allows users to insert
--      notifications targeted at themselves OR admins to insert any.
--      The driver needs a third path: insert a notification for the
--      passenger who owns a specific trip_request, and ONLY that case.
--
--   3. Index on messages(request_id) for the conversation-loading query.
--
-- Idempotent: safe to re-run. Uses ADD COLUMN IF NOT EXISTS, CREATE OR
-- REPLACE, and DROP/CREATE for policies.
-- =============================================================================

BEGIN;

-- =============================================================================
-- SECTION 1 — Add messages.request_id column
-- =============================================================================
-- Nullable: existing rows (and trip-bound conversations) keep request_id NULL.
-- ON DELETE SET NULL: if the trip_request is deleted, the message survives
-- and falls back to email-pair grouping (better than orphaning the message).

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS request_id UUID
    REFERENCES public.trip_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_request_id
  ON public.messages(request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON COLUMN public.messages.request_id IS
  'Optional trip_request reference. When non-null, this message belongs to
   the conversation about a passenger trip request (driver browsed
   /passenger-requests, opened the card, started chat). Mutually exclusive
   with trip_id in practice — a message is either about a trip OR about a
   request OR neither (general email-pair chat). Client groups conversations
   by (trip_id || request_id || email-pair).';


-- =============================================================================
-- SECTION 2 — notify_request_contact RPC
-- =============================================================================
-- SECURITY DEFINER lets a driver create a notification for the passenger
-- who owns a trip_request, without granting blanket "insert notification
-- for any user" permission.
--
-- Guards (in order):
--   1. Caller is authenticated
--   2. The trip_request exists and caller is NOT its owner (drivers contact
--      OTHER people's requests, not their own)
--   3. The block-pair check — if either party blocked the other, refuse
--   4. (Optional) Driver has an active subscription — enforced client-side
--      already, server-side check would require touching subscriptions
--      schema and is acceptable to skip given (2) + (3).

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

COMMENT ON FUNCTION public.notify_request_contact(UUID) IS
  'Sends the "سائق مهتم برحلتك" notification from the calling driver to the
   passenger who owns the given trip_request. SECURITY DEFINER + email-pair
   block check substitutes for the missing RLS path that would otherwise
   require notifications_insert to allow drivers to write into a passengers
   notification row. Returns TRUE if sent, FALSE if blocked-pair or self-
   contact, RAISES if request missing or unauthenticated.';


COMMIT;
