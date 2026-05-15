-- ════════════════════════════════════════════════════════════════════════
-- Migration 047 — Subscription expiry warning notification: add link
-- ════════════════════════════════════════════════════════════════════════
--
-- CONTEXT
-- check_subscription_expiry() (migration 010) inserts a notification 7
-- days before each driver's subscription expires:
--
--   INSERT INTO public.notifications (
--     user_email, title, message, type, is_read
--   ) VALUES (
--     sub.driver_email,
--     'ينتهي اشتراكك قريباً ⏰',
--     '... جدّده الآن لتفادي انقطاع النشر.',
--     'system',
--     FALSE
--   );
--
-- The notification has no trip_id and no link. When the driver taps
-- the bell, notificationRouting.js falls through every branch:
--   - no link → skip rule 1
--   - no trip_id → skip rule 2
--   - type='system' → skip rule 3 (no match)
--   - title 'ينتهي اشتراكك' doesn't include 'تقييم' or 'حجز' → skip
--     rule 4
--   - rule 5: return null → no nav target
--
-- So the bell tap is a no-op. The driver has to manually find their
-- way to /driver?tab=subscription to renew. That's bad UX for the
-- single most important call-to-action this notification carries.
--
-- THE FIX
-- CREATE OR REPLACE check_subscription_expiry with one change: add
-- `link` column to the INSERT, pointing at /driver?tab=subscription.
-- Everything else stays identical to migration 010 — same 7-day
-- window logic, same dedup table, same day-counting branches.
--
-- IDEMPOTENT
-- Full CREATE OR REPLACE. If pg_cron is scheduled to run
-- check_subscription_expiry daily (as migration 010's docblock
-- suggests), this migration takes effect on the next scheduled run
-- with no further action needed.
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_subscription_expiry()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted   INTEGER := 0;
  v_days_left  INTEGER;
  sub          RECORD;
BEGIN
  FOR sub IN
    SELECT s.id, s.driver_email, s.period_end
    FROM public.driver_subscriptions s
    WHERE s.status = 'active'
      AND s.period_end IS NOT NULL
      AND s.period_end >= NOW()
      AND s.period_end <= NOW() + INTERVAL '7 days'
      -- Skip subscriptions we've already warned about for this period
      AND NOT EXISTS (
        SELECT 1 FROM public.subscription_expiry_warnings w
        WHERE w.subscription_id = s.id
      )
  LOOP
    v_days_left := EXTRACT(DAY FROM (sub.period_end - NOW()))::INTEGER;

    -- The notification with explicit link (the migration 010 version
    -- had no link column). Driver taps the bell ping → lands straight
    -- on the subscription renewal tab. One-tap renewal, no extra
    -- navigation step.
    INSERT INTO public.notifications (
      user_email, title, message, type, link, is_read
    ) VALUES (
      sub.driver_email,
      'ينتهي اشتراكك قريباً ⏰',
      CASE
        WHEN v_days_left = 0 THEN 'ينتهي اشتراكك في مِشوار اليوم. جدّده الآن لتفادي انقطاع النشر.'
        WHEN v_days_left = 1 THEN 'ينتهي اشتراكك في مِشوار غداً. جدّده الآن لتفادي انقطاع النشر.'
        ELSE format('ينتهي اشتراكك في مِشوار خلال %s أيام. جدّده الآن لتفادي انقطاع النشر.', v_days_left)
      END,
      'system',
      '/driver?tab=subscription',
      FALSE
    );

    -- Dedup record so cron runs don't spam
    INSERT INTO public.subscription_expiry_warnings (subscription_id)
    VALUES (sub.id)
    ON CONFLICT (subscription_id) DO NOTHING;

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END $$;

REVOKE ALL ON FUNCTION public.check_subscription_expiry() FROM public, anon;
-- Same grant as migration 010 — authenticated callers (admin tools)
-- and pg_cron can invoke it.
GRANT EXECUTE ON FUNCTION public.check_subscription_expiry() TO authenticated;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_has_link  BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) LIKE '%/driver?tab=subscription%'
  INTO v_has_link
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'check_subscription_expiry';

  IF NOT COALESCE(v_has_link, FALSE) THEN
    RAISE EXCEPTION 'MIGRATION 047 FAILED: link not present in function body';
  END IF;

  RAISE NOTICE 'MIGRATION 047 OK — subscription expiry warning now deep-links to /driver?tab=subscription';
END $$;
