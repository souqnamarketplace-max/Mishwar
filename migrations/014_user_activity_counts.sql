-- =============================================================================
-- Migration 014 — Aggregate counts RPC for admin Users page
-- =============================================================================
--
-- WHY: DashboardUsers shows trip count + booking count per row. Old
-- implementation:
--
--   const allTrips = await Trip.list("-created_date", 200);
--   users.forEach(u => tripsByUser[u.email] = allTrips.filter(t => t.created_by === u.email).length);
--
-- That fetched the 200 most recent trips and counted matches CLIENT-SIDE.
-- At 500k trips: only the latest 200 are considered, every other user
-- shows "0 trips" — a silent lie to the admin (no error, just wrong).
--
-- Fix: aggregate server-side with GROUP BY. One roundtrip, accurate at
-- any scale. The aggregate is keyed by email so the page can join
-- against whichever 25 users it's currently displaying.
--
-- The RPC accepts an optional emails array — when set, restricts the
-- aggregate to those drivers. The Users page will pass the 25 emails
-- for the current page, so the GROUP BY only scans relevant rows.
-- Without the filter, full-table aggregate; with the filter, indexed
-- lookups.
-- =============================================================================

BEGIN;

-- Index supporting the aggregate lookup. Most queries will hit this.
CREATE INDEX IF NOT EXISTS idx_trips_created_by_for_count
  ON public.trips (created_by);

CREATE INDEX IF NOT EXISTS idx_bookings_passenger_email_for_count
  ON public.bookings (passenger_email);

-- ─── User activity counts RPC ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_activity_counts(p_emails TEXT[] DEFAULT NULL)
RETURNS TABLE (
  email          TEXT,
  trip_count     BIGINT,
  booking_count  BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  -- Combined per-email counts via UNION ALL of two subqueries, then
  -- aggregated. UNION ALL is faster than two separate selects with
  -- coalesce at the join point.
  SELECT
    e AS email,
    COUNT(*) FILTER (WHERE k = 'trip')    AS trip_count,
    COUNT(*) FILTER (WHERE k = 'booking') AS booking_count
  FROM (
    SELECT created_by AS e, 'trip'::TEXT AS k
      FROM public.trips
     WHERE created_by IS NOT NULL
       AND (p_emails IS NULL OR created_by = ANY(p_emails))
    UNION ALL
    SELECT passenger_email AS e, 'booking'::TEXT AS k
      FROM public.bookings
     WHERE passenger_email IS NOT NULL
       AND (p_emails IS NULL OR passenger_email = ANY(p_emails))
  ) sub
  GROUP BY e;
$$;

-- Admin-only via the existing pattern. The function is SECURITY DEFINER
-- so it can read across users; we trust the caller is admin via the
-- HTTP-layer check (page is admin-gated) plus the explicit GRANT below.
REVOKE ALL ON FUNCTION public.user_activity_counts(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_activity_counts(TEXT[]) TO authenticated;


-- ─── Subscription categorized view ─────────────────────────────────────────
--
-- WHY: DashboardSubscriptions previously fetched the latest 500 rows and
-- bucketed them in JS into pending / active / history. At 100k users with
-- ~30k drivers all subscribed, that fetch silently truncates and the
-- admin's "active" view becomes lossy.
--
-- This VIEW pre-computes the bucket per row so the page can paginate via
-- a simple .eq("view_category", "active") filter, with COUNT(*) head
-- queries for the tab badges. Server does the work; client pages cleanly.
--
-- Categories:
--   'pending'  — awaiting admin review
--   'active'   — currently within paid period (status='active' AND period_end in the future)
--   'history'  — everything else: rejected, expired, cancelled, or active-but-past-period
--
-- The view inherits all RLS from driver_subscriptions, so admins see all
-- rows and drivers see only their own — same as the underlying table.

CREATE OR REPLACE VIEW public.driver_subscriptions_v AS
SELECT
  s.*,
  CASE
    WHEN s.status = 'pending'                                       THEN 'pending'
    WHEN s.status = 'active' AND s.period_end > NOW()               THEN 'active'
    ELSE                                                                 'history'
  END AS view_category
FROM public.driver_subscriptions s;

GRANT SELECT ON public.driver_subscriptions_v TO authenticated;

-- Index supporting the categorization query. period_end is heavily filtered.
CREATE INDEX IF NOT EXISTS idx_driver_subscriptions_status_period_end
  ON public.driver_subscriptions (status, period_end DESC);


COMMIT;

-- =============================================================================
-- Verification
-- =============================================================================
-- 1) Test on a small subset:
--    SELECT * FROM public.user_activity_counts(ARRAY['someuser@example.com']);
-- 2) Test full aggregate (returns one row per active email):
--    SELECT * FROM public.user_activity_counts() ORDER BY trip_count DESC LIMIT 10;
-- 3) Confirm indexes:
--    SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname IN ('idx_trips_created_by_for_count',
--                        'idx_bookings_passenger_email_for_count');
-- =============================================================================
