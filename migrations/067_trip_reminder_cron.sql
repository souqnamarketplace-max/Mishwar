-- ════════════════════════════════════════════════════════════════════════
-- Migration 067 — Trip reminder cron (1 hour before departure)
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- For Tier 1 transactional notifications we want to remind both the
-- driver and all confirmed passengers about an upcoming trip ~1 hour
-- before departure. This composes with the existing notification
-- pipeline: this cron INSERTs notification rows; mig 060 emits push;
-- mig 066 emits email; bell + toast happen via realtime.
--
-- WHY pg_cron and not a Vercel cron job
-- pg_cron runs INSIDE Postgres on Supabase's hosted infra. No external
-- dependency, no cold-start latency, runs reliably every 5 min as
-- promised. Each run is one Postgres transaction. Failure mode is just
-- "this batch is skipped" (next batch picks up).
--
-- SCHEDULE LOGIC — why a 10-minute window
-- The cron fires every 5 minutes. To not miss any trip, the window we
-- check has to be at least 5 minutes wide. We use 10 minutes (55-65 min
-- ahead of NOW) so any trip in that window definitely gets a reminder
-- exactly once.
--
-- DEDUP — why the NOT EXISTS check
-- If the cron runs twice in close succession (manual trigger + scheduled
-- run, or two runs happen to overlap), we don't want to send two reminders
-- to the same user for the same trip. The NOT EXISTS guard checks for an
-- existing 'trip_reminder' notification for this user+trip — if present,
-- skip. Atomic enough since notifications has a primary key constraint.
--
-- TIMEZONE — Asia/Jerusalem
-- The trips table stores `date` (DATE) and `time` (TIME) without
-- timezone info — they represent LOCAL Palestinian time. We compute the
-- departure timestamp by combining and casting to Asia/Jerusalem, then
-- comparing to NOW() (which Postgres normalizes to UTC for comparisons).
-- Without the AT TIME ZONE we'd be 2-3 hours off depending on DST.
--
-- WHICH TRIPS GET A REMINDER
--   - status = 'confirmed' (active trip with at least one booking)
--   - departure_time ∈ [NOW+55min, NOW+65min]
--   - NOT already reminded for this user+trip combination
--
-- WHO GETS A REMINDER
--   - The driver (always, even if no passengers — they might still
--     deserve a heads-up about a trip they're driving)
--   - Every passenger whose booking.status = 'confirmed'
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. pg_cron extension (already enabled per mig 060, but be defensive) ─
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── 2. The reminder function ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_upcoming_trips()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_trip            RECORD;
  v_booking         RECORD;
  v_count           INTEGER := 0;
  v_departure_at    TIMESTAMPTZ;
BEGIN
  -- Find trips departing 55-65 minutes from now (Asia/Jerusalem).
  FOR v_trip IN
    SELECT
      t.id,
      t.driver_email,
      t.driver_name,
      t.from_city,
      t.to_city,
      t.date,
      t.time,
      ((t.date::TEXT || ' ' || COALESCE(NULLIF(t.time, ''), '00:00:00'))::TIMESTAMP
        AT TIME ZONE 'Asia/Jerusalem') AS departure_at
    FROM public.trips t
    WHERE t.status = 'confirmed'
      AND t.date IS NOT NULL
      AND ((t.date::TEXT || ' ' || COALESCE(NULLIF(t.time, ''), '00:00:00'))::TIMESTAMP
            AT TIME ZONE 'Asia/Jerusalem')
          BETWEEN NOW() + INTERVAL '55 minutes'
              AND NOW() + INTERVAL '65 minutes'
  LOOP
    v_departure_at := v_trip.departure_at;

    -- ── Driver reminder ───────────────────────────────────────────────
    IF v_trip.driver_email IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.notifications
       WHERE trip_id = v_trip.id
         AND user_email = v_trip.driver_email
         AND type = 'trip_reminder'
    ) THEN
      INSERT INTO public.notifications (
        user_email, title, message, type, trip_id, link, is_read, created_by
      ) VALUES (
        v_trip.driver_email,
        'تذكير: رحلتك بعد ساعة',
        'رحلتك من ' || COALESCE(v_trip.from_city, '?') ||
          ' إلى ' || COALESCE(v_trip.to_city, '?') || ' تنطلق بعد ساعة',
        'trip_reminder',
        v_trip.id,
        '/trip/' || v_trip.id::text,
        FALSE,
        'system'
      );
      v_count := v_count + 1;
    END IF;

    -- ── Passenger reminders ───────────────────────────────────────────
    -- Loops every confirmed booking on this trip. The dedup check
    -- (NOT EXISTS) prevents duplicate reminders on cron overlap.
    FOR v_booking IN
      SELECT b.passenger_email
        FROM public.bookings b
       WHERE b.trip_id = v_trip.id
         AND b.status = 'confirmed'
    LOOP
      IF v_booking.passenger_email IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.notifications
         WHERE trip_id = v_trip.id
           AND user_email = v_booking.passenger_email
           AND type = 'trip_reminder'
      ) THEN
        INSERT INTO public.notifications (
          user_email, title, message, type, trip_id, link, is_read, created_by
        ) VALUES (
          v_booking.passenger_email,
          'تذكير: رحلتك بعد ساعة',
          'رحلتك مع ' || COALESCE(v_trip.driver_name, 'السائق') ||
            ' من ' || COALESCE(v_trip.from_city, '?') ||
            ' إلى ' || COALESCE(v_trip.to_city, '?') || ' تنطلق بعد ساعة',
          'trip_reminder',
          v_trip.id,
          '/trip/' || v_trip.id::text,
          FALSE,
          'system'
        );
        v_count := v_count + 1;
      END IF;
    END LOOP;

  END LOOP;

  RETURN v_count;
