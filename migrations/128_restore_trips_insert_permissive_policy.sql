-- Migration 128 — restore permissive INSERT policy on trips
-- (applied to production DB 2026-06-12 via Supabase MCP)
--
-- Migration 127's policy de-duplication dropped the PERMISSIVE INSERT
-- policy on trips, leaving only the RESTRICTIVE onboarding policy
-- (trips_require_onboarded_insert). Postgres RLS denies a command
-- entirely when it has restrictive policies but zero permissive ones —
-- so ALL trip inserts failed for everyone (drivers and admins) with
-- "ليس لديك صلاحية لهذه العملية".
--
-- LESSON: when consolidating RLS policies, every command needs at
-- least one PERMISSIVE policy to grant access; RESTRICTIVE policies
-- only narrow what permissive ones allow.

CREATE POLICY trips_insert_driver ON public.trips
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    driver_email = auth_user_email()
    OR auth_user_role() = 'admin'
  );
