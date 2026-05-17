-- ════════════════════════════════════════════════════════════════════════
-- Migration 066 — Email delivery trigger
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- Migration 060 wired push notifications via pg_net → send-push-notification
-- → FCM/APNS. This migration wires email notifications in parallel via
-- pg_net → send-notification-email → Resend.
--
-- DESIGN DECISIONS
--
-- Separate trigger function rather than extending notifications_send_push:
--   - Push and email failures are independent. If Resend is down, push
--     still fires. If FCM has a hiccup, email still delivers.
--   - Each pipeline can be tweaked / disabled without touching the other.
--   - The push function in migration 060 is working in production —
--     adding a 'send email' branch to it risks regressing push.
--
-- Same vault-secret reading helper (_get_vault_secret from mig 060) — we
-- don't duplicate it, just call it. It returns the project_functions_url
-- and service_role_key the same way.
--
-- The Edge Function (send-notification-email) does its own filtering:
--   - Only emails for SUPPORTED_TYPES (booking_confirmed, booking_cancelled,
--     trip_cancelled, trip_reminder). Other types are skipped silently
--     with a 200 OK { skipped: 'unsupported_type' }.
--   - Honours profiles.notif_email preference (returns skipped:'user_opted_out')
--
-- So this trigger doesn't need to gate by type or check notif_email — it
-- just hands every notification to the function and the function decides.
-- This means adding new email types later requires NO migration changes —
-- just update the Edge Function's switch statement and redeploy.
--
-- BUT — we still do the notif_push preference check at the trigger level,
-- mirroring migration 065's defense-in-depth pattern. Reasoning: if a
-- user disabled in-app notifications entirely (notif_push = false), they
-- shouldn't get emails for those notifications either. Migration 065
-- prevents the row from being inserted in most cases (mig 064 message
-- trigger checks it, apiClient interceptor checks it), but for paths
-- that bypass those gates we don't want email to leak through.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. The trigger function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notifications_send_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, extensions
AS $$
DECLARE
  v_url            TEXT;
  v_key            TEXT;
  v_payload        JSONB;
  v_title          TEXT;
  v_body           TEXT;
  v_recipient_push BOOLEAN;
BEGIN
  -- ─── Defense-in-depth preference gate ────────────────────────────────
  -- Same logic as migration 065's push trigger update. If the user
  -- disabled in-app notifications entirely, don't send them email
  -- either. NULL = on by default (matches toggle UI default state).
  BEGIN
    SELECT notif_push INTO v_recipient_push
      FROM public.profiles
     WHERE email = NEW.user_email
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_recipient_push := NULL;
  END;

  IF v_recipient_push IS FALSE THEN
    RETURN NEW;
  END IF;

  -- The notif_EMAIL preference (the per-channel toggle) is checked
  -- INSIDE the Edge Function, not here. Reason: we want the function
  -- to be the single source of truth for "should this user get an
  -- email" — easier to debug, easier to change without a migration.
  -- ─────────────────────────────────────────────────────────────────────

  -- Load vault secrets (same helper from mig 060).
  v_url := public._get_vault_secret('project_functions_url');
  v_key := public._get_vault_secret('service_role_key');

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'notifications_send_email: vault secrets not configured (project_functions_url or service_role_key missing) — email skipped for notification id=%', NEW.id;
    RETURN NEW;
  END IF;

  -- Same title-mapping logic as push (mig 060) for consistency. The Edge
  -- Function uses its own subject lines per template type, but we pass
  -- the standard title as a fallback for unsupported types and for
  -- debugging.
  v_title := CASE NEW.type
    WHEN 'booking_request'   THEN 'طلب حجز جديد'
    WHEN 'booking_confirmed' THEN 'تم تأكيد حجزك'
    WHEN 'booking_cancelled' THEN 'تم إلغاء الحجز'
    WHEN 'trip_started'      THEN 'انطلقت رحلتك'
    WHEN 'trip_completed'    THEN 'اكتملت الرحلة'
    WHEN 'trip_cancelled'    THEN 'تم إلغاء الرحلة'
    WHEN 'trip_reminder'     THEN 'تذكير: رحلتك بعد ساعة'
    WHEN 'review_received'   THEN 'تقييم جديد'
    WHEN 'new_trip'          THEN 'رحلة جديدة قد تهمك'
    WHEN 'message'           THEN 'رسالة جديدة'
    WHEN 'request_contact'   THEN 'سائق مهتم برحلتك'
    ELSE COALESCE(NULLIF(NEW.title, ''), 'مشوارو')
  END;

  v_body := COALESCE(NEW.message, '');
  IF length(v_body) > 200 THEN
    v_body := substring(v_body FROM 1 FOR 197) || '...';
  END IF;

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

  -- Fire-and-forget. Identical pattern to mig 060's push trigger.
  PERFORM net.http_post(
    url := v_url || '/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := v_payload
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never fail the INSERT — email is best-effort.
    RAISE WARNING 'notifications_send_email failed for id=%: % %', NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_send_email() FROM PUBLIC;

-- ─── 2. Attach the trigger ───────────────────────────────────────────────
-- We use a separate trigger from notifications_send_push so the two fire
-- independently. Postgres invokes AFTER INSERT triggers in name order —
-- 'trg_notifications_send_email' alphabetically comes BEFORE
-- 'trg_notifications_send_push' so email is initiated first, but they're
-- both fire-and-forget HTTP posts so actual order of delivery is
-- determined by network timing, not trigger order. Order doesn't matter
-- for correctness either way.
DROP TRIGGER IF EXISTS trg_notifications_send_email ON public.notifications;
CREATE TRIGGER trg_notifications_send_email
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notifications_send_email();

-- ─── 3. Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn      BOOLEAN;
  v_trigger BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'notifications_send_email'
  ) INTO v_fn;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_notifications_send_email'
       AND tgrelid = 'public.notifications'::regclass
  ) INTO v_trigger;

  IF NOT v_fn THEN
    RAISE EXCEPTION 'MIGRATION 066 FAILED — notifications_send_email function missing';
  END IF;
  IF NOT v_trigger THEN
    RAISE EXCEPTION 'MIGRATION 066 FAILED — trg_notifications_send_email trigger missing';
  END IF;

  RAISE NOTICE 'MIGRATION 066 OK — email trigger installed alongside push trigger';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- POST-MIGRATION SETUP (one-time, after applying this migration)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. Deploy the Edge Function:
--      supabase functions deploy send-notification-email
--
-- 2. Set the RESEND_API_KEY secret for the function:
--      supabase secrets set RESEND_API_KEY=re_your_key_here
--    (Same key you put into Supabase SMTP settings; create a separate
--    one in Resend if you want per-feature usage tracking.)
--
-- 3. Verify by inserting a test notification:
--      INSERT INTO public.notifications (user_email, title, message, type, is_read)
--      VALUES ('your_test_email@gmail.com', 'تم تأكيد حجزك', 'تجربة', 'booking_confirmed', FALSE);
--
--    Then check:
--      - The bell badge updates (in-app)
--      - You get a push (if your device is registered)
--      - You get an EMAIL within ~10 seconds from noreply@mishwaro.com
--      - Resend dashboard → Logs shows the delivery
-- ═══════════════════════════════════════════════════════════════════════
