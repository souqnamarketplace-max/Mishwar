-- ════════════════════════════════════════════════════════════════════════
-- Migration 056 — Performance indexes for hot read paths
-- ════════════════════════════════════════════════════════════════════════
--
-- CONTEXT
-- Pre-launch load-readiness audit identified four queries that run on
-- every page load but have no matching index, so each one does a
-- sequential scan of its parent table. At low row counts (today) this
-- is invisible; at ~10k rows + ~100 concurrent users it becomes the
-- single biggest bottleneck on the platform.
--
-- The four queries:
--
--   1. SearchTrips — src/pages/SearchTrips.jsx
--        SELECT * FROM trips
--        WHERE status IN ('confirmed','in_progress')
--          AND date >= today
--        ORDER BY date ASC
--        LIMIT 500;
--      Every passenger opens the app → this fires.
--
--   2. book_seat seat-availability + bookings list — bookings(trip_id, status)
--        SELECT * FROM bookings WHERE trip_id = X AND status IN (...);
--      Driver dashboards and the seat-check inside book_seat both hit it.
--      Existing idx_bookings_passenger_status is on (passenger_email,
--      status) and does NOT help this query.
--
--   3. MyTrips + UserProfile bookings list — bookings(passenger_email, created_at DESC)
--        SELECT * FROM bookings WHERE passenger_email = X
--          ORDER BY created_at DESC LIMIT 50;
--      Existing (passenger_email, status) index can't sort by created_at
--      so a full per-passenger row scan + sort happens on every "my
--      bookings" page open.
--
--   4. NotificationBell — notifications(user_email, created_at DESC)
--        SELECT * FROM notifications WHERE user_email = X
--          ORDER BY created_at DESC LIMIT 20;
--      Every authenticated page render mounts the bell. No index today
--      means a full notifications scan per page mount.
--
-- DESIGN NOTES
-- All indexes are CREATE INDEX IF NOT EXISTS — idempotent.
-- The DESC ordering on (created_at DESC) inside the index definition
-- matches the query's ORDER BY DESC so Postgres can do an index-only
-- backward scan without sorting.
-- The trips index uses (date, status) not (status, date) — date has
-- much higher cardinality so leading with date prunes faster.
-- We don't use CONCURRENTLY because these are small tables today and
-- it complicates the migration's idempotency guarantees. If the index
-- build ever takes >1 second on production, switch to CONCURRENTLY
-- and run outside a transaction.
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) SearchTrips hot path ───────────────────────────────────────
-- The query filters status IN (...) AND date >= today. A composite
-- (date, status) index supports both predicates and the ORDER BY date.
-- Partial index would be tighter but date >= today changes daily, so a
-- partial WHERE wouldn't survive without daily REINDEX. Full index is
-- the right choice.
CREATE INDEX IF NOT EXISTS idx_trips_date_status
  ON public.trips (date, status);

-- ─── (2) Seat-availability + bookings-on-trip ───────────────────────
-- Composite (trip_id, status) so admin and driver dashboards can find
-- "all confirmed/pending bookings on trip X" in one index probe.
CREATE INDEX IF NOT EXISTS idx_bookings_trip_status
  ON public.bookings (trip_id, status);

-- ─── (3) MyTrips passenger view ─────────────────────────────────────
-- (passenger_email, created_at DESC) lets the per-passenger ORDER BY
-- created_at DESC LIMIT 50 do a backward index scan with no sort step.
CREATE INDEX IF NOT EXISTS idx_bookings_passenger_created
  ON public.bookings (passenger_email, created_at DESC);

-- ─── (4) NotificationBell ───────────────────────────────────────────
-- (user_email, created_at DESC) — same shape as (3), applied to the
-- bell's "20 most recent for this user" lookup. The unread-count
-- computation (`is_read = false`) runs client-side on the 20 returned
-- rows, so we don't need to index is_read separately.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_email, created_at DESC);

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
  v_idx     TEXT;
BEGIN
  FOR v_idx IN
    SELECT unnest(ARRAY[
      'idx_trips_date_status',
      'idx_bookings_trip_status',
      'idx_bookings_passenger_created',
      'idx_notifications_user_created'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = v_idx
    ) THEN
      v_missing := v_missing || E'\n  - ' || v_idx;
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRATION 056 FAILED — index(es) not created: %', v_missing;
  END IF;
  RAISE NOTICE 'MIGRATION 056 OK — 4 hot-path indexes in place';
END $$;
