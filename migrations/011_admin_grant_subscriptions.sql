-- =============================================================================
-- Migration 011 — Admin-granted complimentary subscriptions
-- =============================================================================
--
-- WHY: Two related needs that share the same solution:
--
-- A) When admin flips subscription_required = true, every existing driver
--    immediately falls into 'never_subscribed' state and can't post trips.
--    Need a way to grant a grace window to current drivers BEFORE flipping
--    the switch, so they're not abruptly cut off.
--
-- B) Admin should be able to give comp subscriptions to specific drivers
--    (early-driver loyalty rewards, beta tester comps, make-goods after
--    a service issue, friends-and-family).
--
-- Both are "admin grants free subscription to driver X for N days". This
-- migration adds:
--
--  1. Trigger update — snapshot_subscription_on_insert respects amount=0
--     when payment_method='admin_grant', instead of overriding with current
--     subscription_price. This lets admin create rows with amount=0 cleanly.
--
--  2. RPC grant_complimentary_subscription(driver_email, days, note) —
--     admin-only, creates a single row with status='active', amount=0,
--     payment_method='admin_grant', period_end=NOW()+days. SECURITY DEFINER
--     so it bypasses the insert_own_pending RLS policy.
--
--  3. RPC bulk_grant_grace_to_unsubscribed_drivers(days, note) —
--     iterates all drivers in profiles (account_type in 'driver','both')
--     who don't have an active subscription, and grants each a comp for
--     N days. Returns the count granted. For the "give existing drivers
--     a 30-day runway before turning the switch on" use case.
--
-- Idempotent: re-running won't double-grant because the bulk RPC checks
-- for existing active subscriptions per-driver before creating.
-- =============================================================================

BEGIN;

-- ─── 1) Update snapshot trigger to honor admin grants ──────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_subscription_on_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_price NUMERIC;
  v_driver_id UUID;
BEGIN
  -- For admin-granted complimentary subscriptions, respect the explicit
  -- amount the caller passed (typically 0). Skipping the snapshot here
  -- is what lets a comp actually be free instead of getting silently
  -- overridden to whatever the current subscription_price is.
  --
  -- Identity check: payment_method='admin_grant' is a sentinel value
  -- only the SECURITY DEFINER grant_* RPCs use. Drivers can't pass
  -- this through the driver-facing form (their METHODS array doesn't
  -- include it).
  IF NEW.payment_method IS DISTINCT FROM 'admin_grant' THEN
    SELECT subscription_price INTO v_price
      FROM public.app_settings LIMIT 1;
    NEW.amount := COALESCE(v_price, 30);
  END IF;

  -- Always resolve driver_id from email — regardless of grant type.
  IF NEW.driver_id IS NULL THEN
    SELECT id INTO v_driver_id
      FROM auth.users WHERE email = NEW.driver_email LIMIT 1;
    NEW.driver_id := v_driver_id;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, auth;

-- Trigger definition unchanged — just the function body updated above.


-- ─── 2) Single-driver complimentary grant RPC ──────────────────────────────

