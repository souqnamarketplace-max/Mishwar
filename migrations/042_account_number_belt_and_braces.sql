-- ════════════════════════════════════════════════════════════════════════
-- Migration 042 — bulletproof account_number auto-assign + backfill
-- ════════════════════════════════════════════════════════════════════════
--
-- USER REPORT (2026-05-14)
-- Created a fresh account after migration 041 was applied; the account
-- ID still shows the MSH-XXXX-XXXX UUID fallback ('MSH-2079-D50B') in
-- AccountSettings, meaning profile.account_number is NULL.
--
-- WHY MIGRATION 041 ALONE WASN'T ENOUGH
-- 041 wired account_number assignment into ONE place: the
-- handle_new_user trigger on auth.users (the Supabase Auth signup
-- hook). That works IF every signup path lands through auth.users
-- → INSERT → handle_new_user → INSERT into profiles with the
-- nextval(). But it has gaps:
--
--   (1) Race condition: if some path (admin tools, seed scripts, or
--       a manual signup variant) inserts into profiles BEFORE
--       handle_new_user fires, the ON CONFLICT (id) DO NOTHING
--       in 041's trigger silently skips the row → no account_number.
--   (2) Direct profile inserts: any future code path that creates a
--       profile row directly (admin creating a user, restore-from-
--       backup, data migration) would bypass handle_new_user
--       entirely.
--   (3) The trigger replacement in 041 may not have taken effect if
--       the migration was applied partially or with an error.
--
-- BULLETPROOF FIX
-- Add a BEFORE INSERT trigger on public.profiles itself. The trigger
-- fires for EVERY new profile row regardless of source:
--   - auth.users → handle_new_user → profiles INSERT ✓
--   - Admin tools doing a direct profiles INSERT ✓
--   - Migration / seed scripts ✓
--   - Anything else that touches profiles ✓
--
-- The trigger logic: if NEW.account_number IS NULL, pull a value
-- from the sequence. If it's already set (caller pre-assigned it,
-- e.g. seed data with explicit numbering), respect that choice.
--
-- BACKFILL
-- After installing the trigger, sweep up any NULL account_number
-- rows that have accumulated since 041. This fixes:
--   - The reporter's just-created account
--   - Any other users who slipped through
--   - Any users from race conditions in 041
--
-- IDEMPOTENT
-- Re-running this migration is safe. The trigger DROP/CREATE is
-- explicit; the backfill only touches rows where account_number
-- IS NULL.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) The auto-assign trigger on profiles ─────────────────────────
CREATE OR REPLACE FUNCTION public.assign_account_number_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Only assign if the caller didn't pre-assign. Lets admin tools or
  -- seed scripts use explicit numbers (e.g. reserved range for staff
  -- accounts) if they want; otherwise the sequence drives it.
  IF NEW.account_number IS NULL THEN
    NEW.account_number := nextval('public.mishwar_account_number_seq');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assign_account_number_on_insert ON public.profiles;
CREATE TRIGGER assign_account_number_on_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_account_number_on_insert();

-- ─── (2) Backfill any NULL rows ──────────────────────────────────────
-- Same pattern as migration 041's backfill: order by created_at so
-- the assignment is deterministic, advance the sequence at the end
-- so future signups don't collide.

DO $$
DECLARE
  v_next_num   BIGINT;
  v_assigned   INTEGER := 0;
  r            RECORD;
BEGIN
  -- Resume from one past the highest existing value.
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
    -- Update directly, bypassing the auto-assign trigger we just
    -- installed (it's BEFORE INSERT, not BEFORE UPDATE, so the
    -- UPDATE statement won't fire it anyway — but writing it with
    -- v_next_num explicit makes the intent clear and the order
    -- deterministic across runs).
    UPDATE public.profiles
    SET account_number = v_next_num
    WHERE id = r.id;
    v_next_num := v_next_num + 1;
    v_assigned := v_assigned + 1;
  END LOOP;

  -- Advance the sequence past the highest assigned value so the next
  -- nextval() call (from the new trigger or handle_new_user) starts
  -- after, not on top of, the just-backfilled rows.
  IF v_next_num > 1000 THEN
    PERFORM setval('public.mishwar_account_number_seq', v_next_num - 1, true);
  END IF;

  RAISE NOTICE 'MIGRATION 042: backfilled % rows with account_number', v_assigned;
END $$;

-- ─── Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_null_count    INTEGER;
  v_total_count   INTEGER;
  v_max_assigned  BIGINT;
  v_seq_last      BIGINT;
  v_trigger_ok    BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM public.profiles WHERE account_number IS NULL;
  SELECT COUNT(*) INTO v_total_count FROM public.profiles;
  SELECT COALESCE(MAX(account_number), 0) INTO v_max_assigned FROM public.profiles;
  SELECT last_value INTO v_seq_last FROM public.mishwar_account_number_seq;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'assign_account_number_on_insert'
      AND NOT tgisinternal
  ) INTO v_trigger_ok;

  IF NOT v_trigger_ok THEN
    RAISE EXCEPTION 'MIGRATION 042 FAILED: assign_account_number_on_insert trigger missing';
  END IF;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION 042 FAILED: % profiles still have NULL account_number after backfill', v_null_count;
  END IF;

  IF v_seq_last < v_max_assigned THEN
    RAISE EXCEPTION 'MIGRATION 042 FAILED: sequence last_value (%) < max assigned (%) — next signup will collide',
      v_seq_last, v_max_assigned;
  END IF;

  RAISE NOTICE 'MIGRATION 042 OK — % profiles, account_numbers 1000-%, trigger installed, sequence at %',
    v_total_count, v_max_assigned, v_seq_last;
END $$;
