-- =============================================================================
-- Migration 015 — User-suggested cities + admin-approved cities table
-- =============================================================================
--
-- WHY: Currently the cities autocomplete uses a static curated list
-- (RAW_CITIES in cities.js + CITY_COORDS in mapUtils.js). When a user
-- can't find their village, the existing fallback writes a row to the
-- generic `feedback` table that has no admin-review UI, no coordinates
-- workflow, and no path to actually adding the city to the lookup.
--
-- This migration sets up two purpose-built tables:
--
--   1) city_suggestions
--      User-submitted "this village is missing" requests. Includes
--      optional landmark/notes the user can write to help admin
--      identify the place. Same name from multiple users bumps a
--      duplicate counter rather than creating duplicate rows —
--      gives admin signal about which suggestions to prioritize.
--
--   2) admin_cities
--      Admin-approved cities with their coordinates. Read at runtime
--      by useAllCities() and CITY_COORDS lookup, so a newly-approved
--      city appears in the autocomplete and routing for ALL users
--      within seconds — no code deploy.
--
-- The two tables are separate because:
--   - Suggestions are noisy (typos, duplicates, malicious entries)
--   - Approved cities need to be 100% trustworthy for routing
--   - Approval is a discrete admin action, not just a status flip
-- =============================================================================

BEGIN;

-- ─── 1) city_suggestions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.city_suggestions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalized canonical form of the suggested name (trimmed, no extra
  -- whitespace). UNIQUE constraint prevents duplicates from accumulating;
  -- repeated suggestions just bump duplicate_count via the upsert RPC.
  name                TEXT NOT NULL,
  -- Original spelling as the FIRST user typed it. Useful if admin wants
  -- to see what variant the user actually used.
  original_input      TEXT,
  -- Optional context: nearby landmark, governorate, area description.
  -- Empty for users who just suggest the name and move on.
  notes               TEXT,
  -- Email of the user who first suggested it. Suggestions are accepted
  -- from authenticated users only (RLS) — anon users can't suggest.
  suggested_by_email  TEXT,
  -- When 2+ users suggest the same name, we increment this counter
  -- instead of creating new rows. Higher count = stronger signal.
  duplicate_count     INTEGER NOT NULL DEFAULT 1,
  -- Status workflow:
  --   pending   — awaiting admin review (default for new submissions)
  --   approved  — admin set lat/lng and the city now lives in admin_cities
  --   rejected  — admin determined this is not a real place / spam / typo
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Filled when admin approves: which cities row was created.
  approved_city_id    UUID,
  -- Filled when admin rejects: why (visible to no one, just for admin
  -- audit trail).
  rejection_reason    TEXT,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Defensive: name shouldn't be empty or whitespace
  CONSTRAINT city_suggestions_name_not_empty CHECK (length(trim(name)) > 0),
  -- Reasonable upper bound on length
  CONSTRAINT city_suggestions_name_length CHECK (length(name) <= 200)
);

-- Functional unique index on lower(trim(name))+status='pending'.
-- This lets us upsert on name for pending rows (bump counter) while
-- still allowing the same name to be re-suggested AFTER it was once
-- rejected (admin might have rejected a typo, then a different user
-- suggests the corrected spelling).
CREATE UNIQUE INDEX IF NOT EXISTS uq_city_suggestions_pending_name
  ON public.city_suggestions (lower(trim(name)))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_city_suggestions_status
  ON public.city_suggestions (status, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_city_suggestions_touch ON public.city_suggestions;
CREATE TRIGGER trg_city_suggestions_touch
  BEFORE UPDATE ON public.city_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ─── 2) admin_cities ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_cities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The name as it should appear in the autocomplete (admin's chosen
  -- canonical Arabic spelling, possibly different from the user's input).
  name          TEXT NOT NULL UNIQUE,
  -- Coordinates. Admin enters these from Google Maps. WGS84 decimal degrees.
  -- West Bank reasonable bounds: lat 31.2..32.6, lng 34.9..35.6
  lat           DECIMAL(9, 6) NOT NULL,
  lng           DECIMAL(9, 6) NOT NULL,
  -- Optional metadata the admin may want to fill in:
  governorate   TEXT,
  -- Audit trail
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT admin_cities_lat_bounds CHECK (lat BETWEEN 30.0 AND 34.0),
  CONSTRAINT admin_cities_lng_bounds CHECK (lng BETWEEN 33.0 AND 37.0),
  CONSTRAINT admin_cities_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT admin_cities_name_length   CHECK (length(name) <= 100)
);