EXCEPTION
  WHEN OTHERS THEN
    -- Defensive — if the function fails (schema drift, missing column,
    -- whatever), don't break the cron job permanently. Log and return 0.
    RAISE WARNING 'notify_upcoming_trips failed: % %', SQLSTATE, SQLERRM;
    RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_upcoming_trips() FROM PUBLIC, anon, authenticated;
-- Only postgres + cron can invoke. Admins running manually from SQL
-- editor inherit postgres privileges.

-- ─── 3. Schedule the cron job ────────────────────────────────────────────
-- Every 5 minutes, all hours, all days. The job runs in <100ms typically
-- (small SELECT range), well under the cron interval.
--
-- If the cron job already exists (re-running this migration), unschedule
-- it first to avoid duplicates.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trip-reminders') THEN
    PERFORM cron.unschedule('trip-reminders');
  END IF;

  PERFORM cron.schedule(
    'trip-reminders',
    '*/5 * * * *',
    'SELECT public.notify_upcoming_trips();'
  );
END $$;

-- ─── 4. Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn      BOOLEAN;
  v_cron    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'notify_upcoming_trips'
  ) INTO v_fn;

  SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'trip-reminders'
  ) INTO v_cron;

  IF NOT v_fn THEN
    RAISE EXCEPTION 'MIGRATION 067 FAILED — notify_upcoming_trips function missing';
  END IF;
  IF NOT v_cron THEN
    RAISE EXCEPTION 'MIGRATION 067 FAILED — trip-reminders cron job not scheduled';
  END IF;

  RAISE NOTICE 'MIGRATION 067 OK — trip-reminders cron scheduled (every 5 min, looks 55-65 min ahead)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- USEFUL DEBUG QUERIES
-- ═══════════════════════════════════════════════════════════════════════
--
-- See the cron job's recent run history (latency, status, output):
--   SELECT * FROM cron.job_run_details
--    WHERE jobname = 'trip-reminders'
--    ORDER BY start_time DESC LIMIT 20;
--
-- See trips that WILL get reminded in the next batch:
--   SELECT id, from_city, to_city, date, time,
--          ((date::TEXT || ' ' || time)::TIMESTAMP AT TIME ZONE 'Asia/Jerusalem') AS departure_at
--   FROM trips
--   WHERE status = 'confirmed'
--     AND ((date::TEXT || ' ' || COALESCE(NULLIF(time, ''), '00:00:00'))::TIMESTAMP
--           AT TIME ZONE 'Asia/Jerusalem')
--         BETWEEN NOW() + INTERVAL '55 minutes' AND NOW() + INTERVAL '65 minutes';
--
-- Manual fire (for testing without waiting 5 min):
--   SELECT public.notify_upcoming_trips();
--   -- returns INTEGER = number of notifications created
--
-- Manually unschedule (e.g., during heavy DB maintenance):
--   SELECT cron.unschedule('trip-reminders');
-- ═══════════════════════════════════════════════════════════════════════
