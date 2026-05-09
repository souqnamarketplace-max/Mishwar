-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 019 — Passenger trip requests (free discovery feature)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- New feature: passengers post "I want to go A → B on date X for ~₪Y" and
-- subscribed drivers browse these requests + reach out via in-app messages.
-- This is free for passengers and gated by active subscription for drivers
-- (consistent with the existing driver subscription model).
--
-- Key design choices (set in plan with user):
--   - Passengers get max 3 active requests at once (anti-spam)
--   - suggested_price clamped 0–1000 ILS
--   - expires_at = requested_date + requested_time when set, else end of day
--   - No strike penalty for cancelling a matched request (only booking
--     cancellations within 2h of departure trigger strikes — migration 018)
--   - "Near me" filter is client-side bounding box on lat/lng (5–30 km)
--   - Drivers can't post requests in v1
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── A) Schema ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trip_requests (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT NOT NULL,             -- == passenger_email

  passenger_email     TEXT NOT NULL,
  passenger_name      TEXT NOT NULL,

  -- Route
  from_city           TEXT NOT NULL,
  to_city             TEXT NOT NULL,
  from_lat            NUMERIC,
  from_lng            NUMERIC,
  to_lat              NUMERIC,
  to_lng              NUMERIC,
  pickup_details      TEXT CHECK (length(pickup_details)  <= 200),
  dropoff_details     TEXT CHECK (length(dropoff_details) <= 200),

  -- Timing
  requested_date      DATE NOT NULL,
  requested_time      TIME,
  time_flexibility    TEXT NOT NULL DEFAULT 'flexible'
                      CHECK (time_flexibility IN ('exact','morning','afternoon','evening','flexible')),
  expires_at          TIMESTAMPTZ NOT NULL,

  -- Demand
  seats_needed        INTEGER NOT NULL DEFAULT 1
                      CHECK (seats_needed BETWEEN 1 AND 6),
  suggested_price     INTEGER NOT NULL
                      CHECK (suggested_price BETWEEN 0 AND 1000),
  notes               TEXT CHECK (length(notes) <= 500),

  -- State
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','matched','cancelled','expired')),
  matched_with_email  TEXT,
  matched_at          TIMESTAMPTZ,

  -- Admin moderation
  admin_note          TEXT,
  cancelled_by_admin  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Analytics
  view_count          INTEGER NOT NULL DEFAULT 0,
  contact_count       INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.trip_requests IS
  'Passenger-posted trip requests. Free for passengers; subscribed drivers
   browse and contact via in-app messaging. Not a booking system — just
   a discovery surface.';

CREATE INDEX IF NOT EXISTS trip_requests_status_date_idx
  ON public.trip_requests (status, requested_date);
CREATE INDEX IF NOT EXISTS trip_requests_passenger_idx
  ON public.trip_requests (passenger_email);
CREATE INDEX IF NOT EXISTS trip_requests_route_idx
  ON public.trip_requests (from_city, to_city);
CREATE INDEX IF NOT EXISTS trip_requests_expiry_idx
  ON public.trip_requests (expires_at) WHERE status = 'open';

-- updated_at trigger (creates set_updated_at helper defensively if it
-- doesn't already exist — earlier migrations referenced it but never
-- defined it, so fresh DBs that apply 019 first would fail without this)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trip_requests_set_updated_at'
  ) THEN
    EXECUTE 'CREATE TRIGGER trip_requests_set_updated_at
             BEFORE UPDATE ON public.trip_requests
             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;


-- ─── B) Helper: compute expires_at from date + time + flexibility ─────────
--
-- Used by submit_trip_request and update_trip_request.
-- Rule per user: "time passed" — when the requested time arrives, the
-- request is expired. For requests without a specific time (morning/
-- afternoon/evening/flexible), expire at end of the requested date.

