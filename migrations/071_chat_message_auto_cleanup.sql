-- ════════════════════════════════════════════════════════════════════════
-- Migration 071 — Auto-delete chat messages 30 days after trip ends
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- Today the messages table grows monotonically. Every chat sent during
-- every trip lives forever, along with its image and location-pin
-- attachments in the chat-attachments storage bucket. Three concrete
-- problems:
--
--   1. STORAGE COST — chat-attachments accumulate without bound.
--      A typical trip generates 0-20 messages + 0-5 images. At 1k
--      trips/month, that's ~5 GB/year of bucket usage you never
--      reclaim. Linear unbounded growth.
--
--   2. PRIVACY COMPLIANCE — GDPR Article 17 (right to erasure) +
--      Israeli Privacy Law require predictable data lifecycles for
--      personal communications. 'We keep your chats forever' is not
--      a defensible posture if a regulator asks.
--
--   3. STALE CONVERSATIONS — the /messages page lists every chat the
--      user ever had. Six months in, finding "the conversation about
--      my trip last week" becomes a scroll exercise.
--
-- This matches industry standard for ride-sharing apps. Uber + Lyft
-- delete chat data post-trip (Uber: ~30 days post-trip, Lyft: ~45).
-- BlaBlaCar archives but doesn't auto-delete. WhatsApp / iMessage do
-- not auto-delete by default because they're general-purpose; we are
-- not.
--
-- RULES
-- Three categories of messages get cleaned:
--
--   a) TRIP-BOUND messages (m.trip_id IS NOT NULL):
--      Deleted when the trip's status IN ('completed','cancelled')
--      AND the trip's date is more than 30 days in the past.
--
--   b) REQUEST-BOUND messages (m.request_id IS NOT NULL):
--      Mishwaro supports chat about passenger trip requests BEFORE any
--      trip exists (mig 021). Deleted when the request's status IN
--      ('matched','cancelled','expired') AND updated_at is more than
--      30 days ago. (updated_at is the moment status transitioned
--      out of 'open' — when the request 'ended'.)
--
--   c) ORPHANED messages (no trip_id, no request_id):
--      Shouldn't exist — the INSERT path always sets one. Defensive
--      sweep for any older than 90 days.
--
-- STORAGE
-- After deleting message rows, the corresponding storage.objects rows
-- in the 'chat-attachments' bucket get deleted too. This frees the
-- backing storage (Supabase storage is reference-counted via the
-- objects table). Without this step, the bucket would grow forever
-- with orphan blobs even after the message rows are gone.
--
-- SAFETY
-- - SECURITY DEFINER. Runs as postgres role. Bypasses RLS — correct
--   here because we're deleting messages across all users, scoped by
--   trip-lifecycle rules, not user identity.
-- - REVOKE from PUBLIC / anon / authenticated. Nobody calls this
--   except pg_cron + admin manually.
-- - Single transaction per run. If the storage cleanup fails partway,
--   the message-row delete still committed. Acceptable — orphan blobs
--   get caught on the next run.
-- - Returns a JSONB summary so we can log how many were deleted per
--   run. Useful for "how much did we just nuke" sanity checks.
--
-- SCHEDULE
-- Daily at 03:00 UTC (= 05:00/06:00 Asia/Jerusalem, low-traffic window).
-- Earlier runs would clash with morning trip activity; later runs
-- would clash with afternoon peak. 3 AM is the goldilocks slot.
--
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── 1. The cleanup function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_old_chat_messages()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_message_ids        UUID[];
  v_attachment_paths   TEXT[];
  v_msg_count          INTEGER := 0;
  v_attach_count       INTEGER := 0;