DROP TRIGGER IF EXISTS trg_admin_cities_touch ON public.admin_cities;
CREATE TRIGGER trg_admin_cities_touch
  BEFORE UPDATE ON public.admin_cities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ─── 3) RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.city_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_cities     ENABLE ROW LEVEL SECURITY;

-- city_suggestions: any authenticated user can INSERT (so they can
-- suggest), but reads are admin-only (so users can't browse other
-- users' suggestions or see the queue). Updates are admin-only.
DROP POLICY IF EXISTS "auth users can suggest cities" ON public.city_suggestions;
CREATE POLICY "auth users can suggest cities"
  ON public.city_suggestions FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "admins can read suggestions" ON public.city_suggestions;
CREATE POLICY "admins can read suggestions"
  ON public.city_suggestions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE email = auth.email() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "admins can update suggestions" ON public.city_suggestions;
CREATE POLICY "admins can update suggestions"
  ON public.city_suggestions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE email = auth.email() AND role = 'admin'
    )
  );

-- admin_cities: anyone authenticated reads (so the city autocomplete
-- works for every user). Only admins can INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "anyone reads approved cities" ON public.admin_cities;
CREATE POLICY "anyone reads approved cities"
  ON public.admin_cities FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admins manage cities" ON public.admin_cities;
CREATE POLICY "admins manage cities"
  ON public.admin_cities FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE email = auth.email() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE email = auth.email() AND role = 'admin'
    )
  );


