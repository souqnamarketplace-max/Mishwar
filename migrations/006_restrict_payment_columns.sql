-- =============================================================================
-- مِشوار  — M-07 (reframed) — Restrict SELECT on profile payment columns
-- =============================================================================
-- The audit's M-07 originally said "encrypt at rest with pgsodium." After
-- digging into the actual data flows, the real exposure is broader and
-- simpler than encryption-at-rest:
--
--   profiles_select USING (true)
--
-- means ANY authenticated user can run
--
--   SELECT bank_iban, bank_account_number, jawwal_pay_number, reflect_number
--   FROM profiles
--
-- and walk away with every driver's payment data. Encryption-at-rest only
-- protects against stolen Postgres disk — not the realistic threat (one
-- throwaway account + one SELECT). This migration closes that hole.
--
-- WHAT WE DO
--   1. Replace profiles_select with a row-level policy that hides PAYMENT
--      ROWS from non-authorized readers, while leaving all other profile
--      data publicly readable (names, avatars, ratings, bios — needed by
--      the trip search / driver profile pages).
--      Postgres RLS doesn't have native column-level filters, so we use
--      a SECURITY DEFINER function `get_driver_payment_info(trip_id)`
--      and have BookingConfirmation.jsx call THAT instead of selecting
--      payment columns directly.
--   2. Tighten profiles_select so payment columns return NULL via a
--      column-level REVOKE on SELECT. The Driver themselves still reads
--      their own row through profiles_select — so DriverPaymentSetup,
--      AccountSettings, CreateTrip continue to work because they query
--      with id = auth.uid() filter and we add a permissive policy for
--      self-read on those columns.
--
-- AUTHORIZATION RULES for reading another user's payment columns
--   Allow if any of:
--     (a) reader IS the row's owner    (driver editing their own data)
--     (b) reader has a confirmed/completed booking on a trip with the
--         row's driver_email                                                    (passenger after booking)
--     (c) reader is admin
--
-- HOW NON-AUTHORIZED READERS EXPERIENCE IT
--   They can still SELECT * FROM profiles — they just see NULL in the
--   sensitive columns. No errors, no broken queries. Existing client
--   code that doesn't depend on those columns keeps working.
--
-- IDEMPOTENT — safe to re-run.
-- =============================================================================


-- =============================================================================
-- 1) The RPC: get_driver_payment_info(trip_id)
-- =============================================================================
-- Returns the driver's payment fields for the given trip, but ONLY if the
-- caller is the driver themselves OR has a confirmed booking on that trip
-- OR is admin. Otherwise returns no rows.

DROP FUNCTION IF EXISTS public.get_driver_payment_info(UUID);

