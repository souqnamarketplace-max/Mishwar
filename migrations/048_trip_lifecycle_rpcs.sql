-- ════════════════════════════════════════════════════════════════════════
-- Migration 048 — Trip lifecycle RPCs: start, complete, change_time
-- ════════════════════════════════════════════════════════════════════════
--
-- CONTEXT
-- Until now, trip lifecycle transitions (confirmed → in_progress →
-- completed) happened via plain `api.entities.Trip.update(id, {status})`
-- which is a direct REST PATCH against /trips. Two problems:
--
--   (1) The current UI has a 'بدء الرحلة' / 'إنهاء الرحلة' button that
--       sets state for a modal that never renders — the trip lifecycle
--       has been entirely unreachable in production. This migration is
--       part of the fix-up that ships alongside building the missing
--       modal.
--
--   (2) Even if the UI worked, a direct PATCH offers no defense against:
--         - drivers starting a trip 3 days early
--         - drivers completing trips that aren't in_progress
--         - someone PATCHing another driver's trip status if RLS has
--           any gap
--       Codifying the rules in SECURITY DEFINER RPCs locks the
--       lifecycle down at the DB layer.
--
-- THE RPCS
--
--   start_trip(p_trip_id)
--     - Caller must own the trip (or be admin)
--     - Trip must be status='confirmed'
--     - Now must be within [departure - 30min, departure + 2h]
--       30 min early: lets driver start at the pickup point a bit
--                     before the listed time (common in carpooling)
--       2 h late: max grace for traffic / driver running behind
--     - Returns the updated trip row
--
--   complete_trip(p_trip_id)
--     - Caller must own the trip (or be admin)
--     - Trip must be status='in_progress'
--     - No time gate — driver completes whenever the ride is done.
--       GPS auto-completion uses this RPC too (via UI change in the
--       same commit).
--     - Returns the updated trip row
--
--   change_trip_time(p_trip_id, p_new_time)
--     - Caller must own the trip (or be admin)
--     - Trip must be status='confirmed' (in-progress trips can't be
--       rescheduled — they're already happening)
--     - Date must not be in the past
--     - |new_time - old_time| ≤ 60 minutes — anything bigger requires
--       cancel & repost so passengers re-opt-in
--     - Notifies every active booking (pending + confirmed) with the
--       new time and link to /my-trips?tab=confirmed where they can
--       cancel if they don't agree
--     - Returns the updated trip row
--
-- IDEMPOTENT — all three use CREATE OR REPLACE.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) start_trip ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_trip(p_trip_id UUID)
RETURNS public.trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_trip            public.trips%ROWTYPE;
  v_email           TEXT    := public.auth_user_email();
  v_role            TEXT    := public.auth_user_role();
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

  -- Time gate. Combine trip.date + trip.time into a single
  -- timestamptz; COALESCE handles legacy rows with NULL time.
  v_departure := v_trip.date::timestamptz + COALESCE(v_trip.time, '00:00'::time);
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


-- ─── (2) complete_trip ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_trip(p_trip_id UUID)
RETURNS public.trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_trip   public.trips%ROWTYPE;
  v_email  TEXT := public.auth_user_email();
  v_role   TEXT := public.auth_user_role();
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip not found';
  END IF;

  IF v_trip.driver_email <> v_email AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'not your trip' USING ERRCODE = '42501';
  END IF;

  IF v_trip.status <> 'in_progress' THEN
    RAISE EXCEPTION 'cannot complete trip from status %', v_trip.status;
  END IF;

  UPDATE public.trips
  SET status     = 'completed',
      updated_at = NOW()
  WHERE id = p_trip_id
  RETURNING * INTO v_trip;

  RETURN v_trip;
END $$;

