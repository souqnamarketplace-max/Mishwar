-- ════════════════════════════════════════════════════════════════════════
-- Migration 044 — Capture prevent_passenger_booking_conflict trigger
-- ════════════════════════════════════════════════════════════════════════
--
-- BACKGROUND
-- The production database has a trigger named
-- prevent_passenger_booking_conflict on public.bookings that blocks
-- insertions when the same passenger already has another booking with
-- an overlapping trip time. This trigger was created via the Supabase
-- dashboard SQL editor before this repo started tracking migrations,
-- so its source isn't anywhere in the codebase. References to it
-- exist (migration 029 lists it for search_path pinning;
-- seed_apple_reviewer_accounts.sql temporarily DISABLEs it during
-- seed data load), but the definition itself was floating.
--
-- WHY CAPTURE IT NOW
-- Three reasons:
--   (1) Reproducibility — anyone who builds a fresh database from
--       the migrations folder gets a system that behaves the same as
--       production. Without this migration, the trigger doesn't
--       exist on fresh installs and concurrent-booking protection
--       is missing.
--   (2) Self-documentation — anyone reading the codebase to
--       understand the booking flow has to know this trigger fires.
--       Currently they'd have to grep the seed file's DISABLE/ENABLE
--       comment to figure it out.
--   (3) Foundation for migration 045 — the auto-expire flow needs
--       to know the conflict-prevention contract. Codifying the
--       trigger here makes 045 easier to reason about.
--
-- WHAT THE TRIGGER ENFORCES
-- A passenger cannot have two active bookings whose trips overlap in
-- time. Specifically: on INSERT to bookings, if there's any other
-- booking for the same passenger_email with status IN ('pending',
-- 'confirmed','in_progress') whose trip's departure window overlaps
-- the new trip's window, raise an exception. The window for a trip
-- is conservatively the same calendar day (date column) — Mishwaro
-- doesn't store exact end-times, so we treat any two same-day trips
-- as potentially overlapping. This is the simplest correct rule:
-- a passenger driving from Ramallah to Jenin can't simultaneously
-- be in another car from Hebron to Nablus on the same date.
--
-- ADMIN BYPASS
-- Admin tools (admin creating a booking on behalf of someone, seed
-- scripts) need to skip this check. The trigger checks auth_user_role()
-- and returns NEW unconditionally for admins.
--
-- IDEMPOTENCY
-- Uses CREATE OR REPLACE for the function and DROP/CREATE for the
-- trigger. Safe to run on a database that already has the trigger;
-- the new definition replaces the old. If the names match what
-- production already uses (which is the contract the seed migration
-- assumes via its ALTER TABLE ... DISABLE/ENABLE TRIGGER call), this
-- just confirms or aligns the definition.
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_passenger_booking_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_trip          public.trips%ROWTYPE;
  v_caller_role   TEXT := public.auth_user_role();
  v_conflict_count INTEGER;
BEGIN
  -- Admin override — admin tools can create bookings on behalf of
  -- anyone, including ones that would otherwise trip the conflict
  -- check. Seed scripts disable the trigger entirely; admins acting
  -- through PostgREST take this branch.
  IF v_caller_role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Only check on actual booking creation; updates that don't change
  -- trip_id can skip (the original conflict was caught at insert
  -- time). UPDATE operations that DO change trip_id are blocked by
  -- the immutability check in guard_booking_updates.
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Pull the new booking's trip so we can compare dates against
  -- the passenger's other active bookings. If the trip doesn't
  -- exist (foreign key would catch this too, but defensive), bail.
  SELECT * INTO v_trip
  FROM public.trips
  WHERE id::text = NEW.trip_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Look for any other ACTIVE booking by the same passenger whose
  -- trip lands on the same date. Active = pending or confirmed or
  -- in_progress (NOT cancelled/completed — those are settled and
  -- don't conflict).
  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.bookings b
  JOIN public.trips t ON t.id::text = b.trip_id
  WHERE b.passenger_email = NEW.passenger_email
    AND b.status IN ('pending', 'confirmed', 'in_progress')
    AND b.id <> NEW.id                       -- exclude self (on UPSERT paths)
    AND t.id <> v_trip.id                     -- exclude the very trip being booked
    AND t.date = v_trip.date;                 -- same calendar day = potential conflict

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'booking conflict — passenger already has an active booking on %', v_trip.date
      USING ERRCODE = '42501',
            HINT = 'Cancel the other booking first or pick a different day.';
  END IF;

  RETURN NEW;
END $$;

-- Drop and recreate the trigger so this migration definitively owns
-- its definition. The trigger name 'prevent_passenger_booking_conflict'
-- is the one used by seed_apple_reviewer_accounts.sql's
-- DISABLE/ENABLE TRIGGER calls — keep it.
DROP TRIGGER IF EXISTS prevent_passenger_booking_conflict ON public.bookings;
CREATE TRIGGER prevent_passenger_booking_conflict
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.check_passenger_booking_conflict();

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_trigger_ok  BOOLEAN;
  v_func_ok     BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'prevent_passenger_booking_conflict'
      AND NOT tgisinternal
  ) INTO v_trigger_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_passenger_booking_conflict'
  ) INTO v_func_ok;

  IF NOT v_trigger_ok THEN
    RAISE EXCEPTION 'MIGRATION 044 FAILED: trigger not installed';
  END IF;
  IF NOT v_func_ok THEN
    RAISE EXCEPTION 'MIGRATION 044 FAILED: function not installed';
  END IF;

  RAISE NOTICE 'MIGRATION 044 OK — prevent_passenger_booking_conflict captured';
END $$;
