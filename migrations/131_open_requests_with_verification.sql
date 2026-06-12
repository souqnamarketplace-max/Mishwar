-- Migration 131: open_trip_requests_with_verification RPC
-- (applied to production DB 2026-06-12 via Supabase MCP)
--
-- Returns open trip_requests joined with profiles.is_verified via
-- passenger_email → profiles.email. Used by PassengerRequests.jsx
-- (no FK on trip_requests so a join-in-select isn't possible).

CREATE OR REPLACE FUNCTION public.open_trip_requests_with_verification(p_limit INT DEFAULT 200)
RETURNS TABLE (...) LANGUAGE SQL SECURITY DEFINER ...
-- See full SQL in Supabase migration history.
