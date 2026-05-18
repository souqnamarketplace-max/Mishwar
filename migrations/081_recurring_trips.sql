-- ════════════════════════════════════════════════════════════════════════
-- Migration 081 — Recurring trip templates + automatic instance generation
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY: Drivers who run the same route on a regular schedule (e.g. Nablus
-- → Ramallah every weekday at 7am) currently have to manually post a
-- new trip each day. This feature lets them define the trip ONCE as
-- a 'template' and have the system create concrete instances ahead
-- of time automatically.
--
-- DESIGN:
--   - The trips table gets 3 new columns: is_template, recurrence_pattern,
--     parent_template_id (links instance back to its template).
--   - A new is_recurring_template_active flag (computed) determines
--     whether the cron job should generate new instances.
--   - A pg_cron job runs daily at 03:00 Asia/Jerusalem and ensures each
--     active template has the next 14 days of instances created.
--
-- ARCHITECTURE CHOICE — template-row-in-trips vs separate-table:
--   Option A: Add columns to trips, mark template rows with is_template=TRUE
--   Option B: Create a separate recurring_trip_templates table with a
--             one-to-many relationship to generated trips
--
--   Chose Option A because:
--   - Templates and instances share 95% of columns (from/to/time/price/
--     car/seats/etc.) — duplicating the schema in a separate table
--     creates drift risk and double-maintenance for any new trip column
--   - Existing RLS, indexes, and triggers automatically cover templates
--     too (templates are just trips with is_template=TRUE)
--   - Driver dashboard already queries trips by driver_email — adding
--     a WHERE is_template=FALSE clause is trivial
--   - For listing templates, a simple WHERE is_template=TRUE filter
--     against the same table is cheaper than a JOIN
--
--   The tradeoff: trip listing queries need to filter is_template=FALSE
--   to avoid showing templates to passengers. That's a one-line addition.
--
-- PATTERN VOCABULARY (intentionally small for v1):
--   'daily'     — every day
--   'weekdays'  — Sun-Thu (Palestine work week)
--   'weekends'  — Fri-Sat
--   'weekly'    — same day-of-week as the template's date
--
--   NOT in v1 (deliberate scope cap):
--   - Arbitrary day-of-week sets (mon+wed+fri only)
--   - Cron expressions (too power-user for a Palestinian rideshare app)
--   - Time-of-day patterns (e.g. 7am AND 6pm) — driver should make
--     two separate templates for that
--
-- INSTANCE GENERATION:
--   - Cron runs daily at 03:00 Asia/Jerusalem
--   - For each active template, computes target dates over the next
--     14 days that match the pattern
--   - For each target date, INSERTs a trip row with:
--       * is_template = FALSE
--       * parent_template_id = template.id
--       * date = target_date
--       * status = 'confirmed'
--       * All other columns copied from the template
--   - Skips dates that already have an instance for this template
--     (idempotent — safe if cron runs twice or if a date is missed
--     and backfilled later)
--   - Skips dates beyond template.recurrence_until (if set)
--
-- HOW DRIVERS PAUSE / STOP:
--   - Pause: set template.status = 'cancelled' (existing column).
--     Cron job filters status='confirmed' so it stops generating.
--   - Stop: DELETE the template. Existing trip CASCADE rules apply.
--     Already-generated future instances stay (driver can delete them
--     individually if desired) — this is the safer behavior because
--     a passenger may have booked.
--
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Schema additions ────────────────────────────────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS is_template          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurrence_pattern   TEXT
    CHECK (recurrence_pattern IS NULL OR recurrence_pattern IN
      ('daily', 'weekdays', 'weekends', 'weekly')),
  ADD COLUMN IF NOT EXISTS recurrence_until     DATE,
  ADD COLUMN IF NOT EXISTS parent_template_id   UUID
    REFERENCES public.trips(id) ON DELETE SET NULL;

-- A template MUST have a recurrence_pattern; an instance MUST NOT.
-- A template MUST NOT have a parent_template_id; an instance MAY (and
-- typically does — unless it was created independently). Mutually
-- exclusive flags caught at insert time.
ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_template_consistency;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_template_consistency CHECK (
    (is_template = TRUE  AND recurrence_pattern IS NOT NULL AND parent_template_id IS NULL)
    OR
    (is_template = FALSE AND recurrence_pattern IS NULL)
  );

-- ─── 2. Indexes ──────────────────────────────────────────────────────

-- Cron job queries: 'find all active templates that need instances'.
-- Partial index keeps the hot path tiny — templates are a small fraction
-- of total trips.
CREATE INDEX IF NOT EXISTS idx_trips_active_templates
  ON public.trips (driver_email, recurrence_pattern)
  WHERE is_template = TRUE AND status = 'confirmed';

