-- ════════════════════════════════════════════════════════════════════════
-- Migration 060 — Trigger that invokes the push-notification Edge Function
-- ════════════════════════════════════════════════════════════════════════
--
-- WIRES UP THE PUSH PIPELINE
--
-- When a row is inserted into public.notifications, this trigger fires
-- and POSTs to the send-push-notification Edge Function with the
-- notification payload. The Edge Function looks up device_tokens for
-- the target user and delivers via FCM HTTP v1.
--
-- ═══ ARCHITECTURE ═══
--
--   App code  → INSERT INTO notifications (user_email, title, message, ...)
--                  │
--                  ▼ AFTER INSERT trigger fires
--   pg_net    → POST https://<project>.functions.supabase.co/v1/send-push-notification
--                  │
--                  ▼
--   Edge Fn   → Read device_tokens for user_email
--             → For each token: FCM HTTP v1 send
--             → Clean up stale tokens
--                  │
--                  ▼
--   APNS / FCM → User's iPhone / Android phone shows the notification
--
-- ═══ pg_net ═══
--
-- pg_net is Supabase's HTTP-from-Postgres extension. It's enabled by
-- default on Pro plans (verified during the audit). All requests are
-- async — net.http_post returns a request_id immediately, the actual
-- HTTP call happens in a background worker. This is what we want:
--   - Notification INSERT completes in ~10ms even when FCM is slow
--   - A flaky Edge Function never blocks notification creation
--   - Caller (the RPC inserting the notification) doesn't care about
--     push delivery — the notification is the source of truth, push
--     is just a courtesy
--
-- ═══ AUTH ═══
--
-- The Edge Function has verify_jwt = true. The trigger needs to pass
-- a valid Supabase JWT in the Authorization header. We use the
-- service_role key for this, retrieved from vault.
--
-- vault.decrypted_secrets is a Supabase-provided view that exposes
-- secrets you've stored via the Vault. We need to set up two secrets:
--   - 'project_url'       — https://dimtdwahtwaslmnuakij.functions.supabase.co
--   - 'service_role_key'  — the project's service_role JWT
--
-- These are NOT the same as Edge Function secrets (those are runtime
-- env vars for the function). Vault secrets are readable by Postgres
-- functions running as SECURITY DEFINER.
--
-- If vault secrets aren't set up, the trigger logs a warning and skips
-- the HTTP call — the notification still gets inserted, just no push.
--
-- ═══ MUST DO AFTER APPLYING THIS MIGRATION ═══
--
-- Run these two statements in Supabase SQL editor to populate the
-- vault secrets (replace SERVICE_ROLE_KEY_HERE with your actual key
-- from Project Settings → API → service_role key):
--
--   SELECT vault.create_secret(
--     'https://dimtdwahtwaslmnuakij.functions.supabase.co',
--     'project_functions_url',
--     'Base URL for invoking this project''s Edge Functions'
--   );
--
--   SELECT vault.create_secret(
--     'SERVICE_ROLE_KEY_HERE',
--     'service_role_key',
--     'Service role JWT used by push trigger to invoke Edge Functions'
--   );
--
-- (The trigger handles missing secrets gracefully — it logs and skips.)
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Helper: read a vault secret by name ────────────────────────────
-- Returns NULL if the secret doesn't exist. Wraps vault.decrypted_secrets
-- so the trigger function doesn't depend on the exact schema layout
-- (Supabase has changed it before).
CREATE OR REPLACE FUNCTION public._get_vault_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public, pg_catalog
AS $$
DECLARE
  v_value TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_value
      FROM vault.decrypted_secrets
     WHERE name = p_name
     LIMIT 1;
  EXCEPTION
    WHEN OTHERS THEN
      -- Vault schema not available or some other access issue. Return
      -- NULL — caller will skip the HTTP call.
      RETURN NULL;
  END;
  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public._get_vault_secret(TEXT) FROM PUBLIC;
-- Only callable from other SECURITY DEFINER functions; we don't grant
-- to authenticated.

-- ─── The trigger function ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notifications_send_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
  v_url       TEXT;
  v_key       TEXT;
  v_payload   JSONB;
  v_title     TEXT;
  v_body      TEXT;
