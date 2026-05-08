-- =============================================================================
-- Migration 010 — Subscription expiring-soon notification helper
-- =============================================================================
--
-- WHY: When a driver's subscription is within 7 days of expiring, they should
-- get a notification reminding them to renew. Without this they'd only see
-- the warning when they happen to open the driver dashboard, which means
-- inactive drivers might lapse without realizing it.
--
-- Function `check_subscription_expiry()` scans all active subscriptions and
-- emits one Notification per (driver, period_end) pair where:
--   - period_end is between NOW() and NOW() + 7 days, AND
--   - we haven't already sent the warning for this period (deduplication
--     via an INSERT … ON CONFLICT DO NOTHING on a synthetic unique key).
--
-- Schedule via pg_cron (extension must be enabled in Supabase):
--   SELECT cron.schedule(
--     'check-subscription-expiry',
--     '0 9 * * *',        -- 09:00 UTC daily
--     'SELECT public.check_subscription_expiry()'
--   );
--
-- Or run it manually from the SQL editor as needed.
--
-- This migration is idempotent — running it twice produces no extra changes.
-- =============================================================================

BEGIN;

-- Track which expiry warnings have already been sent. Synthetic key prevents
-- the cron job from emitting duplicates if it runs more than once per day.
CREATE TABLE IF NOT EXISTS public.subscription_expiry_warnings (
  subscription_id UUID NOT NULL REFERENCES public.driver_subscriptions(id) ON DELETE CASCADE,
  warned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscription_id)
);

CREATE OR REPLACE FUNCTION public.check_subscription_expiry()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  sub          RECORD;
  v_days_left  INTEGER;
  v_count      INTEGER := 0;
BEGIN
  FOR sub IN
    SELECT s.*
      FROM public.driver_subscriptions s
     WHERE s.status = 'active'
       AND s.period_end BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM public.subscription_expiry_warnings w
          WHERE w.subscription_id = s.id
       )
  LOOP
    v_days_left := GREATEST(
      0,
      EXTRACT(DAY FROM (sub.period_end - NOW()))::INTEGER
    );

    -- Insert the notification. The notifications table schema may vary
    -- across deployments; this matches the shape used elsewhere in the
    -- app (DriverPassengers.jsx, etc.):
    --   user_email, title, message, type, is_read.
    INSERT INTO public.notifications (
      user_email, title, message, type, is_read
    ) VALUES (
      sub.driver_email,
      'ينتهي اشتراكك قريباً ⏰',
      CASE
        WHEN v_days_left = 0 THEN 'ينتهي اشتراكك في مِشوار اليوم. جدّده الآن لتفادي انقطاع النشر.'
        WHEN v_days_left = 1 THEN 'ينتهي اشتراكك في مِشوار غداً. جدّده الآن لتفادي انقطاع النشر.'
        ELSE format('ينتهي اشتراكك في مِشوار خلال %s أيام. جدّده الآن لتفادي انقطاع النشر.', v_days_left)
      END,
      'system',
      FALSE
    );

    -- Record so we don't spam if cron runs again
    INSERT INTO public.subscription_expiry_warnings (subscription_id)
    VALUES (sub.id);

    v_count := v_count + 1;
  END LOOP;

  -- Also flip status='active' rows that have passed their grace window
  -- to status='expired' so the RPC returns the right answer without
  -- doing the date math on every call. Only flips when period_end +
  -- grace_days < NOW() — admin's grace setting is honored.
  UPDATE public.driver_subscriptions s
  SET status = 'expired', updated_at = NOW()
  WHERE s.status = 'active'
    AND s.period_end + (
      COALESCE((SELECT subscription_grace_days FROM public.app_settings LIMIT 1), 3)
      || ' days'
    )::INTERVAL < NOW();

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.check_subscription_expiry() FROM PUBLIC, anon, authenticated;
-- Only the postgres role (and pg_cron) can invoke. Admins running it manually
-- from the SQL editor are using the postgres role.

COMMIT;

-- =============================================================================
-- After applying, schedule the job (one-time):
--
--   -- Make sure pg_cron is enabled
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--
--   -- Schedule daily at 09:00 UTC
--   SELECT cron.schedule(
--     'check-subscription-expiry',
--     '0 9 * * *',
--     $cron$ SELECT public.check_subscription_expiry() $cron$
--   );
--
--   -- Verify the job exists:
--   SELECT * FROM cron.job WHERE jobname = 'check-subscription-expiry';
--
-- To run on demand without waiting for cron:
--
--   SELECT public.check_subscription_expiry();
--   -- Returns the number of notifications sent.
-- =============================================================================
