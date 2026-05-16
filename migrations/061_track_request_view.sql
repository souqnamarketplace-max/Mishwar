-- ============================================================
-- Migration 061: track_request_view RPC
-- ============================================================
--
-- Adds view tracking for trip requests, mirroring the existing
-- track_request_contact pattern from migration 019.
--
-- Context: contact_count was tracked from day one (driver sends a
-- message → counter increments) but view_count was a schema-only
-- field — no RPC was wired up because the previous UX took the
-- driver straight from the request card into chat, so "view" and
-- "contact" were the same event.
--
-- The new UX inserts an intermediate /passenger-requests/:id page
-- where the driver reviews the request before messaging. That gives
-- "view" a distinct meaning ("driver opened the details page") vs
-- "contact" ("driver actually sent a message"), and this RPC + dedup
-- table fills in the gap.
--
-- Dedup: one view per (request, driver). Same approach as
-- trip_request_contacts so the analytics number reflects unique
-- interested drivers rather than refresh-spam.
-- ============================================================

-- ─── Dedup table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trip_request_views (
  request_id   UUID NOT NULL REFERENCES public.trip_requests(id) ON DELETE CASCADE,
  driver_email TEXT NOT NULL,
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, driver_email)
);

-- Help dashboard queries that aggregate "which drivers viewed X requests"
CREATE INDEX IF NOT EXISTS trip_request_views_driver_idx
  ON public.trip_request_views (driver_email);

-- RLS: drivers can only see their OWN view rows. They can't peek at who
-- else viewed a given request. Passengers don't read this table at all;
-- they see the aggregated view_count on trip_requests instead.
ALTER TABLE public.trip_request_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_request_views_select_own ON public.trip_request_views;
CREATE POLICY trip_request_views_select_own
  ON public.trip_request_views
  FOR SELECT
  TO authenticated
  USING (driver_email = public.auth_user_email());

-- No INSERT/UPDATE/DELETE policy — only the SECURITY DEFINER RPC
-- below should write here, so the client can never insert arbitrary
-- (request_id, driver_email) rows.

-- ─── The RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.track_request_view(p_request_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email     TEXT := public.auth_user_email();
  v_owner     TEXT;
  v_inserted  BIGINT;
BEGIN
  IF v_email IS NULL THEN RETURN; END IF;

  -- Don't count the passenger viewing their own request.
  -- Cheap guard before the INSERT.
  SELECT passenger_email INTO v_owner
  FROM public.trip_requests
  WHERE id = p_request_id;

  IF v_owner IS NULL THEN RETURN; END IF;       -- request doesn't exist
  IF v_owner = v_email THEN RETURN; END IF;     -- self-view, no-op

  INSERT INTO public.trip_request_views (request_id, driver_email)
  VALUES (p_request_id, v_email)
  ON CONFLICT (request_id, driver_email) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Only increment view_count on the FIRST view by this driver — the
  -- ON CONFLICT clause turns subsequent views into a no-op so the
  -- counter reflects unique interested drivers, not raw page hits.
  IF v_inserted > 0 THEN
    UPDATE public.trip_requests
    SET view_count = COALESCE(view_count, 0) + 1
    WHERE id = p_request_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.track_request_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_request_view(UUID) TO authenticated;
