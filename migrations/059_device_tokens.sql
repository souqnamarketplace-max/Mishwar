-- ════════════════════════════════════════════════════════════════════════
-- Migration 059 — device_tokens table for native push notifications
-- ════════════════════════════════════════════════════════════════════════
--
-- CONTEXT
-- Audit Section 7 + 9 flagged the absence of native push notifications.
-- The frontend currently uses the browser Notification API, which does
-- NOT survive backgrounding on mobile — meaning drivers don't get
-- alerted to new bookings if they have the app closed, and passengers
-- don't see "driver confirmed" pushes when they're not actively in the
-- app. For a rideshare product this is launch-blocking.
--
-- The full push pipeline has these pieces:
--   (1) device_tokens table          (this migration)
--   (2) Capacitor PushNotifications  (frontend, next commit)
--   (3) Supabase Edge Function       (next commit) — fans out a
--                                       notifications row to FCM/APNS
--   (4) Postgres trigger             (next commit) — invokes the Edge
--                                       Function on notifications INSERT
--
-- THIS MIGRATION JUST CREATES THE TABLE. It's independent — applying
-- it doesn't change any user-facing behavior. The real wiring happens
-- in subsequent commits once Firebase + APNS are configured.
--
-- SCHEMA
--   id            UUID PK
--   user_email    TEXT     — denormalized, matches our auth.email()
--                            pattern used elsewhere in the codebase
--   platform      TEXT     — 'ios' | 'android' | 'web'
--   token         TEXT     — APNS device token | FCM registration token
--                            | Web Push subscription endpoint
--                            UNIQUE so the same physical device can't
--                            have duplicate rows
--   device_id     TEXT     — Capacitor's Device.getId().identifier
--                            (one per install per device). Lets us
--                            invalidate when the user reinstalls.
--   app_version   TEXT     — for analytics: which app builds have push
--                            registered. Helps debug "push doesn't work
--                            on old versions".
--   last_seen_at  TIMESTAMPTZ — updated on every app open. Tokens
--                            untouched for >90 days are likely stale
--                            (user uninstalled) and can be pruned.
--   created_at    TIMESTAMPTZ
--   updated_at    TIMESTAMPTZ
--
-- WHY USER_EMAIL not USER_ID?
-- The rest of the codebase keys on email. notifications.user_email,
-- profiles.email, bookings.passenger_email. Consistency > theoretical
-- purity. If we ever switch the system to user_id, this is one of
-- ~30 tables to update.
--
-- WHY NOT FOREIGN KEY TO auth.users?
-- Same reason as other tables in this codebase: auth.users is the
-- Supabase-managed schema, and FKing into it from our schema creates
-- cross-schema coupling that breaks on certain Supabase platform
-- updates. We rely on the email match instead.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email   TEXT        NOT NULL,
  platform     TEXT        NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token        TEXT        NOT NULL UNIQUE,
  device_id    TEXT,
  app_version  TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.device_tokens IS 'APNS/FCM/Web Push tokens, one row per device per install. Used by the push fan-out Edge Function to look up where to deliver a notification.';
COMMENT ON COLUMN public.device_tokens.token IS 'Platform-specific opaque token. APNS device token | FCM registration token | Web Push subscription endpoint.';
COMMENT ON COLUMN public.device_tokens.device_id IS 'Capacitor Device.getId().identifier — stable per install. Used for re-registration cleanup.';

-- ─── Indexes ─────────────────────────────────────────────────────────
-- The fan-out path queries WHERE user_email = X — this needs to be fast,
-- it runs synchronously inside the notifications-INSERT trigger.
CREATE INDEX IF NOT EXISTS idx_device_tokens_user
  ON public.device_tokens (user_email);

-- Token uniqueness already enforced by UNIQUE constraint; no extra
-- index needed for upsert lookups.

-- The cleanup job (TODO future) will use this:
CREATE INDEX IF NOT EXISTS idx_device_tokens_last_seen
  ON public.device_tokens (last_seen_at);

-- ─── Auto-update updated_at on row changes ───────────────────────────
-- Standard pattern matching the other timestamp-tracked tables.
CREATE OR REPLACE FUNCTION public.device_tokens_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_tokens_updated_at ON public.device_tokens;
CREATE TRIGGER trg_device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.device_tokens_set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────
-- Lock down by default; allow each user to manage only their own tokens.
-- Admin (auth_user_role() = 'admin') can SELECT all for support purposes.
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_tokens_select_own ON public.device_tokens;
CREATE POLICY device_tokens_select_own
  ON public.device_tokens
  FOR SELECT
  TO authenticated
  USING (
    user_email = auth.email()
    OR public.auth_user_role() = 'admin'
  );