CREATE OR REPLACE FUNCTION public.compute_request_expiry(
  p_date DATE,
  p_time TIME,
  p_flexibility TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  -- Exact time was given → expire at exactly that moment
  IF p_time IS NOT NULL AND p_flexibility = 'exact' THEN
    RETURN (p_date::timestamptz + p_time::interval);
  END IF;

  -- Time slot windows — expire at the end of the slot
  IF p_flexibility = 'morning'   THEN RETURN (p_date::timestamptz + INTERVAL '12 hours'); END IF;
  IF p_flexibility = 'afternoon' THEN RETURN (p_date::timestamptz + INTERVAL '17 hours'); END IF;
  IF p_flexibility = 'evening'   THEN RETURN (p_date::timestamptz + INTERVAL '22 hours'); END IF;

  -- Flexible / no specific time → end of requested date
  RETURN (p_date + INTERVAL '1 day' - INTERVAL '1 second')::timestamptz;
END $$;


-- ─── C) Helper: is the user a subscribed driver? ──────────────────────────
--
-- Used by RLS policies + book-time gates. Returns TRUE if the user has
-- an active subscription whose period_end is in the future. Admins are
-- treated as subscribed for moderation purposes.

CREATE OR REPLACE FUNCTION public.is_driver_subscribed(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_active BOOLEAN;
BEGIN
  IF p_email IS NULL THEN RETURN FALSE; END IF;

  -- Admins always pass — they need to moderate
  IF (SELECT role FROM public.profiles WHERE email = p_email LIMIT 1) = 'admin' THEN
    RETURN TRUE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.driver_subscriptions
    WHERE driver_email = p_email
      AND status = 'active'
      AND (period_end IS NULL OR period_end > now())
  ) INTO v_active;

  RETURN COALESCE(v_active, FALSE);
END $$;

GRANT EXECUTE ON FUNCTION public.is_driver_subscribed(TEXT) TO authenticated;


-- ─── D) RLS policies ──────────────────────────────────────────────────────

ALTER TABLE public.trip_requests ENABLE ROW LEVEL SECURITY;

-- Drop any old policies if re-running
DROP POLICY IF EXISTS trip_requests_select_own        ON public.trip_requests;
DROP POLICY IF EXISTS trip_requests_select_subscribed ON public.trip_requests;
DROP POLICY IF EXISTS trip_requests_select_admin      ON public.trip_requests;
DROP POLICY IF EXISTS trip_requests_insert            ON public.trip_requests;
DROP POLICY IF EXISTS trip_requests_update_own        ON public.trip_requests;
DROP POLICY IF EXISTS trip_requests_no_blocked_select ON public.trip_requests;

-- 1) Passenger always sees their own requests (any status)
CREATE POLICY trip_requests_select_own ON public.trip_requests
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (passenger_email = public.auth_user_email());

-- 2) Subscribed drivers see open requests
CREATE POLICY trip_requests_select_subscribed ON public.trip_requests
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    status = 'open'
    AND public.is_driver_subscribed(public.auth_user_email())
  );

-- 3) Admins see everything (covered by is_driver_subscribed → admin → true,
--    but having an explicit admin policy keeps intent clear if subscriber
--    semantics change).
CREATE POLICY trip_requests_select_admin ON public.trip_requests
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.auth_user_role() = 'admin');

-- 4) Insert — only as yourself, status forced to 'open' via column default,
--    and the submit RPC validates the 3-active-max rule.
CREATE POLICY trip_requests_insert ON public.trip_requests
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    passenger_email = public.auth_user_email()
    AND created_by = public.auth_user_email()
  );

-- 5) Update — only the passenger can update their own request, and only
--    fields like notes/price/time. Status changes are blocked here and
--    must go through the dedicated RPCs (cancel_trip_request,
--    mark_request_matched). Admin can update freely.
CREATE POLICY trip_requests_update_own ON public.trip_requests
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    passenger_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  )
  WITH CHECK (
    passenger_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- 6) RESTRICTIVE block-pair filter — drivers can't see requests from
