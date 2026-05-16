-- ════════════════════════════════════════════════════════════════════════
-- Migration 058 — Age gate + Terms consent stamp at the database layer
-- ════════════════════════════════════════════════════════════════════════
--
-- CONTEXT
-- Pre-launch audit Section 8 flagged two compliance gaps:
--   (1) Terms section 3 claims 18+ eligibility, but there's no actual
--       age check anywhere in signup. App Store rejects rideshare apps
--       (5.1.1 + 1.3) for claiming age-restricted content without
--       enforcement.
--   (2) Implicit consent ("by signing up you agree to...") is borderline.
--       Apple prefers explicit checkbox + a record of which Terms
--       version the user accepted, so a later material change can
--       re-prompt only the affected users.
--
-- The frontend now collects DOB + an explicit consent checkbox at
-- signup (src/pages/Login.jsx). This migration provides the matching
-- database layer:
--
--   - profiles.date_of_birth          DATE      — null on legacy rows
--   - profiles.terms_accepted_at      TIMESTAMPTZ
--   - profiles.terms_version          TEXT      — e.g. "2026-05-01"
--   - CHECK constraint: if DOB set, must be ≥18 years ago AND ≤120 yrs ago
--   - handle_new_user updated to read these from raw_user_meta_data
--
-- DESIGN NOTES
--
-- WHY NULLABLE COLUMNS?
-- Existing user rows pre-date this migration and don't have DOB. We
-- can't reject their reads/writes — they signed up before the rule
-- existed. The CHECK constraint is "date_of_birth IS NULL OR (age
-- conditions)", so existing rows stay valid. The frontend is
-- responsible for prompting legacy users to fill DOB before they can
-- do age-gated actions (booking, posting). Implementation of that
-- prompt is out of scope for this migration — TODO for V1.1.
--
-- WHY DB-LAYER CHECK ON TOP OF CLIENT-SIDE VALIDATION?
-- Client-side keeps the form honest. Server-side stops an attacker
-- who skips the form (curl + raw signUp call with crafted
-- raw_user_meta_data, or direct PATCH to profiles after signup). The
-- CHECK constraint is the actual enforcement; the frontend is UX.
--
-- WHY current_date - INTERVAL '18 years' ?
-- The expression is volatile but PostgreSQL allows volatile expressions
-- in CHECK constraints — they're re-evaluated on every INSERT/UPDATE.
-- A user born exactly 18 years ago today passes; one born one day
-- short fails. Matches the client validator (validateDateOfBirth).
--
-- IDEMPOTENCY
-- Migrations 002-057 have established the pattern: this script can be
-- re-run safely. ADD COLUMN IF NOT EXISTS, constraint guarded by
-- pg_constraint lookup, function CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── (1) Add columns ────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth     DATE,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version     TEXT;

-- ─── (2) Age CHECK constraint ───────────────────────────────────────
-- Allows NULL (legacy rows + any future use case where DOB is genuinely
-- unknown) but if non-null requires real-human age range.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_dob_age_check'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_dob_age_check
      CHECK (
        date_of_birth IS NULL
        OR (
          date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
          AND date_of_birth >= (CURRENT_DATE - INTERVAL '120 years')::date
        )
      ) NOT VALID;
    -- NOT VALID means the constraint applies only to NEW rows + updates,
    -- not retroactively to existing rows. We then attempt to VALIDATE,
    -- which checks existing rows. If any existing row would fail, we
    -- log a warning rather than abort the migration — operations team
    -- can clean those rows up separately (in practice there should be
    -- zero, since the column was just added as NULL).
    BEGIN
      ALTER TABLE public.profiles
        VALIDATE CONSTRAINT profiles_dob_age_check;
      RAISE NOTICE '✓ profiles_dob_age_check validated against existing rows';
    EXCEPTION
      WHEN check_violation THEN
        RAISE WARNING 'profiles has rows that would fail the new DOB CHECK; constraint left NOT VALID for those rows. Clean up manually.';
    END;
  ELSE
    RAISE NOTICE '✓ profiles_dob_age_check already exists — skipping';
  END IF;
END $$;

