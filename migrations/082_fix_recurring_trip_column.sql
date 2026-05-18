-- ════════════════════════════════════════════════════════════════════════
-- Migration 082 — Fix mig 081 column reference: notes → driver_note
-- ════════════════════════════════════════════════════════════════════════
--
-- BUG: mig 081's create_recurring_trip_template RPC and the related
-- generate_recurring_trip_instances function both reference a column
-- called 'notes' on public.trips. That column doesn't exist on the
-- live schema. The actual column is 'driver_note' (singular, no 's'
-- — visible in src/pages/CreateTrip.jsx, src/pages/TripDetails.jsx,
-- and earlier migrations).
--
-- Symptom in production:
--   User clicks 'إنشاء القالب' on /recurring-trips → toast:
--   'column "notes" of relation "trips" does not exist'
--
-- This migration replaces both functions with the corrected versions.
-- The schema additions (is_template, recurrence_pattern, etc.) from
-- mig 081 are unaffected — they were correct. Only the INSERT
-- column lists in the two functions needed updating.
--
-- IDEMPOTENT: CREATE OR REPLACE on both functions. Safe to apply
-- multiple times. The functions are self-contained — no data
-- migration needed.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Fix generate_recurring_trip_instances ──────────────────────

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
  FOR v_template IN
    SELECT id, driver_email, driver_id, driver_name, driver_avatar, driver_gender,
           from_city, to_city, date, time, price, available_seats,
           car_model, car_color, distance, payment_methods, stops, driver_note,
           recurrence_pattern, recurrence_until
    FROM public.trips
    WHERE is_template = TRUE
      AND status = 'confirmed'
  LOOP
    FOR i IN 1 .. p_horizon_days LOOP
      v_target_date := v_today + i;

      IF v_template.recurrence_until IS NOT NULL
         AND v_target_date > v_template.recurrence_until THEN
        EXIT;
      END IF;

      IF NOT public._recurrence_matches(
        v_template.recurrence_pattern,
        v_target_date,
        v_template.date
      ) THEN
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.trips
        WHERE parent_template_id = v_template.id AND date = v_target_date
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.trips (
        driver_email, driver_id, driver_name, driver_avatar, driver_gender,
        from_city, to_city, date, time, price, available_seats,
        car_model, car_color, distance, payment_methods, stops, driver_note,
        status, is_template, parent_template_id,
        created_by, created_at, updated_at
      ) VALUES (
        v_template.driver_email, v_template.driver_id, v_template.driver_name,
        v_template.driver_avatar, v_template.driver_gender,
        v_template.from_city, v_template.to_city, v_target_date, v_template.time,
        v_template.price, v_template.available_seats,
        v_template.car_model, v_template.car_color, v_template.distance,
        v_template.payment_methods, v_template.stops, v_template.driver_note,
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

-- ─── 2. Fix create_recurring_trip_template ──────────────────────────
--
-- The driver-callable RPC's INSERT also referenced 'notes' (mapped
-- from the p_notes parameter). Renamed p_notes → p_driver_note for
-- consistency with the actual column. The OLD parameter name is
-- preserved as an overload so the frontend can keep calling it
-- p_notes during transition. Postgres routes to the parameter
-- whose name matches the call site.

-- First drop both forms (if either exists) so we can recreate cleanly.
-- CREATE OR REPLACE doesn't work when the parameter list changes.
DROP FUNCTION IF EXISTS public.create_recurring_trip_template(
  TEXT, TEXT, DATE, TIME, NUMERIC, INTEGER, TEXT, DATE, TEXT, TEXT, TEXT[], TEXT
);

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
  p_notes          TEXT DEFAULT NULL  -- frontend keeps calling this 'p_notes'; internally maps to driver_note column
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

  SELECT p.email, p.full_name, p.avatar_url, p.gender
    INTO v_email, v_name, v_avatar, v_gender
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = '28000';
  END IF;

  IF p_pattern NOT IN ('daily', 'weekdays', 'weekends', 'weekly') THEN
    RAISE EXCEPTION 'Invalid recurrence pattern: %', p_pattern
      USING ERRCODE = '22023';
  END IF;

  IF p_start_date < (NOW() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'Start date must be today or later' USING ERRCODE = '22023';
  END IF;
  IF p_until_date IS NOT NULL AND p_until_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be after start date' USING ERRCODE = '22023';
  END IF;

  -- The column is driver_note (singular), not notes. mig 081 had this
  -- wrong and the frontend was getting a 500 from postgres on every
  -- create attempt.
  INSERT INTO public.trips (
    driver_email, driver_id, driver_name, driver_avatar, driver_gender,
    from_city, to_city, date, time, price, available_seats,
    car_model, car_color, payment_methods, driver_note,
    status, is_template, recurrence_pattern, recurrence_until,
    created_by, created_at, updated_at
  ) VALUES (
    v_email, v_uid, v_name, v_avatar, v_gender,
    p_from_city, p_to_city, p_start_date, p_time, p_price, p_available_seats,
    p_car_model, p_car_color, p_payment_methods, p_notes,
    'confirmed', TRUE, p_pattern, p_until_date,
    v_email, NOW(), NOW()
  ) RETURNING id INTO v_template_id;

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

COMMIT;

DO $$ BEGIN
  RAISE NOTICE 'MIGRATION 082 OK — recurring trip RPCs corrected (notes → driver_note)';
END $$;
