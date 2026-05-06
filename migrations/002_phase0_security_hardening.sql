-- =============================================================================
-- مِشوار  — PHASE 0 SECURITY HARDENING
-- =============================================================================
-- Generated from the pre-launch audit (see docs/audits/Mishwar-Pre-Launch-Audit.md)
--
-- This migration closes the critical RLS holes that were trivially exploitable
-- via direct PostgREST calls. Every section is idempotent — safe to re-run.
--
-- HOW TO APPLY:
--   1. Take a Supabase backup first (Dashboard → Database → Backups → "Create
--      backup now"). On Free plan, do a manual `pg_dump` or accept the risk.
--   2. Open Supabase SQL Editor
--   3. Paste the entire contents of THIS FILE in one go and run.
--   4. The verification block at the bottom will print success/fail per fix.
--
-- ADDRESSES:
--   C-01  privilege escalation via user-editable role
--   C-04  bookings_update column-level integrity
--   C-04b trips_update_driver column-level integrity
--   C-07  notifications_insert spam vector
--   C-08  review fraud (no booking precondition)
--   C-09  receivers can edit message content
--   H-05  SECURITY DEFINER functions missing search_path
--   M-12  available_seats negative-clamp constraint
--
-- DOES NOT INCLUDE (require larger code+data changes; deferred to phase 1):
--   C-03  storage public-bucket migration  → separate migration once new
--                                             private bucket is created and
--                                             upload paths are namespaced
--   C-05  account-deletion email anonymization  → requires server-side updates
--                                                  to denormalized columns; the
--                                                  RPC scaffold below is ready
--                                                  but not wired into the UI
--   C-06  atomic seat-booking RPC  → scaffolded below; UI cutover is a
--                                    follow-up commit
--
-- After this migration: re-run the audit with the same exploit attempts to
-- confirm each one now returns 42501 / 23514 / etc. instead of succeeding.
-- =============================================================================


-- =============================================================================
-- PRE-FLIGHT — audit current admins before any policy change
-- =============================================================================
-- If this returns more than the expected admin set (souqnamarketplace@gmail.com),
-- STOP and investigate before applying the rest of the migration.
DO $$
DECLARE
  admin_row RECORD;
  admin_count INT := 0;
BEGIN
  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'PRE-FLIGHT — current admins on this database:';
  FOR admin_row IN
    SELECT email, full_name, created_at
    FROM public.profiles
    WHERE role = 'admin'
    ORDER BY created_at
  LOOP
    RAISE NOTICE '  → %  (%) created %', admin_row.email, admin_row.full_name, admin_row.created_at;
    admin_count := admin_count + 1;
  END LOOP;
  RAISE NOTICE 'Total admins: %', admin_count;
  RAISE NOTICE '────────────────────────────────────────────────────────';
  IF admin_count = 0 THEN
    RAISE WARNING 'No admins found! After this migration only admins can broadcast / approve licenses / etc.';
  END IF;
END $$;


-- =============================================================================
-- SECTION 1 — H-05 — Pin search_path on existing SECURITY DEFINER helpers
-- =============================================================================
-- SECURITY DEFINER functions run with elevated privileges; pinning search_path
-- prevents an attacker who can create temp objects from shadowing schema-
-- unqualified references.
CREATE OR REPLACE FUNCTION public.auth_user_email()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;


-- =============================================================================
-- SECTION 2 — C-01 — Lock profiles_update against role / email / deleted_at
--                    privilege-escalation
-- =============================================================================
-- The previous policy was:
--   FOR UPDATE TO authenticated USING (id = auth.uid())
-- with NO WITH CHECK clause. Postgres falls back to USING for the implicit
-- WITH CHECK, which only validates id stays the same — meaning any user could
-- PATCH their own row and set role='admin'. This is the single most dangerous
-- bug in the codebase. We close it three ways:
--   (a) Tighten the WITH CHECK to forbid changes to role / email / deleted_at
--   (b) Add a BEFORE UPDATE trigger as defense-in-depth that ALSO refuses
--       protected-column changes for non-admins. Belt + suspenders because
--       WITH CHECK subqueries can be subtle.
--   (c) profiles_admin_update unchanged (admins can still update anyone).

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role        IS NOT DISTINCT FROM (SELECT role        FROM public.profiles p2 WHERE p2.id = auth.uid())
    AND email       IS NOT DISTINCT FROM (SELECT email       FROM public.profiles p2 WHERE p2.id = auth.uid())
    AND deleted_at  IS NOT DISTINCT FROM (SELECT deleted_at  FROM public.profiles p2 WHERE p2.id = auth.uid())
  );