-- ─── (3) Update handle_new_user to read DOB + consent metadata ──────
-- The trigger fires on auth.users INSERT and creates a profiles row.
-- Migration 033 last updated it to handle Google OAuth's metadata
-- shape. This migration extends it to also pick up date_of_birth +
-- terms_accepted_at + terms_version from raw_user_meta_data, which
-- the signup form (src/pages/Login.jsx → register() →
-- supabase.auth.signUp({options:{data:...}})) now provides.
--
-- IMPORTANT: SECURITY DEFINER + search_path hardening from migrations
-- 029/033 preserved. The function body must not reference any
-- unqualified objects.
--
-- Edge case: if a signer-upper bypasses the form (curl + raw signUp)
-- and omits DOB, raw_user_meta_data->>'date_of_birth' is NULL and the
-- INSERT proceeds with date_of_birth = NULL. The CHECK constraint
-- allows NULL. The user can then sign in but won't be able to do
-- anything age-gated until they set DOB. Acceptable — we're not
-- trying to brick non-conformant signups, just gate the dangerous
-- actions on confirmed age.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_dob_raw       TEXT;
  v_dob           DATE;
  v_terms_at_raw  TEXT;
  v_terms_at      TIMESTAMPTZ;
  v_terms_version TEXT;
BEGIN
  -- Parse DOB defensively. raw_user_meta_data->>'date_of_birth' is
  -- whatever the client sent; the client sends yyyy-mm-dd from the
  -- <input type="date">. If parse fails we INSERT NULL rather than
  -- aborting the whole user creation — the user can fix it later.
  v_dob_raw := NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '');
  IF v_dob_raw IS NOT NULL THEN
    BEGIN
      v_dob := v_dob_raw::date;
      -- Defensive age check INSIDE the trigger too. The CHECK constraint
      -- on profiles would reject an under-age DOB, but raising here
      -- gives a cleaner error message AND prevents partial state (the
      -- auth.users row would exist with no profiles row, blocking the
      -- user from any cleanup).
      IF v_dob > (CURRENT_DATE - INTERVAL '18 years')::date THEN
        RAISE EXCEPTION 'date_of_birth indicates age below 18'
          USING ERRCODE = '23514';   -- check_violation
      END IF;
      IF v_dob < (CURRENT_DATE - INTERVAL '120 years')::date THEN
        v_dob := NULL;  -- obvious garbage → null out
      END IF;
    EXCEPTION
      WHEN invalid_datetime_format THEN
        v_dob := NULL;
    END;
  END IF;

  v_terms_at_raw  := NULLIF(NEW.raw_user_meta_data->>'terms_accepted_at', '');
  IF v_terms_at_raw IS NOT NULL THEN
    BEGIN
      v_terms_at := v_terms_at_raw::timestamptz;
    EXCEPTION
      WHEN invalid_datetime_format THEN
        v_terms_at := NULL;
    END;
  END IF;

  v_terms_version := NULLIF(NEW.raw_user_meta_data->>'terms_version', '');

  INSERT INTO public.profiles (
    id, email, full_name, avatar_url,
    date_of_birth, terms_accepted_at, terms_version,
    created_at, updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    -- Name resolution order:
    --   1. 'full_name' (email/password signup form sets this)
    --   2. 'name'      (Google OAuth + most OIDC providers use this)
    --   3. email prefix (last-resort fallback, will be edited in onboarding)
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    -- Avatar resolution:
    --   1. 'avatar_url' (Supabase-normalized key, when set)
    --   2. 'picture'    (Google's native key)
    --   3. NULL — UI shows initials-circle fallback (Avatar.jsx)
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ),
    v_dob,
    v_terms_at,
    v_terms_version,
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  -- Columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='date_of_birth') THEN
    v_missing := v_missing || E'\n  - profiles.date_of_birth column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='terms_accepted_at') THEN
    v_missing := v_missing || E'\n  - profiles.terms_accepted_at column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='profiles'
                    AND column_name='terms_version') THEN
    v_missing := v_missing || E'\n  - profiles.terms_version column';
  END IF;
  -- Constraint
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname='profiles_dob_age_check'
                    AND conrelid='public.profiles'::regclass) THEN
    v_missing := v_missing || E'\n  - profiles_dob_age_check constraint';
  END IF;
  -- Trigger function
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON p.pronamespace = n.oid
                  WHERE n.nspname='public' AND p.proname='handle_new_user') THEN
    v_missing := v_missing || E'\n  - handle_new_user function';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRATION 058 FAILED — missing: %', v_missing;
  END IF;
  RAISE NOTICE 'MIGRATION 058 OK — age gate + consent stamp in place';
END $$;

COMMIT;
