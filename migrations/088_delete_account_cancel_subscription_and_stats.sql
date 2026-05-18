-- ════════════════════════════════════════════════════════════════════════
-- 088_delete_account_cancel_subscription_and_stats.sql
-- ════════════════════════════════════════════════════════════════════════
--
-- Two related deletion-flow improvements:
--
--   1. CANCEL ACTIVE DRIVER SUBSCRIPTIONS on self-deletion
--      Currently delete_user_account_v2 (mig 035) anonymizes the profile
--      and rotates emails on related tables, but leaves driver_subscriptions
--      rows untouched. A driver with status='active' subscription deletes
--      their account → row keeps existing with rotated email but active
--      status. Two concrete problems:
--        - Admin dashboards counting "active subscriptions" become wrong
--        - Future cron jobs that look at active subs see a ghost
--      Fix: set status='cancelled', cancelled_at=NOW(), period_end=NOW()
--      on every active/pending subscription owned by the deleted user.
--
--      Per business policy: NO REFUND on self-deletion. The
--      cancellation just ends the subscription at the moment of
--      deletion — the user forfeits any remaining paid period. This
--      matches what most rideshare/SaaS apps do.
--
--   2. STATS VIEW for the admin deletion dashboard
--      The admin dashboard needs aggregate numbers for:
--        - Deletions per week / per month
--        - Top deletion reasons
--        - Passenger vs driver vs both breakdown
--      The data exists on profiles (deletion_reason, deleted_at,
--      account_type) but querying it efficiently from the dashboard
--      needs an index + a couple of helper views.
--
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Subscription-cancel cleanup in the deletion RPC ──────────────────

CREATE OR REPLACE FUNCTION public.delete_user_account_v2(
  p_reason TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid                    UUID := auth.uid();
  v_old_email              TEXT;
  v_new_email              TEXT;
  v_today                  DATE := CURRENT_DATE;
  v_active_trips           INT;
  v_active_bookings        INT;
  v_cancelled_subs         INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_old_email FROM auth.users WHERE id = v_uid;
  IF v_old_email IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- Server-side precondition: no active trips/bookings (unchanged)
  SELECT COUNT(*) INTO v_active_trips
  FROM public.trips
  WHERE driver_email = v_old_email
    AND status = 'confirmed'
    AND date >= v_today;
  IF v_active_trips > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming trips as driver', v_active_trips;
  END IF;

  SELECT COUNT(*) INTO v_active_bookings
  FROM public.bookings b
  JOIN public.trips t ON t.id::text = b.trip_id
  WHERE b.passenger_email = v_old_email
    AND b.status = 'confirmed'
    AND t.date >= v_today;
  IF v_active_bookings > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming bookings as passenger', v_active_bookings;
  END IF;

  -- ─── NEW (mig 088): Cancel active driver subscriptions ────────────────
  -- Status transitions:
  --   active   → cancelled (with period_end = NOW)
  --   pending  → cancelled (never started, no money was charged)
  --   expired  → unchanged (already terminal)
  --   cancelled → unchanged (already terminal)
  --
  -- We only flip rows where status is currently 'active' or 'pending'
  -- so a re-run of the deletion RPC (idempotency / retry scenario) is a
  -- no-op for the subscription table on the second pass.
  --
  -- IF EXISTS guard so the migration works even if mig 009 hasn't been
  -- applied yet (very unlikely in production, but defensive).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'driver_subscriptions'
  ) THEN
    UPDATE public.driver_subscriptions
       SET status        = 'cancelled',
           cancelled_at  = NOW(),
           period_end    = LEAST(period_end, NOW()),
           cancel_reason = 'account_deleted'
     WHERE driver_email = v_old_email
       AND status IN ('active', 'pending');
    GET DIAGNOSTICS v_cancelled_subs = ROW_COUNT;
  END IF;

  v_new_email := 'deleted-' || v_uid || '@deleted.local';

  -- ─── DELETION HANDSHAKE (mig 035, unchanged) ──────────────────────────
  PERFORM set_config('mishwar.deleting_account', v_uid::text, true);

  -- 1) Anonymize profile
  UPDATE public.profiles
     SET full_name            = 'مستخدم محذوف',
         email                = v_new_email,
         phone                = NULL,
         avatar_url           = NULL,
         dob                  = NULL,
         gender               = NULL,
         car_model            = NULL,
         car_year             = NULL,
         car_color            = NULL,
         car_plate            = NULL,
         car_image            = NULL,
         bank_iban            = NULL,
         jawwal_pay_number    = NULL,
         reflect_number       = NULL,
         credit_card_enabled  = FALSE,
         deletion_reason      = COALESCE(p_reason, deletion_reason),
         deleted_at           = NOW()
   WHERE id = v_uid;

  -- 2) Rotate auth.users email
  UPDATE auth.users
     SET email          = v_new_email,
         email_confirmed_at = NULL,
         banned_until   = '2099-12-31 00:00:00+00'
   WHERE id = v_uid;

  -- 3) Anonymize denormalized email columns
  UPDATE public.messages       SET sender_email   = v_new_email WHERE sender_email   = v_old_email;
  UPDATE public.messages       SET receiver_email = v_new_email WHERE receiver_email = v_old_email;
  UPDATE public.bookings       SET passenger_email = v_new_email WHERE passenger_email = v_old_email;
  UPDATE public.trips          SET driver_email    = v_new_email WHERE driver_email    = v_old_email;
  UPDATE public.notifications  SET user_email     = v_new_email WHERE user_email     = v_old_email;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewer_email') THEN
    UPDATE public.reviews SET reviewer_email = v_new_email WHERE reviewer_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewed_email') THEN
    UPDATE public.reviews SET reviewed_email = v_new_email WHERE reviewed_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_blocks' AND column_name='blocker_email') THEN
    UPDATE public.user_blocks SET blocker_email = v_new_email WHERE blocker_email = v_old_email;
    UPDATE public.user_blocks SET blocked_email = v_new_email WHERE blocked_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trip_requests') THEN
    UPDATE public.trip_requests SET passenger_email = v_new_email WHERE passenger_email = v_old_email;
  END IF;

  -- Also anonymize driver_subscriptions email column itself so audit
  -- doesn't leak the original email. Done AFTER the status flip above
  -- so the cancellation row references the original email-at-the-time
  -- in cancel_reason if needed.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_subscriptions') THEN
    UPDATE public.driver_subscriptions SET driver_email = v_new_email WHERE driver_email = v_old_email;
  END IF;

  RETURN jsonb_build_object(
    'success',              true,
    'deleted_at',           NOW(),
    'reason',               p_reason,
    'cancelled_subscriptions', v_cancelled_subs
  );
