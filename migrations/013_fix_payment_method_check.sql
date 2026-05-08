-- =============================================================================
-- Migration 013 — Allow 'admin_grant' as a subscription payment method
-- =============================================================================
--
-- WHY: Migration 011 introduced two RPCs (grant_complimentary_subscription
-- and bulk_grant_grace_to_unsubscribed_drivers) that insert rows with
-- payment_method='admin_grant'. But migration 009's original CHECK
-- constraint only permitted ('bank_transfer','reflect','jawwal_pay','cash','other').
-- Result: every comp grant raised
--
--   ERROR: new row violates check constraint
--          "driver_subscriptions_payment_method_check"
--
-- which PostgREST returned as a 400 Bad Request on the RPC call. The
-- friendlyError translation in the UI showed the user "البيانات لا تطابق
-- الشروط المطلوبة" — but the real cause was the missing constraint value.
--
-- Fix: drop and recreate the CHECK constraint with 'admin_grant' added
-- to the allowed set. Idempotent — DROP IF EXISTS means re-running on a
-- DB that's already been fixed is a no-op.
-- =============================================================================

BEGIN;

ALTER TABLE public.driver_subscriptions
  DROP CONSTRAINT IF EXISTS driver_subscriptions_payment_method_check;

ALTER TABLE public.driver_subscriptions
  ADD CONSTRAINT driver_subscriptions_payment_method_check
  CHECK (
    payment_method IN (
      'bank_transfer',
      'reflect',
      'jawwal_pay',
      'cash',
      'other',
      'admin_grant'   -- added by migration 013
    )
  );

COMMIT;

-- =============================================================================
-- Verification
-- =============================================================================
--
-- 1) Confirm the new constraint includes admin_grant:
--
--    SELECT pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname = 'driver_subscriptions_payment_method_check';
--    Expected: text containing 'admin_grant'
--
-- 2) Test the grant RPC works (replace with a real driver email):
--
--    SELECT public.grant_complimentary_subscription(
--      'somedriver@example.com', 30, 'Test grant'
--    );
--    Expected: returns a UUID without error.
--
--    Confirm the row exists with the new method:
--      SELECT id, status, amount, payment_method
--        FROM public.driver_subscriptions
--       WHERE driver_email = 'somedriver@example.com'
--       ORDER BY created_at DESC LIMIT 1;
--    Expected: status='active', amount=0, payment_method='admin_grant'
--
-- 3) Test bulk grant (BE CAREFUL — grants to all current drivers
--    without active sub):
--
--    SELECT public.bulk_grant_grace_to_unsubscribed_drivers(30);
--    Expected: returns INTEGER count, no error.
-- =============================================================================
