-- Migration 106: Revoke broadcast_notification from anon/authenticated
-- Applied: 2026-05-28
-- broadcast_notification was superseded by admin_send_broadcast (which has
-- proper admin gate). The old RPC was callable by any authenticated user —
-- a security gap. Restricted to service_role only.
REVOKE EXECUTE ON FUNCTION public.broadcast_notification(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.broadcast_notification(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_notification(TEXT, TEXT) TO service_role;
