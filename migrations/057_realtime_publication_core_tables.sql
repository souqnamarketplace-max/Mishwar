-- ════════════════════════════════════════════════════════════════════════
-- Migration 057 — Publish trips, bookings, notifications for realtime
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- The frontend calls Trip.subscribe(), Booking.subscribe(), and
-- Notification.subscribe() in 18+ places across the codebase (the shared
-- per-table channel registry in apiClient.js, NotificationBell,
-- TripCard, DriverTripsList, DriverPassengers, StatsBar, FeaturedTrips,
-- multiple dashboard pages, etc.). All of these open Supabase realtime
-- channels and listen for postgres_changes events.
--
-- But — only `messages` was added to the supabase_realtime publication
-- (migration 051). The other three tables aren't published, so their
-- postgres_changes events never fire. The subscribe() calls open the
-- channel successfully but never receive a payload. Cache invalidation
-- happens only when React Query's staleTime expires (typically 30-60s),
-- not when another user actually changes data.
--
-- For 10 concurrent users this is a UX nit. For 1000+ this is a real
-- correctness issue: a passenger sees a "0 seats available" trip that
-- was confirmed for them 45 seconds ago, or a driver sees a stale
-- pending-booking list that doesn't reflect cancellations.
--
-- Adding the tables to supabase_realtime is the one-line fix. Idempotent.
--
-- REPLICA IDENTITY FULL
-- Required for the realtime payload to include the OLD row on UPDATE
-- and DELETE. Without FULL, the `old` field is empty and frontend code
-- that diffs (e.g. "did the status change from pending → confirmed?")
-- can't tell what changed. Already shown to be safe (migration 051 set
-- it on messages with no production issues).
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) trips ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_published BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'trips'
  ) INTO v_published;

  IF v_published THEN
    RAISE NOTICE '✓ trips is already published for realtime — no-op';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
    RAISE NOTICE '✓ Added public.trips to supabase_realtime publication';
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT relreplident FROM pg_class
       WHERE oid = 'public.trips'::regclass) <> 'f' THEN
    ALTER TABLE public.trips REPLICA IDENTITY FULL;
    RAISE NOTICE '✓ Set REPLICA IDENTITY FULL on public.trips';
  END IF;
END $$;

-- ─── (2) bookings ───────────────────────────────────────────────────
DO $$
DECLARE
  v_published BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'bookings'
  ) INTO v_published;

  IF v_published THEN
    RAISE NOTICE '✓ bookings is already published for realtime — no-op';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
    RAISE NOTICE '✓ Added public.bookings to supabase_realtime publication';
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT relreplident FROM pg_class
       WHERE oid = 'public.bookings'::regclass) <> 'f' THEN
    ALTER TABLE public.bookings REPLICA IDENTITY FULL;
    RAISE NOTICE '✓ Set REPLICA IDENTITY FULL on public.bookings';
  END IF;
END $$;

-- ─── (3) notifications ──────────────────────────────────────────────
DO $$
DECLARE
  v_published BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'notifications'
  ) INTO v_published;

  IF v_published THEN
    RAISE NOTICE '✓ notifications is already published for realtime — no-op';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    RAISE NOTICE '✓ Added public.notifications to supabase_realtime publication';
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT relreplident FROM pg_class
       WHERE oid = 'public.notifications'::regclass) <> 'f' THEN
    ALTER TABLE public.notifications REPLICA IDENTITY FULL;
    RAISE NOTICE '✓ Set REPLICA IDENTITY FULL on public.notifications';
  END IF;
END $$;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
  v_tbl     TEXT;
BEGIN
  FOR v_tbl IN
    SELECT unnest(ARRAY['trips', 'bookings', 'notifications'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = v_tbl
    ) THEN
      v_missing := v_missing || E'\n  - public.' || v_tbl;
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRATION 057 FAILED — table(s) not published: %', v_missing;
  END IF;
  RAISE NOTICE 'MIGRATION 057 OK — trips, bookings, notifications now in supabase_realtime';
END $$;