-- Defense-in-depth trigger
CREATE OR REPLACE FUNCTION public.guard_profile_protected_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS DISTINCT FROM 'admin' THEN
    IF NEW.role        IS DISTINCT FROM OLD.role        THEN
      RAISE EXCEPTION 'modifying role requires admin'        USING ERRCODE = '42501';
    END IF;
    IF NEW.email       IS DISTINCT FROM OLD.email       THEN
      RAISE EXCEPTION 'modifying email requires admin'       USING ERRCODE = '42501';
    END IF;
    IF NEW.deleted_at  IS DISTINCT FROM OLD.deleted_at  THEN
      -- self-deletion sets deleted_at — that path runs through the
      -- SECURITY DEFINER RPC (delete_user_account), bypassing this trigger.
      -- Direct UPDATEs to deleted_at are NOT allowed.
      RAISE EXCEPTION 'modifying deleted_at requires admin or RPC' USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'cannot change id'                    USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_profile_protected_columns ON public.profiles;
CREATE TRIGGER guard_profile_protected_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_protected_columns();


-- =============================================================================
-- SECTION 3 — C-04 — Lock bookings UPDATE to safe transitions only
-- =============================================================================
-- Previous policy let passenger / driver UPDATE their booking with NO column
-- restriction — passengers could self-mark bookings paid, change seats,
-- flip status back from cancelled. We keep the existing RLS policy (decides
-- WHO can update) and add a BEFORE UPDATE trigger (decides WHAT they can
-- change). Admin bypass.

CREATE OR REPLACE FUNCTION public.guard_booking_updates()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_email TEXT := public.auth_user_email();
  caller_role  TEXT := public.auth_user_role();
  is_passenger BOOLEAN := (OLD.passenger_email = caller_email);
  is_driver    BOOLEAN := EXISTS (
    SELECT 1 FROM public.trips
    WHERE id::text = OLD.trip_id
      AND driver_email = caller_email
  );
BEGIN
  -- Admin can do anything
  IF caller_role = 'admin' THEN RETURN NEW; END IF;

  -- Identity columns are immutable for everyone except admin
  IF NEW.passenger_email IS DISTINCT FROM OLD.passenger_email THEN
    RAISE EXCEPTION 'cannot change passenger_email'        USING ERRCODE = '42501';
  END IF;
  IF NEW.trip_id         IS DISTINCT FROM OLD.trip_id         THEN
    RAISE EXCEPTION 'cannot change trip_id'                 USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at      IS DISTINCT FROM OLD.created_at      THEN
    RAISE EXCEPTION 'cannot change created_at'              USING ERRCODE = '42501';
  END IF;

  IF is_passenger AND NOT is_driver THEN
    -- Passenger can only cancel + edit their own pickup/dropoff/notes
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      RAISE EXCEPTION 'passengers cannot change payment_status' USING ERRCODE = '42501';
    END IF;
    IF NEW.paid_at        IS DISTINCT FROM OLD.paid_at        THEN
      RAISE EXCEPTION 'passengers cannot change paid_at'        USING ERRCODE = '42501';
    END IF;
    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      RAISE EXCEPTION 'passengers cannot change payment_method' USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_status  IS DISTINCT FROM OLD.refund_status  THEN
      RAISE EXCEPTION 'passengers cannot change refund_status'  USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_amount  IS DISTINCT FROM OLD.refund_amount  THEN
      RAISE EXCEPTION 'passengers cannot change refund_amount'  USING ERRCODE = '42501';
    END IF;
    IF NEW.no_show        IS DISTINCT FROM OLD.no_show        THEN
      RAISE EXCEPTION 'passengers cannot change no_show'        USING ERRCODE = '42501';
    END IF;
    IF NEW.seats_booked   IS DISTINCT FROM OLD.seats_booked   THEN
      RAISE EXCEPTION 'passengers cannot change seats_booked'   USING ERRCODE = '42501';
    END IF;
    IF NEW.cancel_reason  IS DISTINCT FROM OLD.cancel_reason  THEN
      -- allow setting it once on cancellation only
      IF OLD.cancel_reason IS NOT NULL THEN
        RAISE EXCEPTION 'cancel_reason already set'             USING ERRCODE = '42501';
      END IF;
    END IF;
    -- status transitions: passenger may only cancel
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'passengers can only cancel'           USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF is_driver AND NOT is_passenger THEN
    -- Driver can confirm, mark no_show, mark paid, cancel-by-driver
    IF NEW.seats_booked   IS DISTINCT FROM OLD.seats_booked   THEN
      RAISE EXCEPTION 'drivers cannot change seats_booked'      USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_status  IS DISTINCT FROM OLD.refund_status   THEN
      RAISE EXCEPTION 'refund_status is admin-only'             USING ERRCODE = '42501';
    END IF;
    IF NEW.refund_amount  IS DISTINCT FROM OLD.refund_amount   THEN
      RAISE EXCEPTION 'refund_amount is admin-only'             USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_booking_updates ON public.bookings;
