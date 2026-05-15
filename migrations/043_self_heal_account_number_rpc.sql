-- ════════════════════════════════════════════════════════════════════════
-- Migration 043 — Self-heal RPC for missing account_number
-- ════════════════════════════════════════════════════════════════════════
--
-- BACKGROUND
-- Migrations 041 + 042 should ensure every profile has an account_number,
-- but reports keep coming in that fresh accounts still show the UUID
-- fallback in AccountSettings. Possible causes:
--   - Migration 042's backfill missed a row because of timing
--   - 042 was never applied (user thought they applied "all" but missed one)
--   - The auth.users trigger didn't fire for some reason
--   - The signup path bypassed both triggers somehow
--
-- Rather than chase each cause, this migration adds a self-healing path:
-- an RPC that any signed-in user can call to fix their own row. The
-- AccountSettings page calls it silently when it loads if it detects
-- the user has no account_number. Result: the page heals itself the
-- moment a user opens it, no admin intervention needed.
--
-- SECURITY
-- - SECURITY DEFINER so it can update profiles regardless of RLS
-- - Authorization is the caller's auth.uid() — they can only fill in
--   their OWN row, never anyone else's
-- - Idempotent: if the row already has a number, returns it unchanged
-- - Cannot be used to renumber an existing account (the WHERE clause
--   only matches account_number IS NULL)
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ensure_my_account_number()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_existing   BIGINT;
  v_assigned   BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Already set? Return it (idempotent — page can call this on every
  -- mount without worrying about side effects).
  SELECT account_number INTO v_existing
  FROM public.profiles
  WHERE id = v_uid;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- NULL — assign one. UPDATE with the NULL guard so two concurrent
  -- calls from the same user (e.g. tab open in two windows) can't
  -- double-assign; the second hits a 0-row update and returns the
  -- value the first one set.
  UPDATE public.profiles
  SET account_number = nextval('public.mishwar_account_number_seq')
  WHERE id = v_uid
    AND account_number IS NULL
  RETURNING account_number INTO v_assigned;

  -- If the update affected 0 rows (race: another call set it first),
  -- re-read the row to pick up the value the other call assigned.
  IF v_assigned IS NULL THEN
    SELECT account_number INTO v_assigned
    FROM public.profiles
    WHERE id = v_uid;
  END IF;

  RETURN v_assigned;
END $$;

REVOKE EXECUTE ON FUNCTION public.ensure_my_account_number() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ensure_my_account_number() TO authenticated;

-- Verification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_my_account_number'
  ) THEN
    RAISE EXCEPTION 'MIGRATION 043 FAILED: RPC missing';
  END IF;
  RAISE NOTICE 'MIGRATION 043 OK — ensure_my_account_number RPC available';
END $$;