BEGIN
  -- Load vault secrets. If either is missing, log + skip (don't fail
  -- the INSERT — the notification row still gets created).
  v_url := public._get_vault_secret('project_functions_url');
  v_key := public._get_vault_secret('service_role_key');

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'notifications_send_push: vault secrets not configured (project_functions_url or service_role_key missing) — push skipped for notification id=%', NEW.id;
    RETURN NEW;
  END IF;

  -- Build the title/body for the push. The notifications table has a
  -- 'message' column (verified via audit) — we use it as the body. The
  -- title comes from the 'type' column mapped to a human-friendly
  -- Arabic string, falling back to 'مشوارو' if unrecognized.
  --
  -- This mapping is INSIDE the trigger so it's authoritative — if we
  -- want to change how titles render, one place to update.
  v_title := CASE NEW.type
    WHEN 'booking_request'   THEN 'طلب حجز جديد'
    WHEN 'booking_confirmed' THEN 'تم تأكيد حجزك'
    WHEN 'booking_cancelled' THEN 'تم إلغاء الحجز'
    WHEN 'trip_cancelled'    THEN 'تم إلغاء الرحلة'
    WHEN 'trip_started'      THEN 'بدأت الرحلة'
    WHEN 'trip_completed'    THEN 'اكتملت الرحلة'
    WHEN 'message'           THEN 'رسالة جديدة'
    WHEN 'review_received'   THEN 'تقييم جديد'
    WHEN 'admin'             THEN 'إشعار من الإدارة'
    ELSE 'مشوارو'
  END;

  -- Body: the human-readable message. Truncate to 200 chars to keep
  -- APNS/FCM payloads small (APNS has a 4KB payload limit; truncating
  -- the body is the easiest guard).
  v_body := LEFT(COALESCE(NEW.message, ''), 200);

  -- Data payload — passes through anything the app needs to deep-link
  -- on tap. We always include the notification id + type so the iOS
  -- app can route to the right screen.
  v_payload := jsonb_build_object(
    'user_email', NEW.user_email,
    'title',      v_title,
    'body',       v_body,
    'data', jsonb_build_object(
      'notification_id', NEW.id::text,
      'type',            COALESCE(NEW.type, ''),
      'link',            COALESCE(NEW.link, '')
    )
  );

  -- Fire-and-forget HTTP POST. pg_net returns the request_id; we don't
  -- check the result. If it fails, the next notification will retry
  -- the same Edge Function (independent invocations).
  PERFORM net.http_post(
    url := v_url || '/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := v_payload
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Any failure here (network, pg_net not enabled, JSON build error)
    -- must not block the INSERT. Log and continue.
    RAISE WARNING 'notifications_send_push failed for id=%: % %', NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_send_push() FROM PUBLIC;
-- The trigger is invoked by the system (no role grant needed). The
-- function runs as SECURITY DEFINER so it can read vault.

-- ─── Attach the trigger ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notifications_send_push ON public.notifications;
CREATE TRIGGER trg_notifications_send_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notifications_send_push();

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON p.pronamespace = n.oid
                  WHERE n.nspname = 'public' AND p.proname = 'notifications_send_push') THEN
    v_missing := v_missing || E'\n  - notifications_send_push function';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_notifications_send_push'
                    AND tgrelid = 'public.notifications'::regclass) THEN
    v_missing := v_missing || E'\n  - trg_notifications_send_push trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    v_missing := v_missing || E'\n  - pg_net extension (needs: CREATE EXTENSION pg_net; — should be enabled by default on Supabase Pro)';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRATION 060 FAILED — missing: %', v_missing;
  END IF;

  -- Friendly reminder about vault secrets — these aren't strictly
  -- required for the migration to apply, but the trigger is a no-op
  -- until they're set.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_functions_url'
  ) THEN
    RAISE NOTICE 'REMINDER: vault secret ''project_functions_url'' not yet set. Push trigger will be a no-op until you run vault.create_secret() for it.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key'
  ) THEN
    RAISE NOTICE 'REMINDER: vault secret ''service_role_key'' not yet set. Push trigger will be a no-op until you run vault.create_secret() for it.';
  END IF;

  RAISE NOTICE 'MIGRATION 060 OK — push trigger installed (vault secrets pending if reminders above appeared)';
END $$;

COMMIT;