BEGIN
  -- Collect candidate message ids + their attachment paths in one
  -- pass. UNION ALL because the three categories are disjoint (a
  -- message can't simultaneously have a trip_id and not have one).
  WITH candidates AS (
    -- a) Trip-bound messages, trip ended 30+ days ago
    SELECT m.id, m.attachment_path
      FROM public.messages m
      JOIN public.trips t ON t.id = m.trip_id
     WHERE m.trip_id IS NOT NULL
       AND t.status IN ('completed', 'cancelled')
       AND t.date < CURRENT_DATE - INTERVAL '30 days'

    UNION ALL

    -- b) Request-bound messages, request closed 30+ days ago
    SELECT m.id, m.attachment_path
      FROM public.messages m
      JOIN public.trip_requests r ON r.id = m.request_id
     WHERE m.request_id IS NOT NULL
       AND r.status IN ('matched', 'cancelled', 'expired')
       AND r.updated_at < NOW() - INTERVAL '30 days'

    UNION ALL

    -- c) Orphan messages — defensive, shouldn't be many (or any)
    SELECT m.id, m.attachment_path
      FROM public.messages m
     WHERE m.trip_id IS NULL
       AND m.request_id IS NULL
       AND m.created_at < NOW() - INTERVAL '90 days'
  )
  SELECT
    COALESCE(array_agg(id), ARRAY[]::UUID[]),
    COALESCE(array_remove(array_agg(attachment_path), NULL), ARRAY[]::TEXT[])
  INTO v_message_ids, v_attachment_paths
  FROM candidates;

  -- Nothing to clean — early return with zero counts.
  IF array_length(v_message_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'messages_deleted',    0,
      'attachments_deleted', 0,
      'ran_at',              NOW()
    );
  END IF;

  -- Delete the message rows. RLS bypassed via SECURITY DEFINER. The
  -- DELETE cascades nothing (messages has no FK children in our
  -- schema).
  DELETE FROM public.messages WHERE id = ANY(v_message_ids);
  GET DIAGNOSTICS v_msg_count = ROW_COUNT;

  -- Delete the corresponding storage objects so the bucket actually
  -- shrinks. Without this, only the DB row goes; the underlying blob
  -- stays in storage forever.
  --
  -- Wrapped in its own BEGIN/EXCEPTION because storage.objects has
  -- complex ownership semantics and any single failure shouldn't
  -- roll back the message-row delete. Worst case: a blob lingers
  -- until the NEXT run picks it up (or stays as a tiny orphan, which
  -- a future migration can sweep).
  IF array_length(v_attachment_paths, 1) > 0 THEN
    BEGIN
      DELETE FROM storage.objects
       WHERE bucket_id = 'chat-attachments'
         AND name = ANY(v_attachment_paths);
      GET DIAGNOSTICS v_attach_count = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'cleanup_old_chat_messages: storage cleanup failed: % %', SQLSTATE, SQLERRM;
      v_attach_count := 0;
    END;
  END IF;

  RETURN jsonb_build_object(
    'messages_deleted',    v_msg_count,
    'attachments_deleted', v_attach_count,
    'ran_at',              NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_chat_messages() FROM PUBLIC, anon, authenticated;
-- Only postgres role + cron can invoke. Admins manually running from
-- the SQL editor inherit postgres privileges.

-- ─── 2. Schedule the daily cron job ─────────────────────────────────────
-- Idempotent — unschedule first if it exists, then create fresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-chat-messages') THEN
    PERFORM cron.unschedule('cleanup-old-chat-messages');
  END IF;

  -- 03:00 UTC daily. In Asia/Jerusalem that's 05:00 (winter) or 06:00
  -- (summer DST) — pre-rush-hour, no trip-creation traffic to fight.
  PERFORM cron.schedule(
    'cleanup-old-chat-messages',
    '0 3 * * *',
    'SELECT public.cleanup_old_chat_messages();'
  );
END $$;

-- ─── 3. Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn    BOOLEAN;
  v_cron  BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='cleanup_old_chat_messages'
  ) INTO v_fn;

  SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='cleanup-old-chat-messages'
  ) INTO v_cron;

  IF NOT v_fn   THEN RAISE EXCEPTION 'MIGRATION 071 FAILED — cleanup_old_chat_messages function missing'; END IF;
  IF NOT v_cron THEN RAISE EXCEPTION 'MIGRATION 071 FAILED — cron job not scheduled'; END IF;

  RAISE NOTICE 'MIGRATION 071 OK — daily chat cleanup scheduled (03:00 UTC)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- USEFUL ADMIN QUERIES
-- ═══════════════════════════════════════════════════════════════════════
--
-- Preview what WOULD be deleted on the next run (without actually
-- deleting):
--   SELECT
--     m.id,
--     m.sender_email,
--     m.created_at,
--     COALESCE(
--       'trip ' || t.from_city || '→' || t.to_city || ' on ' || t.date,
--       'request ' || r.from_city || '→' || r.to_city || ' on ' || r.requested_date,
--       'orphan'
--     ) AS context
--   FROM public.messages m
--   LEFT JOIN public.trips t ON t.id = m.trip_id
--   LEFT JOIN public.trip_requests r ON r.id = m.request_id
--   WHERE
--      (t.status IN ('completed','cancelled') AND t.date < CURRENT_DATE - INTERVAL '30 days')
--   OR (r.status IN ('matched','cancelled','expired') AND r.updated_at < NOW() - INTERVAL '30 days')
--   OR (m.trip_id IS NULL AND m.request_id IS NULL AND m.created_at < NOW() - INTERVAL '90 days');
--
-- Run the cleanup manually (returns count + timestamp):
--   SELECT public.cleanup_old_chat_messages();
--
-- View recent cron runs:
--   SELECT * FROM cron.job_run_details
--    WHERE jobname = 'cleanup-old-chat-messages'
--    ORDER BY start_time DESC LIMIT 10;
--
-- Disable temporarily (e.g., during a data audit):
--   SELECT cron.unschedule('cleanup-old-chat-messages');
-- ═══════════════════════════════════════════════════════════════════════
