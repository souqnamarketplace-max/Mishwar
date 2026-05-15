-- ════════════════════════════════════════════════════════════════════════
-- Migration 041 — Sequential human-readable account numbers
-- ════════════════════════════════════════════════════════════════════════
--
-- USER REQUEST (2026-05-14)
-- "The account number — just make it numbers starting with 1000 and so
-- on. Give the current users count start 1000, 1001, etc. It should be
-- updated everywhere."
--
-- WHY THIS MATTERS
-- The UUID 'e27456fe...' format is hard to read out loud, hard to
-- type, and impossible to remember. A short sequential integer
-- (M-1000, M-1001, M-1002...) is what every B2C app uses for support
-- references — Uber, Airbnb, Lyft all show a short reference number
-- to users, while keeping UUIDs (or auto-incrementing PKs) as the
-- internal database key.
--
-- DESIGN
--   • Keep profiles.id (UUID) as the primary key. Every foreign key
--     and JOIN in the schema points to profiles.id; changing it now
--     would be a massive surgery with no real benefit.
--   • Add a NEW column profiles.account_number (BIGINT UNIQUE) that
--     is the user-facing display identifier.
--   • Backfill existing users with sequential values starting at 1000,
--     ordered by profiles.created_at (so account #1000 is the very
--     first signup, #1001 is second, etc — historically meaningful
--     and feels like "you joined N-1000 days ago" if anyone counts).
--   • Create a sequence mishwar_account_number_seq that starts AFTER
--     the highest backfilled value, so new signups get the next free
--     number.
--   • Wire the sequence into the handle_new_user trigger so every
--     new profile row gets an account_number assigned automatically
--     during signup (no race risk — nextval() on a sequence is
--     atomic and PG handles concurrency).
--   • UNIQUE constraint catches any race that somehow bypasses the
--     sequence (defense in depth).
--
-- DISPLAY FORMAT
-- Database stores the raw integer. UI formats as "M-1000" (Mishwaro
-- prefix). Format conversion is client-side — keeps the DB clean and
-- lets the UI evolve the display format (M-1000 → MSH-1000 →
-- MSHWR-2026-1000 etc) without DB migrations.
--
-- WHAT THIS DOES NOT DO
-- This migration does not REMOVE the UUID. The UUID stays everywhere
-- it currently is. It just adds a parallel column for display. Admins
-- still look up users by UUID under the hood (via the copy-full-UUID
-- button on AccountSettings) OR by account number (new admin search
-- field added in the UI changes shipping in the same commit).
--
-- IDEMPOTENCY
-- Safe to re-run. ADD COLUMN IF NOT EXISTS, CREATE SEQUENCE IF NOT
-- EXISTS, backfill skips rows that already have account_number set,
-- DROP/CREATE on the trigger function is unconditional but harmless.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) Add the column ──────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_number BIGINT;

-- Add the UNIQUE constraint after backfill (next step). If we add it
-- here on an empty column, fine; if we re-run after a partial backfill
-- and some rows are already populated, this is also fine. Index name
-- is fixed so re-runs of the migration don't accumulate duplicate
-- indexes.

-- ─── (2) Create the sequence ─────────────────────────────────────────
-- The sequence starts at 1000 BUT we manually advance it after the
-- backfill to one past the max assigned value. So the actual starting
-- point of NEW signups depends on how many existing users we have.

CREATE SEQUENCE IF NOT EXISTS public.mishwar_account_number_seq
  START WITH 1000
  INCREMENT BY 1
  MINVALUE 1000
  NO MAXVALUE
  CACHE 1;

-- ─── (3) Backfill existing users ─────────────────────────────────────
-- Assign sequential numbers to every profile that doesn't have one
-- yet. Order by created_at ASC so the oldest user gets 1000, next-
-- oldest gets 1001, etc. Tie-breaker by id (UUID) so the order is
-- fully deterministic if multiple rows share an exact created_at.

DO $$
DECLARE
  v_next_num   BIGINT := 1000;
  v_assigned   INTEGER := 0;
  r            RECORD;
BEGIN
  -- Reset starting point: if some rows were already backfilled (re-run),
  -- pick up after the highest existing value.
  SELECT COALESCE(MAX(account_number), 999) + 1
  INTO v_next_num
  FROM public.profiles
  WHERE account_number IS NOT NULL;

  FOR r IN
    SELECT id
    FROM public.profiles
    WHERE account_number IS NULL
    ORDER BY created_at ASC NULLS LAST, id ASC
  LOOP
    UPDATE public.profiles
    SET account_number = v_next_num
    WHERE id = r.id;
    v_next_num := v_next_num + 1;
    v_assigned := v_assigned + 1;
  END LOOP;

  RAISE NOTICE 'MIGRATION 041: backfilled % profiles with account_number', v_assigned;

  -- Advance the sequence to one past the last assigned value so new
  -- signups don't collide with backfilled numbers.
  PERFORM setval('public.mishwar_account_number_seq', v_next_num - 1, true);
END $$;

-- ─── (4) UNIQUE constraint ───────────────────────────────────────────
-- Now that every row has a value, enforce uniqueness so the sequence
-- (or any future manual insert) can't accidentally produce a duplicate.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_account_number_unique'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_number_unique
      UNIQUE (account_number);
  END IF;
END $$;

-- Index for lookups by account_number (admin search-by-account-number).
-- The UNIQUE constraint above creates an implicit index, so a separate
-- CREATE INDEX is redundant. Documented here so future readers know
-- the lookup path is covered.

-- ─── (5) Wire into handle_new_user trigger ───────────────────────────
-- The signup trigger inserts a row into public.profiles. We need it
-- to also pull the next sequence value and assign account_number on
-- that insert. Otherwise new users land with NULL account_number and
-- the UI breaks.
--
-- handle_new_user already evolved through migrations 002 / 033 (for
-- Google OAuth metadata). We CREATE OR REPLACE here preserving the
-- existing body and adding account_number to the INSERT.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, account_number, created_at, updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ),
    nextval('public.mishwar_account_number_seq'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

-- Re-create the trigger to make sure it points at the new function
-- body. DROP/CREATE is safer than relying on CREATE OR REPLACE picking
-- up the new body (it should, but be explicit).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_null_count    INTEGER;
  v_total_count   INTEGER;
  v_max_assigned  BIGINT;
  v_seq_last      BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM public.profiles WHERE account_number IS NULL;
  SELECT COUNT(*) INTO v_total_count FROM public.profiles;
  SELECT COALESCE(MAX(account_number), 0) INTO v_max_assigned FROM public.profiles;
  SELECT last_value INTO v_seq_last FROM public.mishwar_account_number_seq;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION 041 FAILED: % profiles still have NULL account_number', v_null_count;
  END IF;

  IF v_seq_last < v_max_assigned THEN
    RAISE EXCEPTION 'MIGRATION 041 FAILED: sequence last_value (%) < max assigned (%) — next signup will collide',
      v_seq_last, v_max_assigned;
  END IF;

  RAISE NOTICE 'MIGRATION 041 OK — % profiles, account_numbers 1000-%, sequence at %',
    v_total_count, v_max_assigned, v_seq_last;
END $$;