DROP POLICY IF EXISTS device_tokens_insert_own ON public.device_tokens;
CREATE POLICY device_tokens_insert_own
  ON public.device_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS device_tokens_update_own ON public.device_tokens;
CREATE POLICY device_tokens_update_own
  ON public.device_tokens
  FOR UPDATE
  TO authenticated
  USING (user_email = auth.email())
  WITH CHECK (user_email = auth.email());

DROP POLICY IF EXISTS device_tokens_delete_own ON public.device_tokens;
CREATE POLICY device_tokens_delete_own
  ON public.device_tokens
  FOR DELETE
  TO authenticated
  USING (user_email = auth.email());

-- ─── Helper RPC: upsert device token ─────────────────────────────────
-- Called by the frontend after Capacitor PushNotifications.register()
-- fires the 'registration' event. Idempotent — handles three cases:
--   1. New device, no existing row     → INSERT
--   2. Same device, different user     → UPDATE the row's user_email
--      (the same phone now used by user B; B is the current owner)
--   3. Same device, same user, token refreshed → UPDATE token
--
-- Returning the row so the frontend can confirm.
CREATE OR REPLACE FUNCTION public.upsert_device_token(
  p_platform    TEXT,
  p_token       TEXT,
  p_device_id   TEXT DEFAULT NULL,
  p_app_version TEXT DEFAULT NULL
)
RETURNS public.device_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email TEXT;
  v_row   public.device_tokens;
BEGIN
  v_email := auth.email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_platform NOT IN ('ios','android','web') THEN
    RAISE EXCEPTION 'invalid platform: %', p_platform USING ERRCODE = '22023';
  END IF;
  IF p_token IS NULL OR length(p_token) < 10 THEN
    RAISE EXCEPTION 'token is required' USING ERRCODE = '22023';
  END IF;

  -- ON CONFLICT (token) means: if this exact token is already in the
  -- table, update it (probably the same device, possibly a different
  -- user if they switched accounts on the same phone — we want the
  -- token to belong to whoever's currently signed in).
  INSERT INTO public.device_tokens
    (user_email, platform, token, device_id, app_version, last_seen_at)
  VALUES
    (v_email, p_platform, p_token, p_device_id, p_app_version, NOW())
  ON CONFLICT (token) DO UPDATE
  SET user_email   = EXCLUDED.user_email,
      platform     = EXCLUDED.platform,
      device_id    = COALESCE(EXCLUDED.device_id, public.device_tokens.device_id),
      app_version  = COALESCE(EXCLUDED.app_version, public.device_tokens.app_version),
      last_seen_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_device_token(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_device_token(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ─── Helper RPC: delete current user's tokens ────────────────────────
-- Called on logout — clears the device's tokens so the next user who
-- signs in on the same phone doesn't get notifications addressed to
-- the previous user. Note: deleteMe() (account deletion) already
-- cascades via the auth-level cleanup, so this is specifically for
-- logout-but-not-delete-account.
CREATE OR REPLACE FUNCTION public.delete_my_device_token(p_token TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email TEXT;
  v_count INTEGER;
BEGIN
  v_email := auth.email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.device_tokens
   WHERE user_email = v_email
     AND token = p_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_device_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_device_token(TEXT) TO authenticated;

-- ─── Verification ────────────────────────────────────────────────────
DO $$
DECLARE v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname='public' AND tablename='device_tokens') THEN
    v_missing := v_missing || E'\n  - device_tokens table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables
                  WHERE schemaname='public' AND tablename='device_tokens'
                    AND rowsecurity = true) THEN
    v_missing := v_missing || E'\n  - device_tokens RLS enabled';
  END IF;
  IF (SELECT COUNT(*) FROM pg_policies
       WHERE schemaname='public' AND tablename='device_tokens') < 4 THEN
    v_missing := v_missing || E'\n  - 4 policies on device_tokens';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON p.pronamespace=n.oid
                  WHERE n.nspname='public' AND p.proname='upsert_device_token') THEN
    v_missing := v_missing || E'\n  - upsert_device_token function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON p.pronamespace=n.oid
                  WHERE n.nspname='public' AND p.proname='delete_my_device_token') THEN
    v_missing := v_missing || E'\n  - delete_my_device_token function';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRATION 059 FAILED — missing: %', v_missing;
  END IF;
  RAISE NOTICE 'MIGRATION 059 OK — device_tokens table + helpers ready';
END $$;

COMMIT;
