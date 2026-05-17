-- ════════════════════════════════════════════════════════════════════════
-- Migration 065 — Honour notif_push preference at the DB layer
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
-- The apiClient at src/api/apiClient.js:248 drops notification INSERTs
-- whose recipient has profiles.notif_push = false. That works for any
-- notification produced by user-facing code paths going through
-- api.entities.Notification.create(). But several notifications are
-- produced DIRECTLY by Postgres triggers — bypassing the apiClient
-- entirely:
--
--   - Migration 064's `messages_emit_notification` — fires on every
--     message INSERT, creates a notification row for the receiver.
--   - Migration 028's matching-route trigger.
--   - Migration 045's review reminder logic.
--   - Any future trigger that wants to notify a user.
--
-- A user who toggled "الإشعارات داخل التطبيق" OFF in settings expects
-- NO notifications anywhere — bell, toast, push. Today they still get
-- all three for new messages because migration 064's trigger inserts
-- the row without consulting their preference.
--
-- WHAT THIS MIGRATION DOES
--
-- (1) Update messages_emit_notification (originally from migration 064)
--     to check `profiles.notif_push` for the receiver. If FALSE, the
--     function returns early WITHOUT creating the notification row.
--     This drops bell, toast, and push all at once — same effect as
--     the apiClient interceptor.
--
-- (2) Update notifications_send_push (originally from migration 060)
--     with a belt-and-suspenders check on the same preference. If
--     somehow a notification row was created despite the preference
--     (e.g. via service-role admin tooling or a future trigger that
--     forgets the check), the push trigger STILL skips delivery.
--     The bell badge would tick up, but no push banner reaches the
--     phone.
--
-- DESIGN — WHY TWO CHECKS, NOT ONE
--
-- The defense-in-depth pattern matters because:
--   - The first check (mig 064 trigger) is the "primary gate"; it
--     drops the row entirely so NO surface fires.
--   - The second check (mig 060 trigger) handles edge cases where a
--     non-064-path created the row anyway. Push is the most invasive
--     surface (lock-screen banner on a quiet device), so we never
--     let it fire for a user who said no.
--
-- DESIGN — WHY NULL IS TREATED AS TRUE
--
-- profiles.notif_push has no NOT NULL constraint. A NULL value means
-- "preference not set yet" (e.g. user signed up but hasn't visited
-- /account/notifications). We treat NULL as TRUE (= notifications on).
-- The toggle UI in NotificationPrefsSection mirrors this: the default
-- state for new users is ON. Only an explicit FALSE blocks delivery.
--
-- DESIGN — WHY profiles LOOKUP, NOT auth.users
--
-- profiles.email is the join key everywhere else in the schema. Looking
-- up by email is O(1) thanks to the unique index on profiles(email).
-- We avoid joining through auth.users to keep the lookup cheap and the
-- function's permission surface minimal (it already has profile-read
-- via SECURITY DEFINER + search_path = public).
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. Update messages_emit_notification (mig 064 origin) ─────────────
CREATE OR REPLACE FUNCTION public.messages_emit_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_sender_display TEXT;
  v_body           TEXT;
  v_link           TEXT;
  v_recipient_push BOOLEAN;
