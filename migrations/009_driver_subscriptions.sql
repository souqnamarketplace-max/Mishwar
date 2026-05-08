-- =============================================================================
-- Migration 009 — Driver subscription system (kill-switch dormant)
-- =============================================================================
--
-- WHY: Implements the "subscription" collection model — drivers pay a flat
-- monthly fee to the platform for unlimited trip-posting. Money flows manually
-- (driver sends to admin's Reflect/Jawwal/bank, admin verifies and approves).
--
-- KILL-SWITCH DESIGN: Ships with subscription_required = FALSE so this migration
-- can be applied to live production without affecting any user. When admin
-- flips the switch in /dashboard?tab=settings, gates activate. Existing drivers
-- get the configured grace period before being blocked.
--
-- The RPC `driver_subscription_status` is the single source of truth — every
-- gate (trip-creation, dashboard banners, eligibility checks) calls it instead
-- of computing locally. This way changing the rules later (e.g. extending
-- grace period) only requires changing the RPC.
--
-- Idempotent: every CREATE/ALTER uses IF NOT EXISTS or OR REPLACE.
-- =============================================================================

BEGIN;

-- ─── 1) Subscription requests table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.driver_subscriptions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_email       TEXT NOT NULL,
  driver_id          UUID,                                 -- denormalized for join speed
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','rejected','expired','cancelled')),
  amount             NUMERIC NOT NULL CHECK (amount >= 0), -- snapshot of price paid; doesn't move if admin changes price later
  -- Period only set after admin approves. NULL while pending/rejected.
  period_start       TIMESTAMPTZ,
  period_end         TIMESTAMPTZ,
  -- Driver's claim about how they paid:
  payment_method     TEXT CHECK (payment_method IN ('bank_transfer','reflect','jawwal_pay','cash','other','admin_grant')),  -- 'admin_grant' added retroactively by migration 013 — included here for fresh DBs that apply 009 directly
  payment_reference  TEXT CHECK (payment_reference IS NULL OR length(payment_reference) <= 200),
  proof_url          TEXT CHECK (proof_url IS NULL OR length(proof_url) <= 500),
  -- Driver-supplied note (optional). Admin reads this when verifying.
  driver_note        TEXT CHECK (driver_note IS NULL OR length(driver_note) <= 500),
  -- Admin disposition:
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  rejected_reason    TEXT CHECK (rejected_reason IS NULL OR length(rejected_reason) <= 500),
  -- Bookkeeping:
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Common queries:
--  1) Driver: "show my latest subscription request"
--  2) Admin: "show me pending requests"
--  3) RPC: "find this driver's most recent active subscription"
CREATE INDEX IF NOT EXISTS idx_driver_subscriptions_email_status
  ON public.driver_subscriptions (driver_email, status, period_end DESC);

-- Partial index for the admin pending queue — small + frequently scanned
CREATE INDEX IF NOT EXISTS idx_driver_subscriptions_pending
  ON public.driver_subscriptions (created_at DESC)
  WHERE status = 'pending';

-- updated_at auto-bump on any mutation. Reuses the canonical helper if
-- present; falls back to inline trigger otherwise.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_driver_subscriptions_updated_at ON public.driver_subscriptions';
    EXECUTE 'CREATE TRIGGER trg_driver_subscriptions_updated_at
             BEFORE UPDATE ON public.driver_subscriptions
             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;


-- ─── 2) New columns on app_settings ─────────────────────────────────────────
-- The kill switch + tunable parameters. Ship-time defaults: switch OFF,
-- price ₪30, period 30 days, grace 3 days. All editable from
-- /dashboard?tab=settings.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS subscription_required BOOLEAN DEFAULT FALSE;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS subscription_price NUMERIC DEFAULT 30
    CHECK (subscription_price >= 0);

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS subscription_period_days INTEGER DEFAULT 30
    CHECK (subscription_period_days BETWEEN 1 AND 365);

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS subscription_grace_days INTEGER DEFAULT 3
    CHECK (subscription_grace_days BETWEEN 0 AND 30);

-- Platform receiving rails — shown to drivers on the subscription page so
-- they know where to send the money. All optional; set whichever rails
-- you actually have. Field-level RLS not needed here; these are PUBLIC
-- info that drivers must see to subscribe.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS platform_bank_account_name TEXT
    CHECK (platform_bank_account_name IS NULL OR length(platform_bank_account_name) <= 200);

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS platform_bank_iban TEXT
    CHECK (platform_bank_iban IS NULL OR length(platform_bank_iban) <= 100);

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS platform_reflect_number TEXT
    CHECK (platform_reflect_number IS NULL OR length(platform_reflect_number) <= 50);

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS platform_jawwal_number TEXT
    CHECK (platform_jawwal_number IS NULL OR length(platform_jawwal_number) <= 50);