END $$;

REVOKE ALL ON FUNCTION public.delete_user_account_v2(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account_v2(TEXT) TO authenticated;

-- ─── 2. Ensure driver_subscriptions has the cancel_reason column ─────────
--
-- Mig 009 created the table but didn't include cancel_reason. We need
-- it so the deletion path above can write 'account_deleted' as the
-- terminal reason. If the column already exists, this is a no-op.

ALTER TABLE public.driver_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;

-- ─── 3. Index for the deletion stats dashboard ───────────────────────────
--
-- Most queries on the new admin tab will filter `deleted_at IS NOT NULL`
-- and either group by week or by deletion_reason. Partial index keeps
-- size tiny since the vast majority of profiles are NOT deleted.

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at_reason
  ON public.profiles (deleted_at DESC, deletion_reason, account_type)
  WHERE deleted_at IS NOT NULL;

-- ─── 4. Admin-only stats view for the dashboard ──────────────────────────
--
-- A SECURITY DEFINER function (not a view, since RLS on profiles
-- would otherwise block the aggregate counts for non-admin users —
-- though only admins should call it, the dashboard pings it from
-- the client). The function returns a JSON blob with everything
-- the dashboard needs in one round trip:
--   - total_deleted: lifetime count
--   - deleted_today / this_week / this_month
--   - by_reason: { reason → count } map
--   - by_account_type: { passenger / driver / both → count } map
--   - daily_last_30: array of {date, count} for the chart

CREATE OR REPLACE FUNCTION public.admin_deletion_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_role TEXT := public.auth_user_role();
  v_result      jsonb;
BEGIN
  -- Admin-only. Non-admins get an empty object so the dashboard's
  -- fetch doesn't blow up — admin role check is the auth boundary.
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'admin_only');
  END IF;

  SELECT jsonb_build_object(
    'total_deleted', (
      SELECT COUNT(*) FROM public.profiles WHERE deleted_at IS NOT NULL
    ),
    'deleted_today', (
      SELECT COUNT(*) FROM public.profiles
       WHERE deleted_at IS NOT NULL
         AND deleted_at >= date_trunc('day', NOW())
    ),
    'deleted_this_week', (
      SELECT COUNT(*) FROM public.profiles
       WHERE deleted_at IS NOT NULL
         AND deleted_at >= date_trunc('week', NOW())
    ),
    'deleted_this_month', (
      SELECT COUNT(*) FROM public.profiles
       WHERE deleted_at IS NOT NULL
         AND deleted_at >= date_trunc('month', NOW())
    ),
    'by_reason', (
      SELECT COALESCE(jsonb_object_agg(reason_label, cnt), '{}'::jsonb)
        FROM (
          SELECT COALESCE(NULLIF(TRIM(deletion_reason), ''), 'لم يُحدَّد') AS reason_label,
                 COUNT(*) AS cnt
            FROM public.profiles
           WHERE deleted_at IS NOT NULL
           GROUP BY reason_label
           ORDER BY cnt DESC
           LIMIT 20
        ) r
    ),
    'by_account_type', (
      SELECT COALESCE(jsonb_object_agg(t, cnt), '{}'::jsonb)
        FROM (
          SELECT COALESCE(account_type, 'unknown') AS t,
                 COUNT(*) AS cnt
            FROM public.profiles
           WHERE deleted_at IS NOT NULL
           GROUP BY account_type
        ) a
    ),
    'daily_last_30', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day_str, 'count', cnt) ORDER BY day_str), '[]'::jsonb)
        FROM (
          SELECT to_char(date_trunc('day', deleted_at), 'YYYY-MM-DD') AS day_str,
                 COUNT(*) AS cnt
            FROM public.profiles
           WHERE deleted_at IS NOT NULL
             AND deleted_at >= NOW() - INTERVAL '30 days'
           GROUP BY day_str
        ) d
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_deletion_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deletion_stats() TO authenticated;