BEGIN
  -- Defensive: don't notify self.
  IF NEW.sender_email = NEW.receiver_email THEN
    RETURN NEW;
  END IF;

  -- Defensive: receiver might be NULL on a malformed insert.
  IF NEW.receiver_email IS NULL OR NEW.receiver_email = '' THEN
    RETURN NEW;
  END IF;

  -- ─── PREFERENCE GATE (added in migration 065) ─────────────────────
  -- Check whether the receiver has opted out of in-app notifications.
  -- profiles.notif_push = FALSE → drop the notification entirely (no
  -- bell row created, no push sent). NULL or TRUE → proceed.
  -- Profile lookup failure (missing row, network issue) lets us fall
  -- through and create the notification — same fail-open behaviour as
  -- the apiClient interceptor in src/api/apiClient.js (line 233+),
  -- which prefers over-notification to silent under-notification
  -- when preferences can't be confirmed.
  BEGIN
    SELECT notif_push INTO v_recipient_push
      FROM public.profiles
     WHERE email = NEW.receiver_email
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_recipient_push := NULL;
  END;

  IF v_recipient_push IS FALSE THEN
    RETURN NEW;   -- recipient opted out; message INSERT still proceeds
  END IF;
  -- ──────────────────────────────────────────────────────────────────

  v_sender_display := COALESCE(NULLIF(NEW.sender_name, ''),
                               split_part(NEW.sender_email, '@', 1));

  v_body := v_sender_display || ': ' || COALESCE(NEW.content, '');
  IF length(v_body) > 200 THEN
    v_body := substring(v_body FROM 1 FOR 197) || '...';
  END IF;

  v_link := '/messages?to=' || NEW.sender_email;
  IF NEW.trip_id IS NOT NULL THEN
    v_link := v_link || '&trip=' || NEW.trip_id::text;
  ELSIF NEW.request_id IS NOT NULL THEN
    v_link := v_link || '&request=' || NEW.request_id::text;
  END IF;

  INSERT INTO public.notifications (
    user_email,
    title,
    message,
    type,
    trip_id,
    link,
    is_read,
    created_by
  ) VALUES (
    NEW.receiver_email,
    'رسالة جديدة من ' || v_sender_display,
    v_body,
    'message',
    NEW.trip_id,
    v_link,
    FALSE,
    NEW.sender_email
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'messages_emit_notification failed for msg=%: % %', NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_emit_notification() FROM PUBLIC;

-- ─── 2. Update notifications_send_push (mig 060 origin) ────────────────
-- Belt-and-suspenders check. The push trigger fires AFTER INSERT on the
-- notifications table; by the time we get here, the row already exists
-- (so the bell would update). What we control at this point is the
-- FCM/APNS delivery — the most invasive surface, the one we most need
-- to honour the user's opt-out for.
--
-- IMPORTANT: this is a full replacement of the function body. To avoid
-- drift, we replicate the original logic (from migration 060) and add
-- the preference check at the top. The vault-secret loader, payload
-- builder, and pg_net call are byte-identical to migration 060.

CREATE OR REPLACE FUNCTION public.notifications_send_push()
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
  -- ─── PREFERENCE GATE (added in migration 065) ─────────────────────
  -- Skip push delivery if recipient opted out, even if a notification
  -- row was created (e.g. by a code path that didn't run the apiClient
  -- interceptor or migration 064's preference check). The notification
  -- still exists in the bell — only the lock-screen / banner is
  -- suppressed.
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
  -- ──────────────────────────────────────────────────────────────────

  -- Load vault secrets. If either is missing, log + skip.
  v_url := public._get_vault_secret('project_functions_url');
  v_key := public._get_vault_secret('service_role_key');

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'notifications_send_push: vault secrets not configured (project_functions_url or service_role_key missing) — push skipped for notification id=%', NEW.id;
    RETURN NEW;
  END IF;

  -- Title mapping (mirrors migration 060). Type-aware Arabic titles.
  v_title := CASE NEW.type
    WHEN 'booking_request'   THEN 'طلب حجز جديد'
    WHEN 'booking_confirmed' THEN 'تم تأكيد حجزك'
    WHEN 'booking_cancelled' THEN 'تم إلغاء الحجز'
    WHEN 'trip_started'      THEN 'انطلقت رحلتك'
    WHEN 'trip_completed'    THEN 'اكتملت الرحلة'
    WHEN 'trip_cancelled'    THEN 'تم إلغاء الرحلة'
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
    RAISE WARNING 'notifications_send_push failed for id=%: % %', NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_send_push() FROM PUBLIC;

-- ─── 3. Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_msg_fn   BOOLEAN;
  v_push_fn  BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'messages_emit_notification'
  ) INTO v_msg_fn;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'notifications_send_push'
  ) INTO v_push_fn;

  IF NOT v_msg_fn THEN
    RAISE EXCEPTION 'MIGRATION 065 FAILED: messages_emit_notification missing';
  END IF;
  IF NOT v_push_fn THEN
    RAISE EXCEPTION 'MIGRATION 065 FAILED: notifications_send_push missing';
  END IF;

  RAISE NOTICE 'MIGRATION 065 OK — notif_push preference enforced at DB layer (defense-in-depth: mig 064 + mig 060 triggers)';
END $$;
