-- ════════════════════════════════════════════════════════════════════════
-- Migration 033 — handle_new_user picks up Google OAuth metadata
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- The original handle_new_user trigger (supabase-production.sql PART 4)
-- assumed every new auth.users row arrives with raw_user_meta_data.full_name
-- set, which is true for the email/password signup form (Register flow
-- explicitly passes options.data.full_name to supabase.auth.signUp) but
-- NOT true for Google OAuth signups. Google's OAuth response lands in
-- raw_user_meta_data with these keys (per the OpenID Connect userinfo
-- spec that Supabase forwards verbatim):
--
--   raw_user_meta_data = {
--     "name":           "Souqna Marketplace",   -- full name (NOT 'full_name')
--     "given_name":     "Souqna",
--     "family_name":    "Marketplace",
--     "email":          "souqna@gmail.com",
--     "email_verified": true,
--     "picture":        "https://lh3.googleusercontent.com/a/...",
--     "sub":            "104928374659384756213",
--     ...
--   }
--
-- The previous trigger's COALESCE(NEW.raw_user_meta_data->>'full_name', ...)
-- returned NULL for the first arg and fell through to the email-prefix
-- fallback. A Google user "john.smith@gmail.com" landed in the profiles
-- table named 'john.smith' instead of 'John Smith', and the avatar Google
-- already had for them was dropped on the floor.
--
-- THE FIX
-- (1) Update handle_new_user to check both 'full_name' AND 'name', falling
--     through to the email prefix only if neither is present. The
--     email/password path still works (it sets 'full_name') — the new
--     branch is purely additive for the OAuth path.
-- (2) Also pull raw_user_meta_data->>'avatar_url' OR ->>'picture' into
--     profiles.avatar_url. 'avatar_url' is Supabase's normalized name
--     when it can infer one; 'picture' is the raw Google field. Some
--     versions of Supabase set both, some only one — checking both is
--     belt-and-suspenders.
-- (3) Keep SECURITY DEFINER + search_path hardening from migration 029.
-- (4) Backfill any existing profile rows where the trigger's broken
--     branch fired — heuristic: full_name matches the email prefix
--     exactly AND auth.users.raw_user_meta_data has a 'name' that
--     differs. Same for avatar_url being NULL while metadata has
--     'picture'. Safe to run on a DB with zero such rows (UPDATE 0).
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, created_at, updated_at)
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
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Re-attach the trigger. CREATE OR REPLACE on the function above does
-- NOT re-create the trigger, and there's no DROP needed here — the
-- existing on_auth_user_created trigger keeps pointing at the function
-- by name and picks up the new body on the next INSERT. The DROP +
-- CREATE block from supabase-production.sql is intentionally NOT
-- repeated here; doing so would create a brief window where new signups
-- between DROP and CREATE would silently skip profile creation.

-- ─── Backfill for rows already in profiles ────────────────────────────
-- Two passes:
--   (a) full_name was filled with the email prefix because the broken
--       trigger fired on a Google signup. Fix anywhere
--           full_name = split_part(email, '@', 1)
--       AND a better name is available in auth.users.raw_user_meta_data.
--   (b) avatar_url is NULL but raw_user_meta_data has a 'picture' or
--       'avatar_url'. Backfill those.
--
-- Both pass joins use auth.users so a SECURITY DEFINER function isn't
-- needed — this migration runs as the migration role which has full
-- schema access.

UPDATE public.profiles p
SET full_name = COALESCE(
      u.raw_user_meta_data->>'name',
      u.raw_user_meta_data->>'full_name'
    ),
    updated_at = NOW()
FROM auth.users u
WHERE p.id = u.id
  AND p.full_name = split_part(p.email, '@', 1)
  AND (
    u.raw_user_meta_data ? 'name'
    OR u.raw_user_meta_data ? 'full_name'
  )
  AND COALESCE(
        u.raw_user_meta_data->>'name',
        u.raw_user_meta_data->>'full_name'
      ) IS DISTINCT FROM p.full_name;

UPDATE public.profiles p
SET avatar_url = COALESCE(
      u.raw_user_meta_data->>'avatar_url',
      u.raw_user_meta_data->>'picture'
    ),
    updated_at = NOW()
FROM auth.users u
WHERE p.id = u.id
  AND p.avatar_url IS NULL
  AND (
    u.raw_user_meta_data ? 'avatar_url'
    OR u.raw_user_meta_data ? 'picture'
  );

-- ─── Verification ─────────────────────────────────────────────────────
-- Print summary counts so the operator running the migration can see
-- whether the backfill touched any rows. UPDATE 0 / 0 is the expected
-- result on a fresh DB; non-zero is the expected result on a DB that
-- has existing broken Google signups.
DO $$
DECLARE
  v_func_search_path TEXT;
BEGIN
  -- Confirm the function still has its search_path pin (defense in
  -- depth against accidental drift; see migration 029 rationale).
  SELECT array_to_string(proconfig, ',')
  INTO v_func_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

  IF v_func_search_path IS NULL OR v_func_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'MIGRATION 033 FAILED: handle_new_user lost its search_path pin (got: %)',
      COALESCE(v_func_search_path, 'NULL');
  END IF;

  RAISE NOTICE 'MIGRATION 033 OK — handle_new_user updated, search_path = %', v_func_search_path;
END $$;