CREATE OR REPLACE FUNCTION public.grant_complimentary_subscription(
  p_driver_email TEXT,
  p_days         INTEGER DEFAULT 30,
  p_note         TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_admin_email TEXT;
  v_is_admin    BOOLEAN;
  v_id          UUID;
  v_now         TIMESTAMPTZ := NOW();
BEGIN
  -- 1) Verify caller is an admin. Without this check the RPC would let
  --    any authenticated user grant themselves free subscriptions.
  v_admin_email := auth.email();
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'only admins can grant complimentary subscriptions'
      USING ERRCODE = '42501';
  END IF;

  -- 2) Validate inputs.
  IF p_driver_email IS NULL OR length(trim(p_driver_email)) = 0 THEN
    RAISE EXCEPTION 'driver_email is required';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'days must be between 1 and 365';
  END IF;

  -- 3) Verify the target is actually a driver. Granting to passenger
  --    accounts would create dead rows — they can't act on the
  --    subscription anyway.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = p_driver_email
      AND account_type IN ('driver', 'both')
  ) THEN
    RAISE EXCEPTION 'target email is not a driver account: %', p_driver_email;
  END IF;

  -- 4) Insert the comp subscription. Bypasses RLS because SECURITY
  --    DEFINER. The snapshot trigger will respect the amount=0 because
  --    payment_method='admin_grant'. The compute_period trigger only
  --    fires on UPDATE, so we set period dates explicitly here.
  INSERT INTO public.driver_subscriptions (
    driver_email,
    status,
    amount,
    period_start,
    period_end,
    payment_method,
    payment_reference,
    driver_note,
    approved_by,
    approved_at
  ) VALUES (
    p_driver_email,
    'active',
    0,                          -- amount=0 honored by updated trigger
    v_now,
    v_now + (p_days || ' days')::INTERVAL,
    'admin_grant',
    NULL,
    p_note,
    v_admin_email,
    v_now
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.grant_complimentary_subscription(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_complimentary_subscription(TEXT, INTEGER, TEXT) TO authenticated;


-- ─── 3) Bulk grace-grant to all current drivers without active subs ───────

CREATE OR REPLACE FUNCTION public.bulk_grant_grace_to_unsubscribed_drivers(
  p_days INTEGER DEFAULT 30,
  p_note TEXT    DEFAULT 'فترة سماح عند تفعيل نظام الاشتراك'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_admin_email TEXT;
  v_is_admin    BOOLEAN;
  v_count       INTEGER := 0;
  v_now         TIMESTAMPTZ := NOW();
  drv           RECORD;
BEGIN
  v_admin_email := auth.email();
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email = v_admin_email AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'only admins can grant grace periods'
      USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'days must be between 1 and 365';
  END IF;

  -- Iterate all driver/both accounts. For each one without an
  -- active subscription, grant a comp. Drivers who already have
  -- active subs are skipped (we don't extend or stack — that
  -- would inflate their period unfairly).
  FOR drv IN
    SELECT p.email
      FROM public.profiles p
     WHERE p.account_type IN ('driver', 'both')
       AND NOT EXISTS (
         SELECT 1 FROM public.driver_subscriptions s
          WHERE s.driver_email = p.email
            AND s.status = 'active'
            AND s.period_end > v_now
       )
  LOOP
    INSERT INTO public.driver_subscriptions (
      driver_email,
      status,
      amount,
      period_start,
      period_end,
      payment_method,
      driver_note,
      approved_by,
      approved_at
    ) VALUES (
      drv.email,
      'active',
      0,
      v_now,
      v_now + (p_days || ' days')::INTERVAL,
      'admin_grant',
      p_note,
      v_admin_email,
      v_now
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.bulk_grant_grace_to_unsubscribed_drivers(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_grant_grace_to_unsubscribed_drivers(INTEGER, TEXT) TO authenticated;


COMMIT;

-- =============================================================================
-- Verification queries (run after applying)
-- =============================================================================
--
-- 1) Confirm both RPCs exist:
--
--    SELECT proname, pronargs FROM pg_proc
--    WHERE proname IN ('grant_complimentary_subscription',
--                      'bulk_grant_grace_to_unsubscribed_drivers');
--    Expected: 2 rows
--
-- 2) Test single-driver grant (replace with a real driver email):
--
--    SELECT public.grant_complimentary_subscription(
--      'somedriver@example.com', 30, 'Test grant'
--    );
--    Expected: returns a UUID. Check with:
--      SELECT id, status, amount, payment_method, period_end
--        FROM public.driver_subscriptions
--       WHERE driver_email = 'somedriver@example.com'
--       ORDER BY created_at DESC LIMIT 1;
--    Expected: status='active', amount=0, payment_method='admin_grant',
--              period_end ≈ NOW()+30 days
--
-- 3) Test bulk grant (BE CAREFUL — this grants to ALL current drivers
--    who don't have an active sub):
--
--    SELECT public.bulk_grant_grace_to_unsubscribed_drivers(30);
--    Expected: returns an integer (count of drivers granted)
--
-- 4) Verify a non-admin cannot call:
--
--    -- As a regular authenticated user, this should fail with 42501:
--    SELECT public.grant_complimentary_subscription(
--      'somedriver@example.com', 30, NULL
--    );
-- =============================================================================