CREATE TRIGGER guard_booking_updates
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_updates();


-- =============================================================================
-- SECTION 4 — H-12 — Lock trips UPDATE to safe transitions
-- =============================================================================
-- Drivers could change driver_email (transfer trips), price (after passengers
-- booked), or from/to_city (changing what passengers paid for). We keep the
-- RLS policy and gate WHAT can change.

CREATE OR REPLACE FUNCTION public.guard_trip_updates()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_email TEXT := public.auth_user_email();
  caller_role  TEXT := public.auth_user_role();
  has_bookings BOOLEAN := EXISTS (
    SELECT 1 FROM public.bookings
    WHERE trip_id = OLD.id::text
      AND status IN ('confirmed','completed')
  );
BEGIN
  IF caller_role = 'admin' THEN RETURN NEW; END IF;

  -- driver_email immutable
  IF NEW.driver_email IS DISTINCT FROM OLD.driver_email THEN
    RAISE EXCEPTION 'cannot change driver_email'           USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'cannot change trip id'                USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'cannot change created_at'             USING ERRCODE = '42501';
  END IF;

  -- Once anyone has booked, route + price + date + time are frozen.
  -- Driver can still cancel the whole trip, edit notes/car details,
  -- adjust available_seats (but not below seats already booked).
  IF has_bookings THEN
    IF NEW.from_city IS DISTINCT FROM OLD.from_city THEN
      RAISE EXCEPTION 'cannot change from_city after first booking'  USING ERRCODE = '42501';
    END IF;
    IF NEW.to_city   IS DISTINCT FROM OLD.to_city   THEN
      RAISE EXCEPTION 'cannot change to_city after first booking'    USING ERRCODE = '42501';
    END IF;
    IF NEW.price     IS DISTINCT FROM OLD.price     THEN
      RAISE EXCEPTION 'cannot change price after first booking'      USING ERRCODE = '42501';
    END IF;
    IF NEW.date      IS DISTINCT FROM OLD.date      THEN
      RAISE EXCEPTION 'cannot change date after first booking'       USING ERRCODE = '42501';
    END IF;
    IF NEW.time      IS DISTINCT FROM OLD.time      THEN
      RAISE EXCEPTION 'cannot change time after first booking'       USING ERRCODE = '42501';
    END IF;
  END IF;

  -- total_seats is set at creation, never changes
  IF NEW.total_seats IS DISTINCT FROM OLD.total_seats THEN
    RAISE EXCEPTION 'cannot change total_seats'            USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_trip_updates ON public.trips;
CREATE TRIGGER guard_trip_updates
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.guard_trip_updates();


-- =============================================================================
-- SECTION 5 — C-07 — Lock notifications_insert against spam vector
-- =============================================================================
-- Previous policy: WITH CHECK (true). Any authenticated user could insert any
-- notification with any user_email. New policy: only self-targeted, only via
-- SECURITY DEFINER triggers, or by admin. Cross-user notifications already go
-- through SECURITY DEFINER triggers (notify_driver_on_booking, etc.) which
-- bypass RLS, so this doesn't break legitimate flows.

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );


-- =============================================================================
-- SECTION 6 — C-08 — Reviewer must have a completed booking with reviewee
-- =============================================================================
-- The reviews_insert policy only verified reviewer_email = caller. Any user
-- could leave reviews on any other user. We add a precondition trigger that
-- requires a confirmed/completed booking on a completed trip linking the
-- reviewer and the reviewed party in the correct direction.

