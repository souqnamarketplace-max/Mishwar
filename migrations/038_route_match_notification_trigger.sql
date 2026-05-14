-- ════════════════════════════════════════════════════════════════════════
-- Migration 038 — server-side saved-route-match notifications
-- ════════════════════════════════════════════════════════════════════════
--
-- BACKGROUND
-- Saved-route-match notifications ("a new trip matches your saved route
-- from X to Y") have been silently failing in production since the
-- feature shipped. The client code in src/pages/CreateTrip.jsx after a
-- successful Trip.create() iterates over public.trip_preferences and
-- calls base44.entities.Notification.create for each match — which is
-- a direct INSERT into public.notifications from the driver's session,
-- targeting the matched passenger's email. The notifications_insert
-- RLS policy (migration 002) only allows:
--
--   user_email = auth_user_email()  -- self-target, doesn't apply
--   OR auth_user_role() = 'admin'    -- driver is not admin
--
-- So every cross-user insert from a driver to a matched passenger gets
-- rejected. The rejection is wrapped in Promise.allSettled + catch,
-- so the driver sees no error, the passengers never get the bell ping,
-- and the saved-route feature has been quietly broken since shipping.
--
-- The create_notification RPC (migration 027) doesn't fix this either:
-- none of its authorization rules (A self / B caller=admin / C target=
-- admin / D shared booking / E exchanged messages) cover the "stranger
-- driver notifying me because the platform matched my saved route"
-- case. Even if we added a new rule, that would require trusting the
-- caller's claim about a match — better to compute matches server-side
-- where the data is authoritative.
--
-- THE FIX
-- A SECURITY DEFINER trigger on trips INSERT. The trigger:
--   1. Skips drafts/cancelled (only fires when NEW.status = 'confirmed')
--   2. Builds the trip's city sequence: from_city → stops[].city → to_city
--   3. Iterates active trip_preferences whose from_city AND to_city
--      both appear in the sequence
--   4. Verifies ordering (from_city must appear BEFORE to_city in the
--      sequence — a trip from Ramallah → Jenin shouldn't match a
--      passenger looking for Jenin → Ramallah)
--   5. Honors max_price if the preference has one set
--   6. Skips notifying the driver about their own trip
--   7. Inserts the notification — RLS bypassed because the function
--      is SECURITY DEFINER and the function owner (postgres) has
--      BYPASSRLS by default
--
-- Each notification insert is wrapped in its own EXCEPTION block so a
-- single bad notification (constraint violation, malformed data on
-- one preference row) doesn't roll back the trip creation. Trip
-- creation is the primary action; notifications are a side effect.
--
-- The client-side notifyMatchingPreferences function is removed in
-- the same commit that ships this migration — it no longer needs to
-- run, and leaving it around would mean duplicate notification
-- attempts (the trigger fires successfully, AND the client tries to
-- fire its own RLS-rejected insert). Removing the client code also
-- means the user's saved preferences don't get exposed to the
-- driver's session, which is a small privacy win.
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
  --
  -- jsonb_typeof guard: stops is jsonb but might be NULL or a
  -- non-array (legacy data). Bail out of the stops loop cleanly in
  -- those cases.
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

  -- Driver display name for the notification body. Fall back to the
  -- generic 'سائق' so the message doesn't read awkwardly with a NULL.
  v_driver_name := COALESCE(NULLIF(TRIM(NEW.driver_name), ''), 'سائق');

  -- Walk every active preference where both endpoints appear in the
  -- city sequence. The IN-list filter (= ANY(v_cities)) is a coarse
  -- pre-check that lets Postgres use an index on (from_city, to_city)
  -- if one exists; the precise ordering + price check happens inside
  -- the loop.
  FOR r IN
    SELECT p.user_email, p.from_city, p.to_city, p.max_price
    FROM public.trip_preferences p
    WHERE p.is_active = TRUE
      AND p.user_email IS NOT NULL
      AND p.user_email <> NEW.driver_email
      AND p.from_city = ANY(v_cities)
      AND p.to_city   = ANY(v_cities)
  LOOP
    -- Ordering check: preference.from_city must appear BEFORE
    -- preference.to_city in the trip sequence. array_position returns
    -- the 1-based index of the first match.
    v_from_idx := array_position(v_cities, r.from_city);
    v_to_idx   := array_position(v_cities, r.to_city);
    IF v_from_idx IS NULL OR v_to_idx IS NULL OR v_from_idx >= v_to_idx THEN
      CONTINUE;
    END IF;

    -- Price filter (optional on the preference). If the passenger set
    -- a max_price ceiling and the trip costs more, don't notify.
    IF r.max_price IS NOT NULL AND COALESCE(NEW.price, 0) > r.max_price THEN
      CONTINUE;
    END IF;

    -- Insert the notification. Wrap in EXCEPTION so a single bad row
    -- (e.g. malformed city data that breaks the message concat) won't
    -- abort the entire trip-create transaction. The trip itself is
    -- the primary action; notifications are best-effort.
    BEGIN
      INSERT INTO public.notifications (
        user_email, title, message, type, trip_id, from_city, to_city
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
        NEW.to_city
      );
    EXCEPTION WHEN OTHERS THEN
      -- Single notification failure shouldn't fail the whole trip.
      -- Log to Postgres' pg_log via RAISE NOTICE for admin debugging
      -- without crashing.
      RAISE NOTICE 'notify_matching_route_preferences: skip user % due to: %',
        r.user_email, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END $$;

-- DROP+CREATE for idempotency. AFTER INSERT means the trip row exists
-- before notifications fire — important because the notification row
-- carries trip_id and the foreign-key (if any) needs the parent row
-- visible.
DROP TRIGGER IF EXISTS trg_notify_matching_route_preferences ON public.trips;
CREATE TRIGGER trg_notify_matching_route_preferences
  AFTER INSERT ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_matching_route_preferences();

-- ─── Verification ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_trigger_exists  BOOLEAN;
  v_func_definer    BOOLEAN;
BEGIN
  -- Trigger landed
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_notify_matching_route_preferences'
      AND NOT tgisinternal
  ) INTO v_trigger_exists;
  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'MIGRATION 038 FAILED: trigger not created';
  END IF;

  -- Function is SECURITY DEFINER (otherwise it can't bypass RLS)
  SELECT prosecdef
  INTO v_func_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'notify_matching_route_preferences';
  IF NOT v_func_definer THEN
    RAISE EXCEPTION 'MIGRATION 038 FAILED: function not SECURITY DEFINER';
  END IF;

  RAISE NOTICE 'MIGRATION 038 OK — saved-route-match notifications now fire via trigger';
END $$;
