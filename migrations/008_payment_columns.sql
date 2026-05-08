-- =============================================================================
-- Migration 008 — Bookings: payment_status, paid_at, pickup_city, notes
-- =============================================================================
--
-- WHY: Audit of the live bookings table revealed columns the application code
-- writes to but that were never added by any migration:
--
--   payment_status   — written by /dashboard?tab=payments (admin "mark paid"
--                      toggle) and DriverPassengers.jsx (driver "received" toggle)
--                      Read by PassengerPaymentsSection, DashboardPayments
--                      transactions table, DriverTripsList refund logic.
--   paid_at          — timestamp written alongside payment_status='paid'.
--   pickup_city      — written by RPC book_seat() (migration 003) on every
--                      new booking. Until this migration, every passenger
--                      booking against a multi-stop trip silently dropped
--                      their chosen pickup point.
--   notes            — written by RPC book_seat() — passenger's free-text
--                      message to the driver (allergies, "I'll have luggage",
--                      etc). Same silent drop until now.
--
-- The base schema in supabase-production.sql shipped without these columns,
-- and migration 003 that USES them never added them either — that was an
-- oversight in 003. The code was already in production, so writes have
-- been failing silently or the fields were materializing as untyped JSON
-- through some Supabase auto-schema path. Either way, this migration makes
-- the storage layer match the application's actual data model.
--
-- All ALTER TABLE statements use IF NOT EXISTS so this migration is safe
-- to run on databases where some columns may have been created manually.
--
-- This migration is idempotent: re-running it produces no new changes after
-- the first successful apply.
-- =============================================================================

BEGIN;

-- ─── 1) Add the missing columns ─────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed'));

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pickup_city TEXT
    CHECK (pickup_city IS NULL OR length(pickup_city) <= 200);

-- pickup_stop_index is the symmetric companion to dropoff_stop_index that
-- was added in migration 001. It tells us which stop along the trip the
-- passenger boards at: NULL = origin city, 0..N-1 = that stop index.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pickup_stop_index INTEGER
    CHECK (pickup_stop_index IS NULL OR pickup_stop_index >= 0);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS notes TEXT
    CHECK (notes IS NULL OR length(notes) <= 1000);

-- ─── 2) Backfill defaults for existing rows ─────────────────────────────────
--
-- Existing bookings that pre-date this migration get payment_status='pending'
-- (the same default new rows get going forward). This is the safest backfill:
-- we don't want to assume historical bookings were paid since we have no
-- evidence in the data either way. Admins can mark them paid retroactively
-- via the dashboard if they have records of it.

UPDATE public.bookings
SET payment_status = 'pending'
WHERE payment_status IS NULL;

-- pickup_city backfill: for rows that have no pickup_city, default to the
-- trip's from_city. Passengers historically had no way to set a pickup point
-- different from the origin, so origin is the correct legacy assumption.
UPDATE public.bookings b
SET pickup_city = t.from_city
FROM public.trips t
WHERE b.trip_id::uuid = t.id
  AND b.pickup_city IS NULL;

-- ─── 3) Indexes for admin reconciliation ─────────────────────────────────
--
-- The admin payments dashboard filters on (payment_status, created_at) and
-- groups by driver. Without an index on payment_status, the page slows
-- linearly with booking count. This index is small (single TEXT column,
-- low cardinality) and pays for itself immediately on the dashboard.

CREATE INDEX IF NOT EXISTS idx_bookings_payment_status_created
  ON public.bookings (payment_status, created_at DESC);

-- An index on paid_at supports "show me payments received this month"
-- queries for monthly settlement reports.
CREATE INDEX IF NOT EXISTS idx_bookings_paid_at
  ON public.bookings (paid_at DESC NULLS LAST)
  WHERE paid_at IS NOT NULL;

-- ─── 4) Tighten RLS so payment_status / paid_at can only be set by:
--      a) the driver of the trip, or
--      b) admins ───────────────────────────────────────────────────────────
--
-- The guard_booking_updates trigger (migration 002) already prevents
-- passengers from changing payment_status / paid_at. That trigger fires for
-- everyone, including drivers and admins, so it correctly only blocks the
-- passenger case. The check is:
--
--   IF auth.email() = OLD.passenger_email AND new.payment_status changed
--   THEN raise.
--
-- Drivers updating their own trip's bookings + admins are unaffected. So
-- no additional RLS work needed here — 002's logic already covers it.
--
-- (This block intentionally left as documentation. No code change.)

-- ─── 5) Update the trigger if needed ─────────────────────────────────────
--
-- If guard_booking_updates was created BEFORE these columns existed, it
-- compares NEW.payment_status to OLD.payment_status using PL/pgSQL — both
-- are NULL on old rows so the comparison passes (NULL IS DISTINCT FROM NULL
-- is FALSE). New writes will set both, so the comparison correctly catches
-- passenger-initiated changes. No trigger refresh needed.

COMMIT;

-- =============================================================================
-- Verification queries (run these after applying)
-- =============================================================================
--
-- 1) Confirm all columns exist with expected types:
--
--    SELECT column_name, data_type, column_default, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'bookings'
--      AND column_name IN ('payment_status', 'paid_at', 'pickup_city',
--                          'pickup_stop_index', 'notes')
--    ORDER BY ordinal_position;
--
--    Expected: 5 rows.
--
-- 2) Confirm no NULL payment_status values remain:
--
--    SELECT COUNT(*) FROM public.bookings WHERE payment_status IS NULL;
--    Expected: 0
--
-- 3) Confirm pickup_city was backfilled where joinable:
--
--    SELECT COUNT(*) AS unfilled
--    FROM public.bookings b
--    JOIN public.trips t ON b.trip_id::uuid = t.id
--    WHERE b.pickup_city IS NULL;
--    Expected: 0
--
-- 4) Confirm indexes are live:
--
--    SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'bookings'
--      AND indexname LIKE 'idx_bookings_%';
--    Expected: includes idx_bookings_payment_status_created
--              and idx_bookings_paid_at
--
-- 5) Smoke test the admin "mark paid" path:
--
--    -- Pick any pending booking, flip it paid (replace UUID with a real one):
--    UPDATE public.bookings
--    SET payment_status = 'paid', paid_at = NOW()
--    WHERE id = '<some-uuid>'
--      AND payment_status = 'pending';
--    -- Should affect 1 row. Then revert:
--    UPDATE public.bookings
--    SET payment_status = 'pending', paid_at = NULL
--    WHERE id = '<some-uuid>';
-- =============================================================================
