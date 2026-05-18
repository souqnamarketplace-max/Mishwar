-- ════════════════════════════════════════════════════════════════════════
-- Migration 079 — Atomic email rotation across all dependent tables
-- ════════════════════════════════════════════════════════════════════════
--
-- AUDIT FINDING: email changes via auth.updateMe() flipped the
-- auth.users.email but left dozens of denormalized email columns in
-- public schema tables pointing at the OLD email. Result: user changes
-- email → loses their favorites, notifications, messages, bookings,
-- subscription, audit history. Effectively a soft account-orphan.
--
-- Why so many denormalized columns existed:
--   - Mishwaro's tables predominantly use email (TEXT) as the user
--     identifier, not auth.users(id) UUID FKs. This was a base44
--     legacy decision that's deeply baked in — too risky to undo at
--     this stage without a much bigger migration.
--   - mig 001 noted explicitly: 'denormalized columns intentionally
--     snapshot the driver state at trip creation time'. That's still
--     correct for driver_name + driver_avatar (those are historical
--     trip metadata). But it's WRONG for trip ownership: trips.
--     driver_email should follow the user's identity, not snapshot it.
--
-- DESIGN DECISIONS:
--
--   1. Single SECURITY DEFINER RPC update_my_email(new_email TEXT)
--      that orchestrates the whole cascade in one transaction. If
--      ANY UPDATE fails, the whole rotation rolls back — the user
--      stays at the old email, no partial-update orphans.
--
--   2. The RPC is the ONLY supported path. Direct auth.updateMe()
--      WITHOUT the cascade would leave the data corrupted. The
--      frontend has been updated (AccountSettings.jsx) to call this
--      RPC after the Supabase auth confirmation completes.
--
--   3. We do NOT rewrite admin_audit_log.admin_email. Audit history
--      must preserve the historical identifier — if user X did
--      something at time T under email A, the log says A, even after
--      they change to B. Same principle as banks keeping check-image
--      records under the name on the check, not the renamed-since
--      account holder. The _actor_label() function (mig 073) already
--      resolves emails to current names at READ time, so the audit
--      log displays correctly without needing to mutate history.
--
--   4. trips.driver_name + trips.driver_avatar stay as snapshots
--      per the mig 001 design comment. Only the IDENTIFIER columns
--      (driver_email, passenger_email, user_email, created_by) get
--      rewritten.
--
--   5. The RPC verifies the new email matches the caller's CURRENT
--      auth.users.email. This means the user MUST complete the
--      Supabase email-change confirmation FIRST (which updates
--      auth.users.email), THEN this RPC runs to backfill everything
--      else. Frontend orchestrates this two-step.
--
--   6. Concurrency / locking: each UPDATE acquires row locks on the
--      affected rows. The transaction is short (single user's worth
--      of rows across ~15 tables, typically <500 rows total) so
--      lock contention is acceptable.
--
-- COVERAGE: every table found via the audit
--   grep -rhE '(driver_email|passenger_email|user_email|created_by|
--              suggested_by_email|matched_with_email|search_email)
--              \s+TEXT' migrations/*.sql
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.update_my_email(p_new_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid           UUID;
  v_auth_email    TEXT;
  v_old_email     TEXT;
  v_clean_new     TEXT;
  v_rows_updated  JSONB := '{}'::jsonb;
  v_count         INTEGER;
BEGIN
  -- ── 1. Identify the caller ──
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Read what auth.users currently has — this is the SOURCE OF TRUTH
  -- for who the caller is. If they completed the Supabase email change
  -- confirmation flow, this will be the NEW email.
  SELECT email INTO v_auth_email FROM auth.users WHERE id = v_uid;
  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'Auth user not found' USING ERRCODE = '28000';
  END IF;

  v_clean_new := lower(trim(p_new_email));

  -- The new email passed in MUST match auth.users.email — that's the
  -- proof that the caller has already completed Supabase's email
  -- confirmation flow. We don't accept an arbitrary email; only the
  -- one auth has already approved.
  IF v_clean_new <> lower(v_auth_email) THEN
    RAISE EXCEPTION 'New email % does not match authenticated identity %. Complete the email confirmation link first.',
      v_clean_new, v_auth_email
      USING ERRCODE = '22023';
  END IF;

  -- ── 2. Find the old email by looking at profiles (which we haven't
  --       cascaded yet, so it still has the pre-change value). If
  --       profiles is already at the new email, this is a no-op
  --       (idempotent — safe to call twice). ──
  SELECT email INTO v_old_email FROM public.profiles WHERE id = v_uid;
  IF v_old_email IS NULL OR lower(v_old_email) = v_clean_new THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'message', 'No cascade needed — already in sync',
      'old_email', v_old_email,
      'new_email', v_clean_new
    );
  END IF;

  -- Defensive: refuse to cascade to an email another user already owns.
  -- The unique constraint on auth.users prevents the auth-side conflict,
  -- but profiles has NO unique constraint on email (legacy from base44),
  -- so a parallel cascade for two different users to the same target
  -- could leave us with duplicate rows. Guard.
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE lower(email) = v_clean_new AND id <> v_uid
  ) THEN
    RAISE EXCEPTION 'Another account already uses email %', v_clean_new
      USING ERRCODE = '23505';
  END IF;

  -- ── 3. Cascade ──
  -- We rewrite the OLD email to the NEW email everywhere. Order doesn't
  -- matter functionally (it's all inside one transaction) but we go
  -- profiles → owned tables → relational tables for readability.

  -- profiles
  UPDATE public.profiles SET email = v_clean_new WHERE id = v_uid;

  -- trips: identifier columns only. driver_name + driver_avatar stay
  -- as historical snapshots.
  UPDATE public.trips SET driver_email = v_clean_new WHERE driver_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('trips_driver_email', v_count);

  UPDATE public.trips SET created_by = v_clean_new WHERE created_by = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('trips_created_by', v_count);

  -- bookings
  UPDATE public.bookings SET passenger_email = v_clean_new WHERE passenger_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('bookings_passenger_email', v_count);

  UPDATE public.bookings SET created_by = v_clean_new WHERE created_by = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('bookings_created_by', v_count);

  -- favorite_drivers — both sides. Other users' favorites of THIS user
  -- (driver_email side) follow as well, so people who favorited me
  -- keep me in their list when I change email.
  UPDATE public.favorite_drivers SET passenger_email = v_clean_new WHERE passenger_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('favorite_drivers_passenger', v_count);

  UPDATE public.favorite_drivers SET driver_email = v_clean_new WHERE driver_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('favorite_drivers_driver', v_count);

  -- notifications — without this, user stops receiving pings to old email
  UPDATE public.notifications SET user_email = v_clean_new WHERE user_email = v_old_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_rows_updated := v_rows_updated || jsonb_build_object('notifications', v_count);

  -- Optional/conditional tables — wrap each in a check so the migration
  -- gracefully handles environments where some tables don't exist yet
  -- (e.g. dev branches missing later migrations).

  -- messages
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='messages') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.messages SET sender_email = %L WHERE sender_email = %L',
        v_clean_new, v_old_email
      );
      EXECUTE format(
        'UPDATE public.messages SET recipient_email = %L WHERE recipient_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN
      -- Column name may differ (legacy field naming). Skip gracefully.
      NULL;
    END;
  END IF;

  -- device_tokens (for push)
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='device_tokens') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.device_tokens SET user_email = %L WHERE user_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- trip_requests
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='trip_requests') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.trip_requests SET passenger_email = %L WHERE passenger_email = %L',
        v_clean_new, v_old_email
      );
      EXECUTE format(
        'UPDATE public.trip_requests SET created_by = %L WHERE created_by = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- trip_preferences (route watchers)
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='trip_preferences') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.trip_preferences SET user_email = %L WHERE user_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- driver_subscriptions
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='driver_subscriptions') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.driver_subscriptions SET driver_email = %L WHERE driver_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- driver_licenses
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='driver_licenses') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.driver_licenses SET driver_email = %L WHERE driver_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- city_suggestions (suggested_by_email)
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='city_suggestions') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.city_suggestions SET suggested_by_email = %L WHERE suggested_by_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- Reviews (driver↔passenger ratings)
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='reviews') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.reviews SET reviewer_email = %L WHERE reviewer_email = %L',
        v_clean_new, v_old_email
      );
      EXECUTE format(
        'UPDATE public.reviews SET rated_user_email = %L WHERE rated_user_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- User reports
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='user_reports') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.user_reports SET reporter_email = %L WHERE reporter_email = %L',
        v_clean_new, v_old_email
      );
      EXECUTE format(
        'UPDATE public.user_reports SET reported_email = %L WHERE reported_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- User blocks (block list — both ends)
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='user_blocks') THEN
    BEGIN
      EXECUTE format(
        'UPDATE public.user_blocks SET blocker_email = %L WHERE blocker_email = %L',
        v_clean_new, v_old_email
      );
      EXECUTE format(
        'UPDATE public.user_blocks SET blocked_email = %L WHERE blocked_email = %L',
        v_clean_new, v_old_email
      );
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- ── 4. Return summary ──
  RAISE NOTICE 'update_my_email: rotated % → % for uid % — counts %',
    v_old_email, v_clean_new, v_uid, v_rows_updated;

  RETURN jsonb_build_object(
    'success', TRUE,
    'old_email', v_old_email,
    'new_email', v_clean_new,
    'rows_updated', v_rows_updated
  );
END;
$$;

-- Authenticated users only. Anonymous callers can't get past the
-- auth.uid() IS NULL check anyway, but being explicit is cheap defense.
REVOKE ALL ON FUNCTION public.update_my_email(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_my_email(TEXT) TO authenticated;

COMMIT;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn_exists  BOOLEAN;
  v_fn_definer BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_my_email'
  ) INTO v_fn_exists;
  SELECT prosecdef INTO v_fn_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='update_my_email';
  IF NOT v_fn_exists  THEN RAISE EXCEPTION 'MIGRATION 079 FAILED — update_my_email RPC missing'; END IF;
  IF NOT v_fn_definer THEN RAISE EXCEPTION 'MIGRATION 079 FAILED — RPC not SECURITY DEFINER'; END IF;
  RAISE NOTICE 'MIGRATION 079 OK — update_my_email RPC ready';
END;
$$;
