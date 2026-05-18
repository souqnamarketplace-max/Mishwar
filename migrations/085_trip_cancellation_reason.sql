-- ═══════════════════════════════════════════════════════════════════════════
-- 085_trip_cancellation_reason.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Adds structured cancellation tracking to the `trips` table so when a
-- driver cancels a trip we capture:
--   1. WHY they cancelled (8 canonical reasons + 'other')
--   2. OPTIONAL detail text (free-form, for the 'other' case or
--      additional context on any reason)
--   3. WHEN it was cancelled (timestamp distinct from updated_at,
--      which moves on any edit)
--
-- Pre-existing infrastructure on RELATED tables (do not duplicate):
--   - bookings.cancellation_reason TEXT (mig 018) — used by the strike
--     system for per-booking notes when a booking is cancelled
--   - bookings.cancel_reason TEXT (mig 002 trigger) — write-once
--     audit field
-- This migration is the parallel for the TRIP-level cancellation,
-- which previously had no structured capture (driver clicked "إلغاء
-- الرحلة", trip went to status='cancelled', no reason stored).
--
-- ─── WHY STRUCTURED REASONS (NOT FREE TEXT) ───────────────────────────
--
-- Inspired by the Poparide research screenshots (radio-list picker
-- with 8 options) but compressed into a single mobile-friendly screen
-- — Mishwaro does NOT replicate Poparide's 4-step flow which is too
-- much friction on mobile.
--
-- Structured reasons enable:
--   - Analytics: "30% of cancellations are car problems → invest in
--     driver vehicle prep"
--   - Safety flagging: 'uneasy_with_passenger' can auto-route to
--     admin moderation queue (future work, not in this migration)
--   - Better passenger notification copy: when reason is 'car_problem'
--     vs 'plans_changed', the notification can be more specific
--   - Strike system precision: not all cancellations are equally
--     "the driver's fault" — illness/emergency vs plans-changed
--     have different reasonable thresholds
--
-- ─── CANONICAL REASON CODES ───────────────────────────────────────────
--
-- These match exactly what the UI radio list will show. Stored as
-- short snake_case codes (not Arabic display strings) so:
--   - Future locale changes don't require data migration
--   - Analytics queries are reliable (no ambiguity from
--     "ظرف عائلي طارئ" vs "ظرف طارئ عائلي" typos)
--   - Frontend can render the label however it wants
--
--   passenger_requested  — passenger asked for refund (out of driver's hands)
--   uneasy_with_passenger — safety concern (admin should review)
--   out_of_my_way        — pickup/dropoff doesn't match driver's actual route
--   plans_changed        — driver's plans changed (most "driver-fault")
--   sick                 — driver can't drive (illness)
--   car_problem          — vehicle issue
--   bad_weather          — weather (rare in Palestine but happens — sandstorm,
--                          heavy snow in north winter)
--   family_emergency     — emergency
--   other                — free text in cancel_reason_detail required
--
-- The CHECK constraint enforces the allowlist. Adding new codes
-- requires a future migration (intentional — keeps the analytics
-- schema stable).

BEGIN;

-- ─── 1. Add the three new columns ─────────────────────────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS cancel_reason        TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason_detail TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at         TIMESTAMPTZ;

-- ─── 2. CHECK constraint on reason allowlist ──────────────────────────
--
-- IF EXISTS guard so the migration is re-runnable. PostgreSQL doesn't
-- support IF NOT EXISTS on CHECK constraints directly — we drop-and-
-- recreate.

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_cancel_reason_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_cancel_reason_check
  CHECK (
    cancel_reason IS NULL
    OR cancel_reason IN (
      'passenger_requested',
      'uneasy_with_passenger',
      'out_of_my_way',
      'plans_changed',
      'sick',
      'car_problem',
      'bad_weather',
      'family_emergency',
      'other'
    )
  );

-- ─── 3. Length cap on the optional detail textarea ────────────────────
--
-- Matches the body-length cap on release_notes for consistency.
-- Drivers might paste a longer story but 2000 chars is plenty and
-- prevents abuse / accidental DoS via 10MB textbox dumps.

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_cancel_reason_detail_len;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_cancel_reason_detail_len
  CHECK (
    cancel_reason_detail IS NULL
    OR length(cancel_reason_detail) <= 2000
  );

-- ─── 4. Trigger: enforce write-once + auto-stamp cancelled_at ─────────
--
-- Once a cancel_reason is set, it CAN'T be changed (audit integrity).
-- Same pattern as the existing mig 002 trigger for cancel_reason on
-- bookings. cancelled_at is auto-stamped on the same UPDATE that sets
-- status='cancelled', so the frontend doesn't need to pass it explicitly.

CREATE OR REPLACE FUNCTION public.tg_trips_cancellation_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Write-once: don't let a set reason be overwritten or cleared
  IF OLD.cancel_reason IS NOT NULL
     AND NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
    RAISE EXCEPTION 'cancel_reason already set, cannot be modified'
      USING ERRCODE = '42501';
  END IF;

  -- Auto-stamp cancelled_at on the transition to status='cancelled'.
  -- Only fires when status actually CHANGES to cancelled (so editing
  -- another field on an already-cancelled trip doesn't reset the
  -- timestamp).
  IF NEW.status = 'cancelled'
     AND (OLD.status IS DISTINCT FROM 'cancelled')
     AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trips_cancellation_guard ON public.trips;
CREATE TRIGGER trg_trips_cancellation_guard
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.tg_trips_cancellation_guard();

-- ─── 5. Helpful index for analytics queries ───────────────────────────
--
-- Partial index over cancelled trips with a reason. Most rows in trips
-- have cancel_reason=NULL (not cancelled), so a partial index keeps
-- the on-disk size tiny while still being fast for the admin
-- "show me cancellation reasons by week" dashboard query.

CREATE INDEX IF NOT EXISTS idx_trips_cancel_reason_analytics
  ON public.trips (cancel_reason, cancelled_at DESC)
  WHERE cancel_reason IS NOT NULL;

COMMIT;

-- ─── VERIFICATION QUERIES (run manually in SQL editor) ────────────────
--
-- After applying:
--
--   -- Schema check:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'trips'
--      AND column_name IN ('cancel_reason', 'cancel_reason_detail', 'cancelled_at');
--   -- Expect 3 rows: text, text, timestamp with time zone
--
--   -- Constraint check:
--   SELECT conname
--     FROM pg_constraint
--    WHERE conrelid = 'public.trips'::regclass
--      AND conname IN ('trips_cancel_reason_check', 'trips_cancel_reason_detail_len');
--   -- Expect 2 rows
--
--   -- Trigger check:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.trips'::regclass
--      AND tgname = 'trg_trips_cancellation_guard';
--   -- Expect 1 row
--
--   -- Index check:
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'trips'
--      AND indexname = 'idx_trips_cancel_reason_analytics';
--   -- Expect 1 row