-- ─── 5. Admin-only recent deletions list (for the dashboard table) ──────
--
-- Returns the last N deleted users with anonymized identifying info
-- (we DON'T leak the original email even to admin — only the
-- deletion details, account type, reason). Admin can correlate with
-- the activity log for the email-at-time-of-deletion if needed.

CREATE OR REPLACE FUNCTION public.admin_deletion_list(
  p_limit INT DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_role TEXT := public.auth_user_role();
  v_result      jsonb;
BEGIN
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'admin_only');
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 50; END IF;
  IF p_limit > 200 THEN p_limit := 200; END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'deleted_at') DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'id',              p.id,
        'deleted_at',      p.deleted_at,
        'deletion_reason', COALESCE(NULLIF(TRIM(p.deletion_reason), ''), null),
        'account_type',    p.account_type,
        'days_active',     CASE
                             WHEN p.created_at IS NOT NULL AND p.deleted_at IS NOT NULL
                             THEN EXTRACT(DAY FROM (p.deleted_at - p.created_at))::int
                             ELSE NULL
                           END
      ) AS row_data
        FROM public.profiles p
       WHERE p.deleted_at IS NOT NULL
       ORDER BY p.deleted_at DESC
       LIMIT p_limit
    ) sub;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_deletion_list(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deletion_list(INT) TO authenticated;

COMMIT;

-- ─── VERIFICATION QUERIES ─────────────────────────────────────────────
--
--   -- Functions present:
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('delete_user_account_v2', 'admin_deletion_stats', 'admin_deletion_list');
--   -- Expect 3 rows.
--
--   -- Column added:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='driver_subscriptions'
--      AND column_name IN ('cancel_reason','cancelled_at');
--   -- Expect 2 rows.
--
--   -- Index created:
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='profiles'
--      AND indexname='idx_profiles_deleted_at_reason';
--   -- Expect 1 row.
--
--   -- Smoke-test the stats RPC as admin:
--   SELECT public.admin_deletion_stats();
--   -- Returns a JSON object; if no deletions yet, all counts are 0 and
--   -- the by_reason / by_account_type / daily_last_30 maps are empty.