-- ─── 4) suggest_city RPC — upsert with duplicate counting ─────────────────
--
-- User submits a city name. If a pending suggestion with the same name
-- already exists, bump duplicate_count and return that existing row's
-- id. Otherwise insert new. This gives admin a clear "5 people asked
-- for this same village" signal instead of 5 separate rows to review.
--
-- Notes:
--   - SECURITY DEFINER so the upsert can run even with restrictive RLS.
--   - We trust auth.email() to identify the suggester. anon users will
--     get NULL there and the row's suggested_by_email stays NULL — fine.
--   - We don't allow suggestion of a name that already exists in
--     admin_cities (it's already approved — user just typed it slightly
--     wrong or didn't scroll). Returns NULL in that case so the UI can
--     show a helpful "this city already exists" message.

CREATE OR REPLACE FUNCTION public.suggest_city(
  p_name  TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_user_email TEXT;
  v_clean_name TEXT;
  v_existing_id UUID;
BEGIN
  v_user_email := auth.email();
  v_clean_name := trim(p_name);

  IF v_clean_name IS NULL OR length(v_clean_name) = 0 THEN
    RAISE EXCEPTION 'city name is required';
  END IF;
  IF length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'city name too long (max 100 characters)';
  END IF;

  -- Already approved? Don't accept the suggestion.
  IF EXISTS (
    SELECT 1 FROM public.admin_cities
    WHERE lower(trim(name)) = lower(v_clean_name)
  ) THEN
    RETURN NULL;
  END IF;

  -- Existing pending suggestion with same name? Bump counter.
  SELECT id INTO v_existing_id
  FROM public.city_suggestions
  WHERE lower(trim(name)) = lower(v_clean_name)
    AND status = 'pending'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.city_suggestions
       SET duplicate_count = duplicate_count + 1,
           -- Keep the most recent notes — sometimes the second user
           -- writes more helpful context than the first.
           notes = COALESCE(NULLIF(p_notes, ''), notes)
     WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  -- New suggestion
  INSERT INTO public.city_suggestions (
    name, original_input, notes, suggested_by_email
  ) VALUES (
    v_clean_name, p_name, NULLIF(p_notes, ''), v_user_email
  )
  RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END $$;

REVOKE ALL ON FUNCTION public.suggest_city(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_city(TEXT, TEXT) TO authenticated;


-- ─── 5) approve_city_suggestion RPC ───────────────────────────────────────
--
-- Admin approves a suggestion by providing canonical name + coordinates.
-- Atomic operation: creates admin_cities row, marks suggestion approved,
-- links them via approved_city_id.
--
-- Why a separate RPC instead of separate INSERT + UPDATE: ensures the
-- two writes happen together. Otherwise the admin UI could race-condition
-- a suggestion into a half-approved state if the second write fails.

CREATE OR REPLACE FUNCTION public.approve_city_suggestion(
  p_suggestion_id  UUID,
  p_canonical_name TEXT,
  p_lat            DECIMAL,
  p_lng            DECIMAL,
  p_governorate    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_admin_email TEXT;
  v_is_admin    BOOLEAN;
  v_city_id     UUID;
BEGIN
  v_admin_email := auth.email();
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  IF p_canonical_name IS NULL OR length(trim(p_canonical_name)) = 0 THEN
    RAISE EXCEPTION 'canonical name required';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'coordinates required';
  END IF;

  -- Insert into admin_cities. The CHECK constraints in the table
  -- enforce coordinate bounds and name length.
  INSERT INTO public.admin_cities (name, lat, lng, governorate, created_by)
  VALUES (trim(p_canonical_name), p_lat, p_lng, NULLIF(p_governorate, ''), v_admin_email)
  RETURNING id INTO v_city_id;

  -- Mark the suggestion approved
  UPDATE public.city_suggestions
     SET status = 'approved',
         approved_city_id = v_city_id,
         reviewed_by = v_admin_email,
         reviewed_at = NOW()
   WHERE id = p_suggestion_id;

  RETURN v_city_id;
END $$;

REVOKE ALL ON FUNCTION public.approve_city_suggestion(UUID, TEXT, DECIMAL, DECIMAL, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_city_suggestion(UUID, TEXT, DECIMAL, DECIMAL, TEXT) TO authenticated;


-- ─── 6) reject_city_suggestion RPC ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_city_suggestion(
  p_suggestion_id UUID,
  p_reason        TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_admin_email TEXT;
  v_is_admin    BOOLEAN;
BEGIN
  v_admin_email := auth.email();
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.city_suggestions
     SET status = 'rejected',
         rejection_reason = NULLIF(p_reason, ''),
         reviewed_by = v_admin_email,
         reviewed_at = NOW()
   WHERE id = p_suggestion_id;
END $$;

REVOKE ALL ON FUNCTION public.reject_city_suggestion(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_city_suggestion(UUID, TEXT) TO authenticated;


COMMIT;

-- =============================================================================
-- Verification
-- =============================================================================
-- 1) SELECT * FROM public.city_suggestions LIMIT 1;
-- 2) SELECT * FROM public.admin_cities LIMIT 1;
-- 3) Test suggest:
--      SELECT public.suggest_city('قرية تجريبية', 'بجانب طريق رام الله');
--      Expected: returns a UUID
--      SELECT * FROM public.city_suggestions WHERE name = 'قرية تجريبية';
--      Expected: status='pending', duplicate_count=1
-- 4) Re-suggest same name:
--      SELECT public.suggest_city('قرية تجريبية');
--      Expected: returns SAME UUID, duplicate_count incremented to 2
-- 5) Test approve (must be run as admin):
--      SELECT public.approve_city_suggestion(
--        'the-uuid-from-step-3', 'قرية تجريبية', 32.0, 35.2, 'رام الله'
--      );
--      Expected: returns city UUID, both tables updated
-- =============================================================================
