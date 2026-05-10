-- =============================================================================
-- Migration 025 — get_driver_payment_info: drop 'pending' from authorization
-- =============================================================================
--
-- BACKGROUND
--
-- Migration 006 introduced get_driver_payment_info(p_trip_id) as a SECURITY
-- DEFINER RPC that returns a driver's payment fields (bank account number,
-- IBAN, name on bank account, jawwal_pay_number, reflect_number, card holder
-- name, card last four, preferred_payment) to authorized callers only:
--
--    (a) the driver themselves (always)
--    (b) admins (always)
--    (c) any passenger with a booking on this trip whose status is
--        IN ('confirmed','completed','pending')   ← problem
--
-- The 'pending' check in (c) was added so the BookingConfirmation page could
-- show payment details immediately after booking. The intent was UX continuity:
-- the user just tapped "تأكيد الحجز", they should see what they need to pay
-- the driver right away, not be told "wait for the driver to accept you".
--
-- THE PROBLEM
--
-- book_seat (migration 017) creates bookings with status='pending' on the
-- passenger's call — no driver approval needed for the row to exist. So:
--
--    1. Authenticated user calls book_seat on every active trip on the
--       platform. Each booking lands as status='pending'.
--    2. Same user calls get_driver_payment_info on each trip. The
--       authorization check above admits every (c) match because the
--       'pending' bookings the user just created qualify.
--    3. Output: bank_account_number, IBAN, jawwal_pay_number, reflect_number,
--       card_last_four, card_holder_name for every active driver on the
--       platform.
--    4. Same user calls cancel_booking on each booking to free seats so the
--       attack doesn't degrade the marketplace's seat counts.
--
-- This is identity-grade financial PII harvesting. For a Palestinian rideshare
-- where many drivers receive transfers via Jawwal Pay or Reflect, stolen
-- payment numbers enable fraud (impersonation, redirected payments) and
-- targeted social engineering. The risk is material even before considering
-- App Store / Play Store privacy reviews.
--
-- THE FIX
--
-- Drop 'pending' from the authorization clause. Passengers see payment
-- instructions only after the driver has approved their booking — i.e.
-- after status flips to 'confirmed' through the existing approve flow in
-- DriverPassengers.jsx (Booking.update {status:'confirmed'}). The confirm
-- step is the moment the driver consents to a financial relationship with
-- this passenger, which is also the right moment to share their payment
-- channel.
--
-- WHY THIS DOESN'T BREAK THE UX
--
-- BookingConfirmation.jsx (lines 202-224) ALREADY has graceful fallbacks
-- for every payment method when dp (driver payment info) is null:
--   - bank_transfer: "تواصل مع السائق للحصول على بيانات التحويل البنكي"
--   - reflect: "تواصل مع السائق للحصول على رقم Reflect"
--   - jawwal_pay: "تواصل مع السائق للحصول على رقم Jawwal Pay"
--   - cash: doesn't need dp at all (UI shows "ادفع للسائق نقداً")
--   - card: doesn't need dp (UI shows "ادفع للسائق ببطاقتك")
-- These already render today when the RPC returns empty — for non-passengers,
-- for unauth callers, for the now-removed 'pending' case. The UX during the
-- pending window simply matches what unauthenticated viewers see today: a
-- "contact the driver for payment details" message. Once the driver
-- approves, the page re-fetches and the real numbers appear.
--
-- This also matches the actual product semantics. A pending booking is not
-- a confirmed financial commitment between the two parties — bank-transfer
-- instructions before approval imply the passenger should pay before the
-- driver has agreed to take them, which would be a refund problem if the
-- driver later rejects.
--
-- COMPATIBILITY
--
-- - get_driver_payment_info signature unchanged (UUID → table). No call sites
--   need updating.
-- - Function body otherwise identical. Only the IN-list literal changes.
-- - Idempotent: re-running this migration is a no-op on top of itself.
-- - REVOKE/GRANT pattern matches migration 006.
-- =============================================================================

BEGIN;

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
  --
  -- (a) and (c) by themselves are sufficient; (b) is broader. We keep all
  -- three branches so the audit trail is explicit. The change vs migration
  -- 006 is the IN-list in (c): 'pending' is removed.
  v_authorized :=
       (v_email = v_driver)                                               -- (a) driver themselves
    OR (v_role  = 'admin')                                                -- (b) admin
    OR EXISTS (
         SELECT 1 FROM public.bookings b                                  -- (c) passenger with confirmed booking
         WHERE b.trip_id = p_trip_id::text
           AND b.passenger_email = v_email
           AND b.status IN ('confirmed','completed')
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

-- Self-check: verify the function still exists and the new authorization is
-- in place. RAISE NOTICE so the dashboard SQL editor shows the message; the
-- DO block doesn't fail the migration even if pg_proc reads return surprises
-- (defensive against minor PG version differences in catalog access).
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_driver_payment_info'
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE WARNING 'MIGRATION 025 — get_driver_payment_info not found after CREATE';
  ELSIF v_def LIKE '%''pending''%' THEN
    RAISE WARNING 'MIGRATION 025 — function body still contains ''pending'' literal — fix did not apply';
  ELSE
    RAISE NOTICE 'MIGRATION 025 OK — get_driver_payment_info no longer admits pending bookings';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually to double-check)
-- =============================================================================
--
-- 1) Confirm the function definition no longer contains 'pending':
--      SELECT pg_get_functiondef('public.get_driver_payment_info(UUID)'::regprocedure);
--    Expected: the IN-list shows ('confirmed','completed') — no 'pending'.
--
-- 2) Negative test as a passenger holding ONLY a pending booking:
--      -- as authenticated passenger user X with status='pending' on trip T:
--      SELECT * FROM public.get_driver_payment_info('<trip_T_uuid>');
--    Expected: 0 rows.
--
-- 3) Positive test as a passenger holding a confirmed booking:
--      -- as authenticated passenger user X with status='confirmed' on trip T:
--      SELECT * FROM public.get_driver_payment_info('<trip_T_uuid>');
--    Expected: 1 row with driver's payment fields.
--
-- 4) Positive test as the driver themselves: should always return 1 row.
-- 5) Positive test as admin: should always return 1 row.
-- =============================================================================