-- Instance dedup check: 'does this template already have an instance
-- on this date?' Critical for cron idempotency.
CREATE INDEX IF NOT EXISTS idx_trips_template_instances
  ON public.trips (parent_template_id, date)
  WHERE parent_template_id IS NOT NULL;

-- ─── 3. Instance generation function ────────────────────────────────

-- Helper: given a pattern and starting date, return whether the date
-- matches. Pattern semantics:
--   daily     → every date
--   weekdays  → Sun(0) Mon(1) Tue(2) Wed(3) Thu(4)   [Palestine work week]
--   weekends  → Fri(5) Sat(6)
--   weekly    → only days-of-week matching the template's original date
--
-- Postgres EXTRACT(dow FROM date): 0=Sunday, 6=Saturday.
CREATE OR REPLACE FUNCTION public._recurrence_matches(
  p_pattern        TEXT,
  p_target_date    DATE,
  p_template_date  DATE
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_pattern
    WHEN 'daily'    THEN TRUE
    WHEN 'weekdays' THEN EXTRACT(dow FROM p_target_date) BETWEEN 0 AND 4
    WHEN 'weekends' THEN EXTRACT(dow FROM p_target_date) IN (5, 6)
    WHEN 'weekly'   THEN EXTRACT(dow FROM p_target_date) = EXTRACT(dow FROM p_template_date)
    ELSE FALSE
  END;
$$;

-- Main generation function. Generates instances for all active templates
-- over the next p_horizon_days days, skipping any that already exist.
-- Returns the number of new instances created.
--
-- SECURITY DEFINER so the cron job (running as postgres) can write,
-- but the function self-restricts to:
--   - status = 'confirmed' templates only
--   - dates within the [today+1, today+horizon] window
--   - dates within the template's recurrence_until cap (if set)
CREATE OR REPLACE FUNCTION public.generate_recurring_trip_instances(
  p_horizon_days INTEGER DEFAULT 14
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_template       RECORD;
  v_target_date    DATE;
  v_created_count  INTEGER := 0;
  v_today          DATE := (NOW() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  -- Iterate active templates
  FOR v_template IN
    SELECT id, driver_email, driver_id, driver_name, driver_avatar, driver_gender,
           from_city, to_city, date, time, price, available_seats,
           car_model, car_color, distance, payment_methods, stops, notes,
           recurrence_pattern, recurrence_until
    FROM public.trips
    WHERE is_template = TRUE
      AND status = 'confirmed'
  LOOP
    -- For each target date in the horizon
    FOR i IN 1 .. p_horizon_days LOOP
      v_target_date := v_today + i;

      -- Stop if past the template's recurrence_until
      IF v_template.recurrence_until IS NOT NULL
         AND v_target_date > v_template.recurrence_until THEN
        EXIT;
      END IF;

      -- Skip if pattern doesn't match this date
      IF NOT public._recurrence_matches(
        v_template.recurrence_pattern,
        v_target_date,
        v_template.date
      ) THEN
        CONTINUE;
      END IF;

      -- Skip if an instance already exists for this template + date
      -- (idempotency — the cron may run twice, or a date may be missed
      -- and backfilled later)
      IF EXISTS (
        SELECT 1 FROM public.trips
        WHERE parent_template_id = v_template.id AND date = v_target_date
      ) THEN
        CONTINUE;
      END IF;

      -- Generate the instance. All template fields are copied verbatim
      -- except is_template (FALSE), recurrence_* (NULL for instances),
      -- date (the target date), and parent_template_id (links back).
      INSERT INTO public.trips (
        driver_email, driver_id, driver_name, driver_avatar, driver_gender,
        from_city, to_city, date, time, price, available_seats,
        car_model, car_color, distance, payment_methods, stops, notes,
        status, is_template, parent_template_id,
        created_by, created_at, updated_at
      ) VALUES (
        v_template.driver_email, v_template.driver_id, v_template.driver_name,
        v_template.driver_avatar, v_template.driver_gender,
        v_template.from_city, v_template.to_city, v_target_date, v_template.time,
        v_template.price, v_template.available_seats,
        v_template.car_model, v_template.car_color, v_template.distance,
        v_template.payment_methods, v_template.stops, v_template.notes,
        'confirmed', FALSE, v_template.id,
        v_template.driver_email, NOW(), NOW()
      );

      v_created_count := v_created_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_created_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurring_trip_instances(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_recurring_trip_instances(INTEGER) TO service_role;

-- ─── 4. Driver-facing RPCs ───────────────────────────────────────────

-- Create a new recurring template. Driver-callable.
-- Returns the new template's UUID.
CREATE OR REPLACE FUNCTION public.create_recurring_trip_template(
  p_from_city      TEXT,
  p_to_city        TEXT,
  p_start_date     DATE,
  p_time           TIME,
  p_price          NUMERIC,
  p_available_seats INTEGER,
  p_pattern        TEXT,
  p_until_date     DATE DEFAULT NULL,
  p_car_model      TEXT DEFAULT NULL,
  p_car_color      TEXT DEFAULT NULL,
  p_payment_methods TEXT[] DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid          UUID;
  v_email        TEXT;
  v_name         TEXT;
  v_avatar       TEXT;
  v_gender       TEXT;
  v_template_id  UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Snapshot driver info for the template (same pattern as regular
  -- trip creation — denormalized for join-free reads on the main
  -- trips list)
  SELECT p.email, p.full_name, p.avatar_url, p.gender
    INTO v_email, v_name, v_avatar, v_gender
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = '28000';
  END IF;

  -- Validate pattern (CHECK constraint will catch invalid, but raising
  -- here gives a friendlier error path)
  IF p_pattern NOT IN ('daily', 'weekdays', 'weekends', 'weekly') THEN
    RAISE EXCEPTION 'Invalid recurrence pattern: %', p_pattern
      USING ERRCODE = '22023';
  END IF;

  -- Validate dates
  IF p_start_date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'Start date must be today or later' USING ERRCODE = '22023';
  END IF;
  IF p_until_date IS NOT NULL AND p_until_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be after start date' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.trips (
    driver_email, driver_id, driver_name, driver_avatar, driver_gender,
    from_city, to_city, date, time, price, available_seats,
    car_model, car_color, payment_methods, notes,
    status, is_template, recurrence_pattern, recurrence_until,
    created_by, created_at, updated_at
  ) VALUES (
    v_email, v_uid, v_name, v_avatar, v_gender,
    p_from_city, p_to_city, p_start_date, p_time, p_price, p_available_seats,
    p_car_model, p_car_color, p_payment_methods, p_notes,
    'confirmed', TRUE, p_pattern, p_until_date,
    v_email, NOW(), NOW()
  ) RETURNING id INTO v_template_id;

  -- Generate the first batch of instances immediately so the driver
  -- sees results without waiting for the next cron run
  PERFORM public.generate_recurring_trip_instances(14);

  RETURN v_template_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_recurring_trip_template(
  TEXT, TEXT, DATE, TIME, NUMERIC, INTEGER, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT
) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_recurring_trip_template(
  TEXT, TEXT, DATE, TIME, NUMERIC, INTEGER, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT
) TO authenticated;

-- ─── 5. Cron schedule ───────────────────────────────────────────────

-- Run daily at 03:00 Asia/Jerusalem. Early morning so:
--   - Same-day instances are visible by 03:01 (before first commuter
--     opens the app)
--   - Database is otherwise quiet (less lock contention)
--   - If the job fails, admins discover it before peak hours
DO $$
BEGIN
  -- Drop existing schedule if present (idempotent re-apply)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate_recurring_trips_daily') THEN
    PERFORM cron.unschedule('generate_recurring_trips_daily');
  END IF;

  PERFORM cron.schedule(
    'generate_recurring_trips_daily',
    '0 1 * * *',  -- 01:00 UTC = 03:00 Asia/Jerusalem (UTC+2, no DST in Palestine)
    $cron$
    SELECT public.generate_recurring_trip_instances(14);
    $cron$
  );

  RAISE NOTICE 'MIGRATION 081 — cron job generate_recurring_trips_daily scheduled at 03:00 Asia/Jerusalem';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not available — recurring trip generation will not run automatically. Apply manually via PERFORM public.generate_recurring_trip_instances();';
END $$;

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────
DO $$
DECLARE
  v_has_cols   BOOLEAN;
  v_has_fn     BOOLEAN;
  v_has_rpc    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='trips' AND column_name='is_template'
  ) INTO v_has_cols;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='generate_recurring_trip_instances'
  ) INTO v_has_fn;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_recurring_trip_template'
  ) INTO v_has_rpc;

  IF NOT v_has_cols THEN RAISE EXCEPTION 'MIGRATION 081 FAILED — schema columns missing'; END IF;
  IF NOT v_has_fn   THEN RAISE EXCEPTION 'MIGRATION 081 FAILED — generation function missing'; END IF;
  IF NOT v_has_rpc  THEN RAISE EXCEPTION 'MIGRATION 081 FAILED — driver RPC missing'; END IF;

  RAISE NOTICE 'MIGRATION 081 OK — recurring trip templates ready';
  RAISE NOTICE '  - trips.is_template, recurrence_pattern, recurrence_until, parent_template_id columns added';
  RAISE NOTICE '  - generate_recurring_trip_instances(horizon_days) function created';
  RAISE NOTICE '  - create_recurring_trip_template RPC created (auth-only)';
  RAISE NOTICE '  - Daily cron at 03:00 Asia/Jerusalem scheduled (pg_cron required)';
END $$;