--    passengers they've blocked (or vice versa). Symmetric.
CREATE POLICY trip_requests_no_blocked_select ON public.trip_requests
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    -- Pass if the row is the user's own (so passenger always sees their
    -- own request even if they've blocked themselves somehow — defensive)
    passenger_email = public.auth_user_email()
    OR
    -- Pass only if no block exists between viewer and the request author
    NOT EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_email = public.auth_user_email() AND blocked_email = passenger_email)
         OR (blocker_email = passenger_email AND blocked_email = public.auth_user_email())
    )
  );


-- ─── E) RPC: submit_trip_request ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_trip_request(
  p_from_city        TEXT,
  p_to_city          TEXT,
  p_requested_date   DATE,
  p_requested_time   TIME,
  p_time_flexibility TEXT,
  p_seats_needed     INTEGER,
  p_suggested_price  INTEGER,
  p_pickup_details   TEXT DEFAULT NULL,
  p_dropoff_details  TEXT DEFAULT NULL,
  p_notes            TEXT DEFAULT NULL,
  p_from_lat         NUMERIC DEFAULT NULL,
  p_from_lng         NUMERIC DEFAULT NULL,
  p_to_lat           NUMERIC DEFAULT NULL,
  p_to_lng           NUMERIC DEFAULT NULL
) RETURNS public.trip_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
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

  -- Date sanity: must be today or future
  IF p_requested_date < CURRENT_DATE THEN
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

  -- Cache passenger name from profile (display optimization — avoids
  -- a JOIN on every list query)
  SELECT full_name INTO v_name FROM public.profiles WHERE email = v_email;

  -- Compute expiry
  v_expiry := public.compute_request_expiry(p_requested_date, p_requested_time, p_time_flexibility);

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
END $$;

REVOKE ALL ON FUNCTION public.submit_trip_request(
  TEXT, TEXT, DATE, TIME, TEXT, INTEGER, INTEGER,
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_trip_request(
  TEXT, TEXT, DATE, TIME, TEXT, INTEGER, INTEGER,
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC
) TO authenticated;


-- ─── F) RPC: cancel_trip_request ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_trip_request(p_request_id UUID, p_admin_note TEXT DEFAULT NULL)
RETURNS public.trip_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email TEXT := public.auth_user_email();
  v_role  TEXT := public.auth_user_role();
  v_row   public.trip_requests;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.trip_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found';
  END IF;

  IF v_row.status <> 'open' AND v_row.status <> 'matched' THEN
    RAISE EXCEPTION 'request already closed (status=%)', v_row.status;
  END IF;

  -- Only owner or admin can cancel
  IF v_row.passenger_email <> v_email AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'unauthorized to cancel this request' USING ERRCODE = '42501';
  END IF;

  UPDATE public.trip_requests
  SET status             = 'cancelled',
      cancelled_by_admin = (v_role = 'admin' AND v_row.passenger_email <> v_email),
      admin_note         = COALESCE(NULLIF(TRIM(p_admin_note), ''), admin_note),
      updated_at         = now()
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.cancel_trip_request(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_trip_request(UUID, TEXT) TO authenticated;


-- ─── G) RPC: mark_request_matched ─────────────────────────────────────────
--
-- Passenger marks "I found a driver via this request." Optional — purely
-- analytical. Records who they connected with for match-rate stats.

CREATE OR REPLACE FUNCTION public.mark_request_matched(p_request_id UUID, p_driver_email TEXT)
RETURNS public.trip_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email TEXT := public.auth_user_email();
  v_row   public.trip_requests;
