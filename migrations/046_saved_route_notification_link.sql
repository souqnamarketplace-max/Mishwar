-- ════════════════════════════════════════════════════════════════════════
-- Migration 046 — saved-route match notification gets an explicit link
-- ════════════════════════════════════════════════════════════════════════
--
-- CONTEXT
-- Migration 038 added trg_notify_matching_route_preferences — a trigger
-- that fires when a trip is created, walks every active trip_preference,
-- and inserts a notification for each matching user. The insert today:
--
--   INSERT INTO notifications (user_email, title, message, type,
--                              trip_id, from_city, to_city)
--   VALUES (..., 'new_trip', NEW.id::text, ...);
--
-- No link column is set. The notification bell still routes correctly
-- because notificationRouting.js falls through to type='new_trip' →
-- '/trip/<id>'. But this is fragile: if anyone edits routing.js to
-- handle types differently, or the type column gets renamed, this
-- notification's destination breaks silently. Better to set link
-- explicitly at the source.
--
-- WHY 046 NOT JUST RE-APPLY 038
-- Migration 038 is a well-tested file that already shipped. Touching
-- it again risks a merge conflict for anyone mid-deploy. Better to
-- ship the fix as its own migration that overrides the function.
-- Same outcome (link column populated), simpler diff.
--
-- IDEMPOTENT — full CREATE OR REPLACE of the function. Trigger isn't
-- touched (still points at this function name).
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_matching_route_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_cities       TEXT[];
  v_from_idx     INT;
  v_to_idx       INT;
  v_driver_name  TEXT;
  r              RECORD;
BEGIN
  -- Only fire for newly-created bookable trips. trip.status defaults to
  -- 'confirmed' so this matches the normal create flow. Drafts (if/when
  -- they exist) and trips inserted via admin tools with other statuses
  -- skip the match.
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Build the trip's full city sequence: from_city → each stop in
  -- order → to_city. A passenger saving "from X to Y" should match
  -- a trip that passes through X then Y in that order, regardless
  -- of which end of the trip those cities sit at.
  v_cities := ARRAY[NEW.from_city];
  IF NEW.stops IS NOT NULL AND jsonb_typeof(NEW.stops) = 'array' THEN
    v_cities := v_cities || COALESCE(
      ARRAY(
        SELECT s->>'city'
        FROM jsonb_array_elements(NEW.stops) s
        WHERE s->>'city' IS NOT NULL
      ),
      '{}'::text[]
    );
  END IF;
  v_cities := v_cities || ARRAY[NEW.to_city];

  v_driver_name := COALESCE(NULLIF(TRIM(NEW.driver_name), ''), 'سائق');

  FOR r IN
    SELECT p.user_email, p.from_city, p.to_city, p.max_price
    FROM public.trip_preferences p
    WHERE p.is_active = TRUE
      AND p.user_email IS NOT NULL
      AND p.user_email <> NEW.driver_email
      AND p.from_city = ANY(v_cities)
      AND p.to_city   = ANY(v_cities)
  LOOP
    v_from_idx := array_position(v_cities, r.from_city);
    v_to_idx   := array_position(v_cities, r.to_city);
    IF v_from_idx IS NULL OR v_to_idx IS NULL OR v_from_idx >= v_to_idx THEN
      CONTINUE;
    END IF;

    IF r.max_price IS NOT NULL AND r.max_price > 0
       AND NEW.price IS NOT NULL AND NEW.price > r.max_price THEN
      CONTINUE;
    END IF;

    BEGIN
      -- ─── NEW (migration 046): include explicit link ──────────────
      -- The link column points the bell tap straight at the trip
      -- details page. Previously this notification relied on
      -- notificationRouting.js's type='new_trip' fallback — works
      -- today, but a fragile dependency on routing-lib internals.
      -- Setting link here makes the routing decision self-contained
      -- in the DB row.
      INSERT INTO public.notifications (
        user_email, title, message, type, trip_id, from_city, to_city, link
      ) VALUES (
        r.user_email,
        'رحلة جديدة: ' || NEW.from_city || ' ← ' || NEW.to_city || ' 🚗',
        v_driver_name || ' ينشر رحلة من ' || NEW.from_city ||
          ' إلى ' || NEW.to_city ||
          ' بتاريخ ' || NEW.date::text ||
          CASE WHEN NEW.time IS NOT NULL
               THEN ' الساعة ' || NEW.time::text
               ELSE '' END ||
          '. السعر: ₪' || COALESCE(NEW.price, 0)::text || ' للمقعد.',
        'new_trip',
        NEW.id::text,
        NEW.from_city,
        NEW.to_city,
        '/trip/' || NEW.id::text
      );
    EXCEPTION WHEN OTHERS THEN
      -- Single notification failure shouldn't fail the whole trip
      -- creation. Log to Postgres' pg_log for admin debugging without
      -- crashing.
      RAISE NOTICE 'notify_matching_route_preferences: skip user % due to: %',
        r.user_email, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END $$;

-- Trigger itself stays from migration 038; only the function body
-- changed. Verify the trigger still binds correctly.
DO $$
DECLARE
  v_func_definer    BOOLEAN;
  v_func_has_link   BOOLEAN;
  v_trigger_exists  BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_notify_matching_route_preferences'
      AND NOT tgisinternal
  ) INTO v_trigger_exists;

  -- Confirm SECURITY DEFINER survived the CREATE OR REPLACE.
  SELECT p.prosecdef INTO v_func_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'notify_matching_route_preferences';

  -- Confirm the new body actually inserts the link column.
  SELECT pg_get_functiondef(p.oid) LIKE '%link%/trip/%'
  INTO v_func_has_link
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'notify_matching_route_preferences';

  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'MIGRATION 046 FAILED: trigger missing — re-apply migration 038 first';
  END IF;
  IF NOT COALESCE(v_func_definer, FALSE) THEN
    RAISE EXCEPTION 'MIGRATION 046 FAILED: function lost SECURITY DEFINER';
  END IF;
  IF NOT COALESCE(v_func_has_link, FALSE) THEN
    RAISE EXCEPTION 'MIGRATION 046 FAILED: link insertion missing from function body';
  END IF;

  RAISE NOTICE 'MIGRATION 046 OK — saved-route notifications now include explicit link';
END $$;
