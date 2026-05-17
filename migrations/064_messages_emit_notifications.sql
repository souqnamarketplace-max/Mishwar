-- ════════════════════════════════════════════════════════════════════════
-- Migration 064 — Messages emit notifications (push for new chat messages)
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
-- The chat infrastructure has been complete since migration 051 (realtime
-- publication on public.messages), but new messages only reach the
-- recipient when their app is open and the realtime subscription is
-- active. If the app is backgrounded or killed, messages sit silently
-- in the database and the recipient finds them only when they happen
-- to open the app. This is the gap between "chat works" and "chat
-- works like a real messaging app."
--
-- HOW THIS WORKS
-- We compose with the existing push pipeline rather than building a
-- second one:
--
--   INSERT INTO messages
--     │
--     ▼ this trigger
--   INSERT INTO notifications (type='message', user_email=receiver,
--                              message='Sender: preview', link='/messages?to=...')
--     │
--     ▼ trg_notifications_send_push (migration 060)
--   pg_net POST → send-push-notification edge function
--     │
--     ▼
--   FCM HTTP v1 → APNS / FCM → device shows the banner
--     │
--     ▼ user taps
--   Capacitor handler reads data.link → React Router → /messages?to=...
--
-- Reuses every piece of infrastructure already built. The push title
-- 'رسالة جديدة' comes from migration 060's CASE on NEW.type so we
-- don't need to set it here.
--
-- DESIGN CHOICES
--
-- 1) ONE TRIGGER, NOT TWO
--    Considered separate triggers for text/image/location to vary the
--    body format. Rejected — content already encodes the type-specific
--    fallback ('📷 صورة', '📍 موقع') at the application layer, so a
--    single trigger handles all three message types uniformly.
--
-- 2) NO FOREGROUND-AWARENESS
--    Considered checking whether the receiver has the conversation
--    open and skipping the push. Rejected — the DB has no signal for
--    'app is in foreground.' iOS suppresses foreground notifications
--    by default; Capacitor's push plugin obeys that. The recipient
--    viewing the chat already sees new messages via the realtime
--    subscription. Belt + suspenders: realtime for in-app, push for
--    everything else.
--
-- 3) NO BATCHING OR COALESCING
--    Five rapid messages = five notifications. Mobile OSes coalesce
--    same-app notifications visually, and a chat-app delivering five
--    separate badges (one per message) is the expected behavior.
--    Coalescing would need a debounce table and timer infrastructure;
--    not worth the complexity at this stage.
--
-- 4) BODY FORMAT
--    'Sender Name: content preview' — what every chat app uses.
--    Truncated to 200 chars in the body builder (FCM/APNS limit ~4KB,
--    but most lock-screen banners render only ~80-100 chars anyway).
--
-- 5) LINK FORMAT
--    Reuses the chat URL contract Messages.jsx already handles:
--      /messages?to=<sender>&trip=<id>      (trip context)
--      /messages?to=<sender>&request=<id>   (request context)
--      /messages?to=<sender>                (no context)
--    The receiver lands in the exact thread they need to reply to.
--    We omit the optional &name=... because the chat page will fetch
--    profilesByEmail anyway — same display name, one fewer URL param,
--    no encoding edge cases.
--
-- 6) BLOCK / DELETED-ACCOUNT GUARDS
--    Not duplicated here. The RLS policy on messages already prevents
--    blocked parties from INSERTing across the block, AND the client
--    refuses to insert into a conversation with a deleted-account
--    peer. If a message row exists, it means the producer was
--    allowed to send it, which is the same authoritative gate we'd
--    apply to notifications.
--
-- 7) FAILURE SEMANTICS
--    EXCEPTION → RAISE WARNING + RETURN NEW. The message INSERT must
--    succeed even if the notification system breaks (vault missing,
--    pg_net down, etc.). Same contract as the existing
--    notifications_send_push trigger.
--
-- ════════════════════════════════════════════════════════════════════════

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
BEGIN
  -- Defensive: don't notify self (theoretical UPSERT path).
  IF NEW.sender_email = NEW.receiver_email THEN
    RETURN NEW;
  END IF;

  -- Defensive: receiver might be NULL on a malformed insert. Bail
  -- silently — the message row stays in place, but no push fires.
  IF NEW.receiver_email IS NULL OR NEW.receiver_email = '' THEN
    RETURN NEW;
  END IF;

  -- Sender display name. Prefer the sender_name column (the producer
  -- sets it to the profile's full_name); fall back to the email's
  -- local part so the body always has something to prefix.
  v_sender_display := COALESCE(NULLIF(NEW.sender_name, ''),
                               split_part(NEW.sender_email, '@', 1));

  -- Body preview. Format: '{sender}: {content}'. Content already
  -- carries the readable fallback for image/location messages
  -- ('📷 صورة', '📍 موقع') so this works uniformly across types.
  -- The downstream push trigger (migration 060) re-truncates to 200
  -- chars; we cap here too for the in-app notification list which
  -- reads notifications.message directly.
  v_body := v_sender_display || ': ' || COALESCE(NEW.content, '');
  IF length(v_body) > 200 THEN
    v_body := substring(v_body FROM 1 FOR 197) || '...';
  END IF;

  -- Deep link. Build the chat URL with the appropriate context param.
  -- The Messages.jsx auto-open effect reads to/trip/request and lands
  -- the user in the right thread. Trip and request are mutually
  -- exclusive at the message row level (CHECK constraint elsewhere
  -- ensures only one of them is set per message), so this if/elif
  -- never produces ambiguous URLs.
  v_link := '/messages?to=' || NEW.sender_email;
  IF NEW.trip_id IS NOT NULL THEN
    v_link := v_link || '&trip=' || NEW.trip_id::text;
  ELSIF NEW.request_id IS NOT NULL THEN
    v_link := v_link || '&request=' || NEW.request_id::text;
  END IF;

  -- Insert the notification. The migration 060 trigger picks this up
  -- AFTER INSERT and fires the FCM push. We set both title and message
  -- because:
  --   - title is rendered by NotificationBell (in-app list); we want
  --     'رسالة جديدة من أحمد' there
  --   - message is the push body (per migration 060), and also the
  --     in-app preview line under the title
  --   - type='message' triggers migration 060's title mapping for
  --     the PUSH banner ('رسالة جديدة'); the in-app notification
  --     uses our richer title from this row
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
    -- Never fail the message INSERT — push delivery is a courtesy on
    -- top of realtime delivery, which already works without this
    -- trigger. Log and continue. Same contract as notifications_send_push.
    RAISE WARNING 'messages_emit_notification failed for msg=%: % %', NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_emit_notification() FROM PUBLIC;
-- Trigger functions don't need EXECUTE grants — they run as SECURITY
-- DEFINER under the table owner's privileges when PostgreSQL fires them.

DROP TRIGGER IF EXISTS trg_messages_emit_notification ON public.messages;
CREATE TRIGGER trg_messages_emit_notification
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_emit_notification();

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_trigger_ok BOOLEAN;
  v_func_ok    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_messages_emit_notification'
      AND NOT tgisinternal
  ) INTO v_trigger_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'messages_emit_notification'
  ) INTO v_func_ok;

  IF NOT v_trigger_ok THEN
    RAISE EXCEPTION 'MIGRATION 064 FAILED: trigger not installed';
  END IF;
  IF NOT v_func_ok THEN
    RAISE EXCEPTION 'MIGRATION 064 FAILED: function not installed';
  END IF;

  RAISE NOTICE 'MIGRATION 064 OK — messages emit notifications (push pipeline complete)';
END $$;