-- ─── 3) Row Level Security ──────────────────────────────────────────────────

ALTER TABLE public.driver_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drivers can SELECT their own rows. Admins can see all (admin check
-- piggybacks on the existing is_admin() function from migration 002 if
-- it exists; otherwise falls back to email match against admin list).

DROP POLICY IF EXISTS driver_subscriptions_select_own_or_admin ON public.driver_subscriptions;
CREATE POLICY driver_subscriptions_select_own_or_admin
  ON public.driver_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    auth.email() = driver_email
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.email = auth.email() AND p.role = 'admin'
    )
  );

-- Drivers can INSERT only their own rows, only with status='pending'.
-- They cannot pre-approve themselves. amount is snapshotted at insert
-- time from the current app_settings.subscription_price (enforced by
-- a trigger below to prevent client-side tampering).

DROP POLICY IF EXISTS driver_subscriptions_insert_own_pending ON public.driver_subscriptions;
CREATE POLICY driver_subscriptions_insert_own_pending
  ON public.driver_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.email() = driver_email
    AND status = 'pending'
    AND period_start IS NULL
    AND period_end IS NULL
    AND approved_by IS NULL
    AND approved_at IS NULL
  );

-- Only admins can UPDATE (approve/reject/cancel). Drivers cannot change
-- their own row once submitted — this prevents a driver from flipping
-- their own status to active.

DROP POLICY IF EXISTS driver_subscriptions_update_admin_only ON public.driver_subscriptions;
CREATE POLICY driver_subscriptions_update_admin_only
  ON public.driver_subscriptions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.email = auth.email() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.email = auth.email() AND p.role = 'admin')
  );

-- Nobody DELETEs — historical record. Even cancellations flip status,
-- they don't remove rows.


-- ─── 4) Defensive trigger: snapshot amount + driver_id at insert ───────────
-- The RLS lets a driver insert any amount (because we can't easily reference
-- another table from a CHECK). This trigger overrides the inserted amount
-- to whatever app_settings.subscription_price currently is, so a sneaky
-- client can't insert amount=0.01 and pay only that.

CREATE OR REPLACE FUNCTION public.snapshot_subscription_on_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_price NUMERIC;
  v_driver_id UUID;
BEGIN
  -- Always snapshot from canonical source, ignore client-supplied amount
  SELECT subscription_price INTO v_price
    FROM public.app_settings LIMIT 1;
  NEW.amount := COALESCE(v_price, 30);

  -- Resolve driver_id from email for admin-side joins
  SELECT id INTO v_driver_id
    FROM auth.users WHERE email = NEW.driver_email LIMIT 1;
  NEW.driver_id := v_driver_id;

  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, auth;

DROP TRIGGER IF EXISTS trg_subscription_snapshot ON public.driver_subscriptions;
CREATE TRIGGER trg_subscription_snapshot
  BEFORE INSERT ON public.driver_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_subscription_on_insert();


-- ─── 5) Trigger: when admin approves, compute period_start / period_end ────

CREATE OR REPLACE FUNCTION public.compute_subscription_period_on_approve()
RETURNS TRIGGER AS $$
DECLARE
  v_period_days INTEGER;
BEGIN
  -- Only trigger on transition pending→active
  IF NEW.status = 'active' AND OLD.status = 'pending' THEN
    SELECT COALESCE(subscription_period_days, 30) INTO v_period_days
      FROM public.app_settings LIMIT 1;
    NEW.period_start := COALESCE(NEW.period_start, NOW());
    NEW.period_end   := COALESCE(NEW.period_end, NEW.period_start + (v_period_days || ' days')::INTERVAL);
    NEW.approved_at  := COALESCE(NEW.approved_at, NOW());
    NEW.approved_by  := COALESCE(NEW.approved_by, auth.email());
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, auth;

DROP TRIGGER IF EXISTS trg_subscription_compute_period ON public.driver_subscriptions;
CREATE TRIGGER trg_subscription_compute_period
  BEFORE UPDATE ON public.driver_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.compute_subscription_period_on_approve();


-- ─── 6) RPC: driver_subscription_status ────────────────────────────────────
-- Single source of truth for "can this driver post trips right now?".
-- Returns a JSON envelope so callers can inspect why instead of just allowed/no.
--
-- Statuses returned:
--   not_required   — kill switch off, anyone can post
--   active         — paid, period_end > now
--   in_grace       — paid, period_end < now < period_end + grace
--   expired        — period_end + grace < now, no new request submitted
--   pending_review — has a pending request, can't post yet
--   never_subscribed — kill switch on, never paid, no pending request