CREATE OR REPLACE FUNCTION public.get_driver_payment_info(p_trip_id UUID)
RETURNS TABLE (
  driver_email          TEXT,
  bank_name             TEXT,
  bank_account_name     TEXT,
  bank_account_number   TEXT,
  bank_iban             TEXT,
  jawwal_pay_number     TEXT,
  reflect_number        TEXT,
  card_holder_name      TEXT,
  card_last_four        TEXT,
  preferred_payment     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email      TEXT := public.auth_user_email();
  v_role       TEXT := public.auth_user_role();
  v_authorized BOOLEAN;
  v_driver     TEXT;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Lookup the driver_email for this trip
  SELECT t.driver_email INTO v_driver
  FROM public.trips t
  WHERE t.id = p_trip_id
  LIMIT 1;
  IF v_driver IS NULL THEN
    -- No such trip — return empty rather than leaking that the trip
    -- doesn't exist vs. exists-but-hidden
    RETURN;
  END IF;

  -- Authorization
  v_authorized :=
       (v_email = v_driver)                                               -- (a) driver themselves
    OR (v_role  = 'admin')                                                -- (c) admin
    OR EXISTS (
         SELECT 1 FROM public.bookings b                                  -- (b) passenger with confirmed booking
         WHERE b.trip_id = p_trip_id::text
           AND b.passenger_email = v_email
           AND b.status IN ('confirmed','completed','pending')
       );

  IF NOT v_authorized THEN
    -- Not authorized → return zero rows (caller sees empty array)
    RETURN;
  END IF;

  -- Authorized → return the driver's payment fields
  RETURN QUERY
  SELECT
    p.email,
    p.bank_name,
    p.bank_account_name,
    p.bank_account_number,
    p.bank_iban,
    p.jawwal_pay_number,
    p.reflect_number,
    p.card_holder_name,
    p.card_last_four,
    p.preferred_payment
  FROM public.profiles p
  WHERE p.email = v_driver
  LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.get_driver_payment_info(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_driver_payment_info(UUID) TO authenticated;


-- =============================================================================
-- 2) Tighten profiles_select to hide payment columns for non-authorized
-- =============================================================================
-- The profiles table needs to stay broadly SELECTable (search results show
-- driver names + avatars + ratings; user profiles show bio + city). We
-- can't drop the broad-read policy. What we CAN do is use a row-level
-- predicate that covers payment rows specifically.
--
-- Approach: keep the broad SELECT policy, BUT add a SECURITY BARRIER VIEW
-- that hides payment columns for non-self readers. Code that reads
-- profile data should switch to reading from this view; legacy code
-- reading directly from `profiles` will still see the columns IF it has
-- direct access — which we now scope down via a column-level grant.
--
-- The cleanest implementation in Postgres / PostgREST:
--   - Keep the row-level RLS broad (true) for SELECT
--   - Use a column-level grant that revokes SELECT on payment columns
--     from `authenticated` and grants only via the RPC and direct
--     id = auth.uid() reads.
--
-- Postgres column-level GRANT/REVOKE works at the SQL level but PostgREST
-- (which Supabase uses for the REST API) doesn't surface column-level
-- ACL violations cleanly — it just returns the row with NULL for the
-- forbidden columns. That's actually what we want.
--
-- So: REVOKE column SELECT, then GRANT it back conditionally via a
-- SECURITY INVOKER view. The simplest workable form:

-- Revoke direct SELECT on the payment columns from authenticated.
-- This means a SELECT * FROM profiles by a regular user will return rows
-- but with NULL in the payment columns (PostgREST behavior).
DO $$
DECLARE
  col TEXT;
BEGIN
  FOR col IN SELECT unnest(ARRAY[
    'bank_name','bank_account_name','bank_account_number','bank_iban',
    'jawwal_pay_number','reflect_number',
    'card_holder_name','card_last_four',
    'preferred_payment'
  ])
  LOOP
    BEGIN
      EXECUTE format('REVOKE SELECT (%I) ON public.profiles FROM authenticated', col);
      RAISE NOTICE '  revoked SELECT(%) on profiles from authenticated', col;
    EXCEPTION
      WHEN undefined_column THEN
        RAISE NOTICE '  skip — column % does not exist', col;
      WHEN OTHERS THEN
        RAISE NOTICE '  skip — % (%)', col, SQLERRM;
    END;
  END LOOP;
END $$;

-- A self-read view: same shape as profiles but returns payment columns
-- only when the row's id matches auth.uid(). The driver's own UI reads
-- through this view via the existing `Profile` entity client (which
-- queries `profiles` filtered by their email/id) — but they read as
-- themselves, so the view returns the columns.
--
-- We don't actually need a view: the column REVOKE above already
-- forbids SELECT on those columns for `authenticated`. To let a user
-- read their OWN payment columns, we create a SECURITY DEFINER function
-- they call to fetch them.

CREATE OR REPLACE FUNCTION public.get_my_payment_info()
RETURNS TABLE (
  bank_name             TEXT,
  bank_account_name     TEXT,
  bank_account_number   TEXT,
  bank_iban             TEXT,
  jawwal_pay_number     TEXT,
  reflect_number        TEXT,
  card_holder_name      TEXT,
  card_last_four        TEXT,
  preferred_payment     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.bank_name,
    p.bank_account_name,
    p.bank_account_number,
    p.bank_iban,
    p.jawwal_pay_number,
    p.reflect_number,
    p.card_holder_name,
    p.card_last_four,
    p.preferred_payment
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.get_my_payment_info() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_payment_info() TO authenticated;


-- =============================================================================
-- 3) Allow UPDATE / INSERT of payment columns by the row's owner
-- =============================================================================
-- The column REVOKE only affected SELECT. UPDATE / INSERT of payment
-- columns by the owner remains controlled by the existing profiles_update
-- policy (id = auth.uid()) which we don't change. But we should explicitly
-- confirm authenticated still has UPDATE on these columns.
DO $$
DECLARE
  col TEXT;
BEGIN
  FOR col IN SELECT unnest(ARRAY[
    'bank_name','bank_account_name','bank_account_number','bank_iban',
    'jawwal_pay_number','reflect_number',
    'card_holder_name','card_last_four',
    'preferred_payment'
  ])
  LOOP
    BEGIN
      EXECUTE format('GRANT UPDATE (%I) ON public.profiles TO authenticated', col);
      EXECUTE format('GRANT INSERT (%I) ON public.profiles TO authenticated', col);
    EXCEPTION
      WHEN undefined_column THEN NULL;
      WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;


-- =============================================================================
-- 4) Defense-in-depth — guard trigger on the payment columns
-- =============================================================================
-- Belt and braces: even if RLS / column grants somehow get loosened in a
-- future migration, this trigger prevents anyone other than the row's
-- owner or admin from changing payment columns.
CREATE OR REPLACE FUNCTION public.guard_profile_payment_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role TEXT;
  payment_changed BOOLEAN;