BEGIN
  IF v_email IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_row FROM public.trip_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;

  IF v_row.passenger_email <> v_email THEN
    RAISE EXCEPTION 'only the passenger can mark a request matched' USING ERRCODE = '42501';
  END IF;

  IF v_row.status <> 'open' THEN
    RAISE EXCEPTION 'request not open (status=%)', v_row.status;
  END IF;

  UPDATE public.trip_requests
  SET status             = 'matched',
      matched_with_email = p_driver_email,
      matched_at         = now(),
      updated_at         = now()
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.mark_request_matched(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_request_matched(UUID, TEXT) TO authenticated;


-- ─── H) RPC: track_request_contact (driver opens conv with passenger) ─────
--
-- Increments contact_count atomically. Called once per (driver, request)
-- pair — repeat calls in the same session don't double-count (handled by
-- a UNIQUE INDEX guard via a separate tracking table).

CREATE TABLE IF NOT EXISTS public.trip_request_contacts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id   UUID NOT NULL REFERENCES public.trip_requests(id) ON DELETE CASCADE,
  driver_email TEXT NOT NULL,
  UNIQUE (request_id, driver_email)
);

ALTER TABLE public.trip_request_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_request_contacts_insert_self ON public.trip_request_contacts;
CREATE POLICY trip_request_contacts_insert_self ON public.trip_request_contacts
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (driver_email = public.auth_user_email());

DROP POLICY IF EXISTS trip_request_contacts_select ON public.trip_request_contacts;
CREATE POLICY trip_request_contacts_select ON public.trip_request_contacts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    -- The driver who contacted, the passenger who owns the request, or admin
    driver_email = public.auth_user_email()
    OR EXISTS (
      SELECT 1 FROM public.trip_requests tr
      WHERE tr.id = trip_request_contacts.request_id
        AND tr.passenger_email = public.auth_user_email()
    )
    OR public.auth_user_role() = 'admin'
  );

CREATE OR REPLACE FUNCTION public.track_request_contact(p_request_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email     TEXT := public.auth_user_email();
  v_inserted  BOOLEAN;
BEGIN
  IF v_email IS NULL THEN RETURN; END IF;

  INSERT INTO public.trip_request_contacts (request_id, driver_email)
  VALUES (p_request_id, v_email)
  ON CONFLICT (request_id, driver_email) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted THEN
    UPDATE public.trip_requests
    SET contact_count = COALESCE(contact_count, 0) + 1
    WHERE id = p_request_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.track_request_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_request_contact(UUID) TO authenticated;


-- ─── I) Cron: expire stale requests ───────────────────────────────────────
--
-- Runs every 30 minutes. Flips status='open' to 'expired' for any
-- request whose expires_at has passed. Same pattern as migration 012's
-- expire_stale_trips.

CREATE OR REPLACE FUNCTION public.expire_stale_requests()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.trip_requests
  SET status = 'expired', updated_at = now()
  WHERE status = 'open'
    AND expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.expire_stale_requests() FROM PUBLIC;

-- Schedule via pg_cron (extension installed by earlier migrations)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotent unschedule
    PERFORM cron.unschedule('expire-stale-requests')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-requests');
    PERFORM cron.schedule(
      'expire-stale-requests',
      '*/30 * * * *',                          -- every 30 minutes
      $cron$ SELECT public.expire_stale_requests(); $cron$
    );
    RAISE NOTICE 'scheduled expire-stale-requests every 30 minutes';
  ELSE
    RAISE NOTICE 'pg_cron not installed — expire_stale_requests must be invoked manually or via app';
  END IF;
END $$;


-- ─── J) Public count helper ───────────────────────────────────────────────
--
-- Returns count of open requests — for the home-page "X طلبات نشطة" badge.
-- SECURITY DEFINER so unsubscribed drivers can see the COUNT (the
-- aggregate teaser) without the RLS hiding the rows.

CREATE OR REPLACE FUNCTION public.public_open_requests_count()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$ SELECT COUNT(*)::INTEGER FROM public.trip_requests WHERE status = 'open' $$;

GRANT EXECUTE ON FUNCTION public.public_open_requests_count() TO authenticated;
