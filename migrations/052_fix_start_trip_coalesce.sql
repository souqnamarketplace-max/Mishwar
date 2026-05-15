-- ════════════════════════════════════════════════════════════════════
-- Migration 052 — fix start_trip COALESCE type mismatch
-- ════════════════════════════════════════════════════════════════════
--
-- BUG
--   The start_trip RPC (migration 048) raised:
--     "COALESCE types text and time without time zone cannot be matched"
--   whenever a driver tapped "بدء الرحلة" on any trip whose
--   `trips.time` column was non-null. Production toast surface:
--   "فشل تحديث الرحلة: COALESCE types text and time without time zone
--    cannot be matched".
--
-- ROOT CAUSE
--   trips.time is declared as TEXT (base44 SDK default at table
--   creation, before any of our migrations touched the column type).
--   The old expression
--       v_trip.date::timestamptz + COALESCE(v_trip.time, '00:00'::time)
--   passes the raw text value as the first COALESCE arg and a
--   time-typed literal as the second. Postgres tries to unify the two
--   types at parse time (COALESCE return type must be a single type)
--   and can't — there's no implicit cast from text to time in
--   expression context, only in assignment context. Hence the error.
--
--   Two additional issues in the same expression that this migration
--   also fixes:
--     1. `timestamptz + time` is not a documented Postgres operator.
--        `date + time = timestamp` IS documented and that's what we
--        want. The previous version cast date → timestamptz first,
--        which would have failed even if the COALESCE compiled.
--     2. trips.time may be the empty string "" (CreateTrip's form
--        default before the driver picks a time). "":time would
--        throw "invalid input syntax for type time: ''". NULLIF
--        normalises empty strings to NULL so COALESCE can fall
--        through to the default.
--
-- IMPACT BEFORE FIX
--   Every driver who tapped "بدء الرحلة" got the toast and could not
--   transition any trip from confirmed → in_progress through the UI.
--   The change_trip_time RPC (also in migration 048) used the same
--   COALESCE shape at line 229, but its v_old_time variable was
--   declared TIME, so the assignment v_old_time := v_trip.time did
--   the text→time cast in assignment context (which IS allowed) and
--   only the now-TIME-typed v_old_time hit COALESCE — explaining
--   why time-change still worked while start-trip didn't.
--
-- LATENT (not fixed here) — timezone interpretation
--   v_trip.date is interpreted at the server's TimeZone setting,
--   which is typically UTC. Drivers are in Asia/Hebron (UTC+2/+3).
--   A trip at 21:23 stored as the literal "21:23" Palestine time
--   ends up being compared to NOW() as if it were 21:23 UTC,
--   off by 2-3 hours. The 30-minute "too early" and 120-minute
--   "too late" gates are therefore shifted in time. Fixing this
--   requires confirming the intended semantics (does the driver
--   mean Palestine local or naive?) and changing the comparison
--   accordingly. Flagged for follow-up; not in this hotfix's scope
--   since it would change the gate behaviour for every trip.
--
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.start_trip(p_trip_id UUID)
RETURNS public.trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_trip            public.trips%ROWTYPE;
  v_email           TEXT    := public.auth_user_email();
  v_role           TEXT    := public.auth_user_role();
  v_departure       TIMESTAMPTZ;
  v_minutes_diff    INTEGER;  -- positive = departure in future, negative = past
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Lock the trip row so concurrent calls (e.g. double-tap on slow
  -- network) serialise.
  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip not found';
  END IF;

  -- Ownership: only the trip's driver, or an admin, can start it.
  IF v_trip.driver_email <> v_email AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'not your trip' USING ERRCODE = '42501';
  END IF;

  -- Status precondition: only confirmed trips can be started.
  IF v_trip.status <> 'confirmed' THEN
    RAISE EXCEPTION 'cannot start trip from status %', v_trip.status;
  END IF;

  -- Time gate.
  -- Three things to handle in one expression:
  --   1. v_trip.time is TEXT in the DB — cast to TIME explicitly so
  --      COALESCE can resolve its return type to TIME at parse time
  --      (the parser doesn't apply implicit text→time cast inside
  --      expression context, only in assignment context).
  --   2. v_trip.time may be the empty string '' (CreateTrip's form
  --      default before the driver picked a time). NULLIF normalises
  --      '' to NULL so the cast doesn't choke on invalid syntax.
  --   3. date + time produces TIMESTAMP. Assignment to TIMESTAMPTZ
  --      v_departure does the implicit cast at the server's
  --      TimeZone setting.
  v_departure := v_trip.date + COALESCE(NULLIF(v_trip.time, '')::time, '00:00'::time);
  v_minutes_diff := EXTRACT(EPOCH FROM (v_departure - NOW())) / 60;

  IF v_minutes_diff > 30 THEN
    RAISE EXCEPTION 'too early — departure is in % minutes, you can start within 30 minutes of departure', v_minutes_diff;
  END IF;

  IF v_minutes_diff < -120 THEN
    RAISE EXCEPTION 'too late — departure was % minutes ago. Cancel or contact support', ABS(v_minutes_diff);
  END IF;

  -- All checks pass — flip the status.
  UPDATE public.trips
  SET status     = 'in_progress',
      updated_at = NOW()
  WHERE id = p_trip_id
  RETURNING * INTO v_trip;

  RETURN v_trip;
END $$;

REVOKE EXECUTE ON FUNCTION public.start_trip(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_trip(UUID) TO authenticated;