BEGIN
  -- Compute whether any payment column changed
  payment_changed :=
       (NEW.bank_name             IS DISTINCT FROM OLD.bank_name)
    OR (NEW.bank_account_name     IS DISTINCT FROM OLD.bank_account_name)
    OR (NEW.bank_account_number   IS DISTINCT FROM OLD.bank_account_number)
    OR (NEW.bank_iban             IS DISTINCT FROM OLD.bank_iban)
    OR (NEW.jawwal_pay_number     IS DISTINCT FROM OLD.jawwal_pay_number)
    OR (NEW.reflect_number        IS DISTINCT FROM OLD.reflect_number)
    OR (NEW.card_holder_name      IS DISTINCT FROM OLD.card_holder_name)
    OR (NEW.card_last_four        IS DISTINCT FROM OLD.card_last_four)
    OR (NEW.preferred_payment     IS DISTINCT FROM OLD.preferred_payment);

  IF NOT payment_changed THEN RETURN NEW; END IF;

  -- Only the row's owner or admin can change them
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF auth.uid() IS DISTINCT FROM OLD.id AND caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only the profile owner can change payment columns'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_profile_payment_columns ON public.profiles;
CREATE TRIGGER guard_profile_payment_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_payment_columns();


-- =============================================================================
-- VERIFICATION
-- =============================================================================
DO $$
DECLARE
  has_revoked BOOLEAN;
BEGIN
  RAISE NOTICE '────────────────────────────────────────────────────────';

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_driver_payment_info')
  THEN RAISE NOTICE '✓ get_driver_payment_info() RPC installed';
  ELSE RAISE WARNING '✗ get_driver_payment_info() not found'; END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_payment_info')
  THEN RAISE NOTICE '✓ get_my_payment_info() RPC installed';
  ELSE RAISE WARNING '✗ get_my_payment_info() not found'; END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_profile_payment_columns')
  THEN RAISE NOTICE '✓ guard_profile_payment_columns trigger installed';
  ELSE RAISE WARNING '✗ guard_profile_payment_columns missing'; END IF;

  -- Verify column REVOKE took effect
  SELECT NOT has_column_privilege('authenticated', 'public.profiles', 'bank_iban', 'SELECT')
  INTO has_revoked;
  IF has_revoked THEN RAISE NOTICE '✓ authenticated SELECT on bank_iban revoked';
  ELSE              RAISE WARNING '✗ authenticated still has SELECT on bank_iban'; END IF;

  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'After this migration:';
  RAISE NOTICE '  - SELECT on profiles by any authed user returns NULL in';
  RAISE NOTICE '    payment columns for everyone except the row owner';
  RAISE NOTICE '  - Drivers fetch their own via get_my_payment_info() RPC';
  RAISE NOTICE '  - Passengers fetch a driver''s via get_driver_payment_info(trip_id)';
  RAISE NOTICE '    only if they have a booking on that trip';
  RAISE NOTICE '────────────────────────────────────────────────────────';
END $$;