REVOKE EXECUTE ON FUNCTION public.complete_trip(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.complete_trip(UUID) TO authenticated;


-- ─── (3) change_trip_time ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_trip_time(
  p_trip_id  UUID,
  p_new_time TIME
)
RETURNS public.trips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_trip           public.trips%ROWTYPE;
  v_email          TEXT    := public.auth_user_email();
  v_role           TEXT    := public.auth_user_role();
  v_old_time       TIME;
  v_delta_minutes  INTEGER;
  r                RECORD;
  v_notif_count    INTEGER := 0;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_new_time IS NULL THEN
    RAISE EXCEPTION 'new time is required';
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip not found';
  END IF;

  IF v_trip.driver_email <> v_email AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'not your trip' USING ERRCODE = '42501';
  END IF;

  IF v_trip.status <> 'confirmed' THEN
    RAISE EXCEPTION 'can only change time of confirmed trips (current status: %)', v_trip.status;
  END IF;

  IF v_trip.date < CURRENT_DATE THEN
    RAISE EXCEPTION 'trip date is in the past';
  END IF;

  v_old_time := v_trip.time;

  -- No-op guard: changing to the same time wastes a notification
  -- volley to every passenger.
  IF v_old_time = p_new_time THEN
    RAISE EXCEPTION 'new time is identical to current time';
  END IF;

  -- Delta gate: ≤ 60 minutes either direction. Larger changes force
  -- the driver to cancel & repost so passengers explicitly re-opt-in.
  v_delta_minutes := ABS(EXTRACT(EPOCH FROM (p_new_time - COALESCE(v_old_time, '00:00'::time))) / 60)::INTEGER;

  IF v_delta_minutes > 60 THEN
    RAISE EXCEPTION 'time change too large (% minutes) — must be ≤ 60. For larger reschedules, cancel and repost the trip.', v_delta_minutes;
  END IF;

  -- Apply the change.
  UPDATE public.trips
  SET time       = p_new_time,
      updated_at = NOW()
  WHERE id = p_trip_id
  RETURNING * INTO v_trip;

  -- Notify every active booking. 'Active' = pending OR confirmed —
  -- the time change matters to both because a pending booking may
  -- still get approved and the passenger needs to know the new
  -- departure. Cancelled/completed bookings skip (settled state).
  FOR r IN
    SELECT DISTINCT passenger_email
    FROM public.bookings
    WHERE trip_id = p_trip_id::text
      AND status IN ('pending', 'confirmed')
      AND passenger_email IS NOT NULL
  LOOP
    BEGIN
      INSERT INTO public.notifications (
        user_email, title, message, type, trip_id, link
      ) VALUES (
        r.passenger_email,
        'تغيّر موعد رحلتك ⏰',
        'قام السائق بتعديل موعد رحلة ' || v_trip.from_city || ' ← ' || v_trip.to_city ||
          ' بتاريخ ' || v_trip.date::text ||
          '. الموعد الجديد: الساعة ' || to_char(p_new_time, 'HH24:MI') ||
          ' (بدلاً من ' || to_char(COALESCE(v_old_time, '00:00'::time), 'HH24:MI') || ').' ||
          ' إذا كان الموعد الجديد لا يناسبك، يمكنك إلغاء الحجز من قائمة "رحلاتي".',
        'system',
        p_trip_id::text,
        '/my-trips?tab=confirmed'
      );
      v_notif_count := v_notif_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One bad row shouldn't abort the whole batch.
      RAISE NOTICE 'change_trip_time: notify skip for % — %', r.passenger_email, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'change_trip_time: notified % passengers of new time for trip %', v_notif_count, p_trip_id;

  RETURN v_trip;
END $$;

REVOKE EXECUTE ON FUNCTION public.change_trip_time(UUID, TIME) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.change_trip_time(UUID, TIME) TO authenticated;


-- ─── Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_start_ok    BOOLEAN;
  v_complete_ok BOOLEAN;
  v_change_ok   BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'start_trip'
  ) INTO v_start_ok;
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_trip'
  ) INTO v_complete_ok;
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'change_trip_time'
  ) INTO v_change_ok;

  IF NOT v_start_ok    THEN RAISE EXCEPTION 'MIGRATION 048 FAILED: start_trip missing'; END IF;
  IF NOT v_complete_ok THEN RAISE EXCEPTION 'MIGRATION 048 FAILED: complete_trip missing'; END IF;
  IF NOT v_change_ok   THEN RAISE EXCEPTION 'MIGRATION 048 FAILED: change_trip_time missing'; END IF;

  RAISE NOTICE 'MIGRATION 048 OK — trip lifecycle RPCs installed';
END $$;
