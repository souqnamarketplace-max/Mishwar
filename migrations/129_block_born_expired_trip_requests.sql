-- Migration 129 — block "born expired" trip requests
-- (applied to production DB 2026-06-12 via Supabase MCP)
--
-- Root cause of "requests disappearing before expiry": passengers could
-- create a request for today + a time slot that had already passed in
-- Palestine time. compute_request_expiry returned a past expires_at,
-- and the expire-stale-requests cron swept the row within 30 minutes.
-- 7 of 12 historical expirations fit this pattern.
--
-- Fixes inside submit_trip_request:
--   1. Past-date check now uses the PALESTINE calendar date instead of
--      CURRENT_DATE (UTC). Between 00:00-03:00 Asia/Jerusalem, UTC is
--      still "yesterday", which let requests for an already-finished
--      date through (observed: created 01:21 May 31 for May 30).
--   2. New guard after computing expiry: reject when expires_at <= now()
--      with message 'requested time slot already passed' — mapped to
--      Arabic in src/lib/errors.js. Covers past slots and past exact
--      times in one check, on every platform, with no client deploy.
--
-- Client-side counterpart: RequestTrip.jsx same-day Palestine-time
-- validation (develop) gives the friendly inline UX before submission.

CREATE OR REPLACE FUNCTION public.submit_trip_request(
  p_from_city text, p_to_city text, p_requested_date date,
  p_requested_time time without time zone, p_time_flexibility text,
  p_seats_needed integer, p_suggested_price integer,
  p_pickup_details text DEFAULT NULL, p_dropoff_details text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_from_lat numeric DEFAULT NULL, p_from_lng numeric DEFAULT NULL,
  p_to_lat numeric DEFAULT NULL, p_to_lng numeric DEFAULT NULL
)
RETURNS trip_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'auth'
AS $function$
DECLARE
  v_email      TEXT := public.auth_user_email();
  v_name       TEXT;
  v_active_n   INTEGER;
  v_max_active CONSTANT INTEGER := 3;
  v_expiry     TIMESTAMPTZ;
  v_row        public.trip_requests;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_passenger_verified(v_email) THEN
    RAISE EXCEPTION 'passenger not verified' USING ERRCODE = '42501';
  END IF;

  -- Date sanity in PALESTINE time, not UTC
  IF p_requested_date < (now() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'request date is in the past';
  END IF;

  -- Anti-spam: max 3 active requests per passenger
  SELECT COUNT(*) INTO v_active_n
  FROM public.trip_requests
  WHERE passenger_email = v_email
    AND status = 'open';
  IF v_active_n >= v_max_active THEN
    RAISE EXCEPTION 'too many active requests (max %)', v_max_active;
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE email = v_email;
  v_expiry := public.compute_request_expiry(p_requested_date, p_requested_time, p_time_flexibility);

  -- Born-expired guard: the chosen slot/time has already passed
  IF v_expiry <= now() THEN
    RAISE EXCEPTION 'requested time slot already passed';
  END IF;

  INSERT INTO public.trip_requests (
    created_by, passenger_email, passenger_name,
    from_city, to_city, from_lat, from_lng, to_lat, to_lng,
    pickup_details, dropoff_details,
    requested_date, requested_time, time_flexibility, expires_at,
    seats_needed, suggested_price, notes,
    status
  ) VALUES (
    v_email, v_email, COALESCE(v_name, v_email),
    p_from_city, p_to_city, p_from_lat, p_from_lng, p_to_lat, p_to_lng,
    NULLIF(TRIM(p_pickup_details), ''), NULLIF(TRIM(p_dropoff_details), ''),
    p_requested_date, p_requested_time, p_time_flexibility, v_expiry,
    p_seats_needed, p_suggested_price, NULLIF(TRIM(p_notes), ''),
    'open'
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $function$;