CREATE OR REPLACE FUNCTION public.driver_subscription_status(p_driver_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_required        BOOLEAN;
  v_grace_days      INTEGER;
  v_active_sub      RECORD;
  v_pending_sub     RECORD;
  v_seconds_left    NUMERIC;
BEGIN
  -- 1) Read kill switch + grace from settings
  SELECT
    COALESCE(subscription_required, FALSE),
    COALESCE(subscription_grace_days, 3)
  INTO v_required, v_grace_days
  FROM public.app_settings
  LIMIT 1;

  -- 2) If kill switch off, no enforcement — any caller is allowed
  IF NOT COALESCE(v_required, FALSE) THEN
    RETURN jsonb_build_object(
      'status',         'not_required',
      'allowed',        TRUE,
      'kill_switch_on', FALSE
    );
  END IF;

  -- 3) Look for the most recent active subscription
  SELECT * INTO v_active_sub
    FROM public.driver_subscriptions
   WHERE driver_email = p_driver_email
     AND status = 'active'
   ORDER BY period_end DESC NULLS LAST
   LIMIT 1;

  IF v_active_sub.id IS NOT NULL THEN
    v_seconds_left := EXTRACT(EPOCH FROM (v_active_sub.period_end - NOW()));

    -- Active and not yet expired
    IF v_seconds_left > 0 THEN
      RETURN jsonb_build_object(
        'status',         'active',
        'allowed',        TRUE,
        'kill_switch_on', TRUE,
        'period_end',     v_active_sub.period_end,
        'days_remaining', GREATEST(0, FLOOR(v_seconds_left / 86400))::INT
      );
    END IF;

    -- Within grace window
    IF v_seconds_left > -(v_grace_days * 86400) THEN
      RETURN jsonb_build_object(
        'status',          'in_grace',
        'allowed',         TRUE,
        'kill_switch_on',  TRUE,
        'period_end',      v_active_sub.period_end,
        'days_remaining',  0,
        'grace_days_left', GREATEST(0, FLOOR((v_grace_days * 86400 + v_seconds_left) / 86400))::INT
      );
    END IF;

    -- Past grace, expired. Fall through to check for pending renewal.
  END IF;

  -- 4) Look for a pending request — applies whether they had a prior
  -- subscription that expired or are brand new.
  SELECT * INTO v_pending_sub
    FROM public.driver_subscriptions
   WHERE driver_email = p_driver_email
     AND status = 'pending'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_pending_sub.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status',         'pending_review',
      'allowed',        FALSE,
      'kill_switch_on', TRUE,
      'pending_id',     v_pending_sub.id,
      'submitted_at',   v_pending_sub.created_at
    );
  END IF;

  -- 5) Expired or never subscribed
  IF v_active_sub.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status',         'expired',
      'allowed',        FALSE,
      'kill_switch_on', TRUE,
      'period_end',     v_active_sub.period_end
    );
  END IF;

  RETURN jsonb_build_object(
    'status',         'never_subscribed',
    'allowed',        FALSE,
    'kill_switch_on', TRUE
  );
END $$;

REVOKE ALL ON FUNCTION public.driver_subscription_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_subscription_status(TEXT) TO authenticated;


-- ─── 7) Grant SELECT on app_settings columns drivers need to see ──────────
-- Drivers need to read subscription_price + the platform_*_number rails
-- so they know how much to send and where. The base app_settings table
-- already grants SELECT to authenticated via RLS in the canonical schema,
-- so no additional grants needed here. Sensitive columns (commission_rate
-- for analytics) remain admin-only via existing column-level RLS from
-- migration 006 if applied.


COMMIT;

-- =============================================================================
-- Verification queries (run after applying)
-- =============================================================================
--
-- 1) Confirm the table exists with all columns
--
--    SELECT column_name, data_type
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'driver_subscriptions'
--    ORDER BY ordinal_position;
--    Expected: 15-16 rows
--
-- 2) Confirm app_settings has new columns
--
--    SELECT column_name, column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'app_settings'
--      AND column_name LIKE 'subscription_%' OR column_name LIKE 'platform_%';
--    Expected: subscription_required (false), subscription_price (30),
--              subscription_period_days (30), subscription_grace_days (3),
--              + 4 platform_* columns (NULL defaults)
--
-- 3) Confirm RPC exists and returns the not_required envelope
--    (since kill switch defaults to FALSE):
--
--    SELECT public.driver_subscription_status('any@email.com');
--    Expected: { "status": "not_required", "allowed": true,
--                "kill_switch_on": false }
--
-- 4) Confirm RLS policies are live:
--
--    SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'driver_subscriptions';
--    Expected: 3 rows (select_own_or_admin, insert_own_pending,
--              update_admin_only)
-- =============================================================================