CREATE OR REPLACE FUNCTION public.guard_review_must_have_booking()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  has_relation BOOLEAN;
BEGIN
  -- Admin can override (rare; for moderation / restoration)
  IF public.auth_user_role() = 'admin' THEN RETURN NEW; END IF;

  IF NEW.review_type = 'passenger_rates_driver' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.trips t ON t.id::text = b.trip_id
      WHERE b.passenger_email = NEW.reviewer_email
        AND t.driver_email    = NEW.driver_email
        AND b.status IN ('confirmed','completed')
        AND t.status IN ('completed','in_progress')
    ) INTO has_relation;
  ELSIF NEW.review_type = 'driver_rates_passenger' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.trips t ON t.id::text = b.trip_id
      WHERE t.driver_email    = NEW.reviewer_email
        AND b.passenger_email = COALESCE(NEW.reviewed_email, NEW.passenger_email)
        AND b.status IN ('confirmed','completed')
        AND t.status IN ('completed','in_progress')
    ) INTO has_relation;
  ELSE
    -- Unknown review_type — allow for forward-compat but log
    RAISE WARNING 'unknown review_type %', NEW.review_type;
    RETURN NEW;
  END IF;

  IF NOT has_relation THEN
    RAISE EXCEPTION 'reviewer must have a completed booking with the reviewed party'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_review_must_have_booking ON public.reviews;
CREATE TRIGGER guard_review_must_have_booking
  BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_review_must_have_booking();


-- =============================================================================
-- SECTION 7 — C-09 — Receivers cannot edit message content
-- =============================================================================
-- messages_update USING allowed both sender and receiver to update. No WITH
-- CHECK meant a receiver could change content (forge harassment evidence).
-- We split the policy and add a column-level guard.

DROP POLICY IF EXISTS "messages_update" ON public.messages;

CREATE POLICY "messages_update_sender" ON public.messages
  FOR UPDATE TO authenticated
  USING      (sender_email = public.auth_user_email())
  WITH CHECK (sender_email = public.auth_user_email());

CREATE POLICY "messages_update_receiver_read_only" ON public.messages
  FOR UPDATE TO authenticated
  USING      (receiver_email = public.auth_user_email())
  WITH CHECK (receiver_email = public.auth_user_email());

CREATE OR REPLACE FUNCTION public.guard_message_receiver_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller TEXT := public.auth_user_email();
BEGIN
  -- Admin override
  IF public.auth_user_role() = 'admin' THEN RETURN NEW; END IF;

  -- If caller is the receiver but NOT the sender, the only column they
  -- may change is is_read (and updated_at).
  IF OLD.receiver_email = caller AND OLD.sender_email <> caller THEN
    IF NEW.content        IS DISTINCT FROM OLD.content        THEN
      RAISE EXCEPTION 'receivers cannot edit message content' USING ERRCODE = '42501';
    END IF;
    IF NEW.sender_email   IS DISTINCT FROM OLD.sender_email   THEN
      RAISE EXCEPTION 'cannot change sender_email'           USING ERRCODE = '42501';
    END IF;
    IF NEW.sender_name    IS DISTINCT FROM OLD.sender_name    THEN
      RAISE EXCEPTION 'cannot change sender_name'            USING ERRCODE = '42501';
    END IF;
    IF NEW.receiver_email IS DISTINCT FROM OLD.receiver_email THEN
      RAISE EXCEPTION 'cannot change receiver_email'         USING ERRCODE = '42501';
    END IF;
    IF NEW.created_at     IS DISTINCT FROM OLD.created_at     THEN
      RAISE EXCEPTION 'cannot change created_at'             USING ERRCODE = '42501';
    END IF;
    IF NEW.trip_id        IS DISTINCT FROM OLD.trip_id        THEN
      RAISE EXCEPTION 'cannot change trip_id'                USING ERRCODE = '42501';
    END IF;
    IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
      RAISE EXCEPTION 'cannot change conversation_id'        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Senders can edit their own content but not impersonate
  IF OLD.sender_email = caller THEN
    IF NEW.sender_email IS DISTINCT FROM OLD.sender_email THEN
      RAISE EXCEPTION 'cannot change sender_email'           USING ERRCODE = '42501';
    END IF;
    IF NEW.receiver_email IS DISTINCT FROM OLD.receiver_email THEN
      RAISE EXCEPTION 'cannot change receiver_email'         USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_message_receiver_columns ON public.messages;
CREATE TRIGGER guard_message_receiver_columns
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_receiver_columns();


-- =============================================================================
-- SECTION 8 — M-12 — available_seats CHECK already in column definition
-- =============================================================================
-- The trips table definition already has CHECK (available_seats >= 0 AND
-- available_seats <= 20) per supabase-production.sql:91. After the booking
-- guards above prevent direct manipulation, this constraint catches any
-- remaining bug. Verify it's still there:
DO $$
DECLARE
  has_check BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name LIKE '%available_seats%'
  ) INTO has_check;
  IF NOT has_check THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_available_seats_check
      CHECK (available_seats >= 0 AND available_seats <= 20);
  END IF;
END $$;


