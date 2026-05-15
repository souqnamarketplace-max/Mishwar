-- ════════════════════════════════════════════════════════════════════════
-- Migration 051 — Ensure messages table is published for realtime
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- The Navbar (desktop) and MobileLayout (bottom tabs) now both depend
-- on Supabase realtime events from the messages table to drive the
-- unread-count badge. Without the messages table being part of the
-- supabase_realtime publication, INSERT/UPDATE events never reach the
-- client, and the badge would only update on the 15-second staleTime
-- poll. That's noticeable lag — a user sends a message and the
-- recipient's icon doesn't light up for 15s.
--
-- This migration ensures messages is published. Idempotent (the IF
-- EXISTS check + safe ALTER pattern means re-running is a no-op).
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_published BOOLEAN;
BEGIN
  -- Check current state: is `messages` already in supabase_realtime?
  SELECT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'messages'
  ) INTO v_published;

  IF v_published THEN
    RAISE NOTICE '✓ messages is already published for realtime — no-op';
  ELSE
    -- Add it. ALTER PUBLICATION ADD TABLE is the canonical way.
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    RAISE NOTICE '✓ Added public.messages to supabase_realtime publication';
  END IF;
END $$;

-- REPLICA IDENTITY FULL — required for postgres_changes to send the
-- full OLD row on UPDATE/DELETE events. Without it, the realtime
-- payload's `old` field is empty and we can't tell what changed.
-- For unread-count we only INSERT and UPDATE is_read, both of which
-- work with DEFAULT identity, but FULL is safer for future code that
-- might want to react to specific field changes.
DO $$
BEGIN
  -- pg_class.relreplident values: 'd' = default, 'f' = full, 'i' = index, 'n' = nothing
  IF (SELECT relreplident FROM pg_class
       WHERE oid = 'public.messages'::regclass) <> 'f' THEN
    ALTER TABLE public.messages REPLICA IDENTITY FULL;
    RAISE NOTICE '✓ Set REPLICA IDENTITY FULL on public.messages';
  ELSE
    RAISE NOTICE '✓ public.messages already has REPLICA IDENTITY FULL — no-op';
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'MIGRATION 051 OK — messages realtime publication verified';
END $$;
