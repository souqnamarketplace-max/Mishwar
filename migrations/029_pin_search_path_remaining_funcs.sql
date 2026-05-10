-- =============================================================================
-- Migration 029 — pin search_path on remaining SECURITY DEFINER + plpgsql funcs
-- =============================================================================
--
-- BACKGROUND
--
-- Migration 026 pinned search_path on auth_user_email() and auth_user_role()
-- — the trust root. The Supabase database advisor's
-- function_search_path_mutable lint flagged 22 ADDITIONAL functions still
-- without an explicit search_path setting. Most are utility/trigger functions
-- created over time without the hardening (handle_new_user, set_updated_at,
-- guard_*, dashboard_metrics, etc.).
--
-- WHY THIS MATTERS (defense-in-depth)
--
-- A SECURITY DEFINER function without explicit search_path resolves
-- unqualified table/function references against whatever search_path the
-- caller has set. In a normal Supabase deployment authenticated users
-- can't CREATE FUNCTION in public, so the practical attack surface is
-- ~zero. But:
--   - Future role grants could change that
--   - Logical-replication and migration tooling sometimes runs in unusual
--     search_path contexts
--   - It's a free fix once you know the function exists
--
-- All 22 functions are pinned to the standard:
--   search_path = public, pg_catalog, auth
-- which matches every other SECURITY DEFINER function shipped in earlier
-- migrations.
--
-- TECHNIQUE
--
-- We don't have the source-of-truth signatures for several of these
-- functions (some were created via dashboard, e.g. dashboard_metrics).
-- ALTER FUNCTION requires the full signature including arg types. So we
-- iterate pg_proc to discover each function's actual signature and ALTER
-- by oid — works regardless of how arguments are typed.
--
-- COMPATIBILITY
--
-- - Function bodies unchanged. Only the per-function search_path setting.
-- - Idempotent: re-running this migration is a no-op (ALTER ... SET
--   replaces the prior SET cleanly).
-- - If a function in the list doesn't exist on this DB (e.g., the
--   advisor's report is stale), we skip it with a NOTICE rather than
--   failing the whole migration.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  fn_name TEXT;
  fn      RECORD;
  pinned  INTEGER := 0;
  missing INTEGER := 0;
  failed  INTEGER := 0;
BEGIN
  FOR fn_name IN SELECT unnest(ARRAY[
    'cleanup_old_login_attempts',
    'contains_inappropriate_content',
    'moderate_trip_notes',
    'update_updated_at',
    'dashboard_metrics',
    'handle_new_user',
    'check_booking_rate_limit',
    'process_booking_payment',           -- has 2 overloads; loop handles both
    'notify_passengers_trip_started',
    'dashboard_timeseries',
    'set_updated_at',
    'compute_request_expiry',
    'sync_trip_driver_info',
    'trip_starttime_tz',
    'trip_window',
    'check_driver_trip_conflict',
    'check_passenger_booking_conflict',
    'auth_email',
    'touch_updated_at',
    'generate_trip_short_code',
    'trips_assign_short_code'
  ])
  LOOP
    -- Find every overload of this function name in the public schema.
    -- pg_get_function_identity_arguments(oid) returns the args in the
    -- exact form ALTER FUNCTION wants ("p_email text" etc.).
    FOR fn IN
      SELECT
        p.oid,
        p.proname,
        pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = fn_name
    LOOP
      BEGIN
        EXECUTE format(
          'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog, auth',
          fn.proname, fn.args
        );
        pinned := pinned + 1;
        RAISE NOTICE '  pinned: public.%(%)', fn.proname, fn.args;
      EXCEPTION WHEN OTHERS THEN
        failed := failed + 1;
        RAISE WARNING '  FAILED to pin public.%(%): %', fn.proname, fn.args, SQLERRM;
      END;
    END LOOP;

    -- If we found zero overloads of this name, log it (advisor list might
    -- be stale, or function was dropped between scan and migration).
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn_name
    ) THEN
      missing := missing + 1;
      RAISE NOTICE '  skip: public.% not found (advisor list may be stale)', fn_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'MIGRATION 029 — pinned=% missing=% failed=%', pinned, missing, failed;

  IF failed = 0 THEN
    RAISE NOTICE 'MIGRATION 029 OK — all discovered functions pinned';
  ELSE
    RAISE WARNING 'MIGRATION 029 — % functions failed to pin (see WARNINGs above)', failed;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION
-- =============================================================================
--
-- 1) Re-run the Supabase database advisor. The
--    function_search_path_mutable warnings for the 22 listed functions
--    should clear (auth_user_email/auth_user_role from migration 026
--    already cleared previously).
--
-- 2) Spot-check a function manually:
--      SELECT proname, proconfig FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
--    proconfig should contain '{search_path=public, pg_catalog, auth}'.
-- =============================================================================