-- =============================================================================
-- SECTION 9 — Performance: an index for the new review-precondition trigger
-- =============================================================================
-- The guard_review_must_have_booking trigger does an EXISTS on bookings JOIN
-- trips. Without a supporting index this is expensive at scale.
CREATE INDEX IF NOT EXISTS idx_bookings_passenger_status
  ON public.bookings (passenger_email, status);


-- =============================================================================
-- SECTION 10 — Patch existing SECURITY DEFINER functions that lack search_path
-- =============================================================================
-- The full list per audit H-05. Re-issue ALTER for known names; safe if any
-- don't exist (wrapped in EXCEPTION).
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'broadcast_notification(text,text)',
    'cancel_booking(uuid)',
    'driver_payments_summary()',
    'delete_user_account(uuid)',
    'check_no_self_booking()',
    'notify_driver_on_booking()',
    'handle_booking_cancellation()',
    'notify_license_status_change()',
    'match_trip_to_preferences()',
    'update_driver_rating()',
    'check_document_expiry()'
  ])
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%s SET search_path = public, pg_catalog, auth', fn);
      RAISE NOTICE '  pinned search_path on public.%', fn;
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE '  skip — public.% not found', fn;
      WHEN OTHERS THEN
        RAISE NOTICE '  skip — public.% (%)', fn, SQLERRM;
    END;
  END LOOP;
END $$;


-- =============================================================================
-- VERIFICATION — run after applying. Each row should print PASS.
-- =============================================================================
DO $$
DECLARE
  pol_count INT;
BEGIN
  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'VERIFICATION';
  RAISE NOTICE '────────────────────────────────────────────────────────';

  -- C-01: profiles_update has WITH CHECK
  SELECT COUNT(*) INTO pol_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles'
    AND policyname = 'profiles_update'
    AND with_check IS NOT NULL;
  IF pol_count = 1 THEN RAISE NOTICE '✓ C-01  profiles_update has WITH CHECK';
  ELSE                  RAISE WARNING '✗ C-01  profiles_update missing WITH CHECK'; END IF;

  -- C-01: guard trigger present
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_profile_protected_columns')
  THEN RAISE NOTICE '✓ C-01  guard_profile_protected_columns trigger installed';
  ELSE RAISE WARNING '✗ C-01  guard_profile_protected_columns missing'; END IF;

  -- C-04: booking trigger
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_booking_updates')
  THEN RAISE NOTICE '✓ C-04  guard_booking_updates trigger installed';
  ELSE RAISE WARNING '✗ C-04  guard_booking_updates missing'; END IF;

  -- H-12: trip trigger
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_trip_updates')
  THEN RAISE NOTICE '✓ H-12  guard_trip_updates trigger installed';
  ELSE RAISE WARNING '✗ H-12  guard_trip_updates missing'; END IF;

  -- C-07: notifications_insert no longer (true)
  SELECT COUNT(*) INTO pol_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'notifications'
    AND policyname = 'notifications_insert'
    AND with_check ~ 'auth_user_email|auth_user_role';
  IF pol_count >= 1 THEN RAISE NOTICE '✓ C-07  notifications_insert tightened';
  ELSE                   RAISE WARNING '✗ C-07  notifications_insert may still allow spam'; END IF;

  -- C-08: review trigger
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_review_must_have_booking')
  THEN RAISE NOTICE '✓ C-08  guard_review_must_have_booking trigger installed';
  ELSE RAISE WARNING '✗ C-08  guard_review_must_have_booking missing'; END IF;

  -- C-09: messages_update split
  SELECT COUNT(*) INTO pol_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'messages'
    AND policyname IN ('messages_update_sender','messages_update_receiver_read_only');
  IF pol_count = 2 THEN RAISE NOTICE '✓ C-09  messages_update split into sender/receiver policies';
  ELSE                  RAISE WARNING '✗ C-09  messages_update policies not split correctly'; END IF;

  -- C-09: message guard trigger
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_message_receiver_columns')
  THEN RAISE NOTICE '✓ C-09  guard_message_receiver_columns trigger installed';
  ELSE RAISE WARNING '✗ C-09  guard_message_receiver_columns missing'; END IF;

  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'Phase 0 verification complete.';
  RAISE NOTICE 'After this migration, attempt the C-01 exploit:';
  RAISE NOTICE '  PATCH /rest/v1/profiles?id=eq.<your_id>  body: {"role":"admin"}';
  RAISE NOTICE '  Should return 42501 / "modifying role requires admin"';
  RAISE NOTICE '────────────────────────────────────────────────────────';
END $$;
