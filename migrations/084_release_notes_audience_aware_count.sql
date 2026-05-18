-- ═══════════════════════════════════════════════════════════════════════════
-- 084_release_notes_audience_aware_count.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fixes a discovered bug in mig 083's unread_release_notes_count() RPC:
-- it didn't check audience, so users saw a "1 unread" badge that they
-- could never clear because the unread note targeted a different
-- audience (e.g. a passenger seeing a phantom +1 for a 'drivers'-only
-- note they can't see on /whats-new).
--
-- ─── THE BUG ──────────────────────────────────────────────────────────
--
-- The original count function (mig 083):
--
--   SELECT COUNT(*) FROM release_notes rn
--   WHERE rn.published_at <= NOW()
--     AND rn.audience <> 'admins'
--     AND NOT EXISTS (SELECT 1 FROM release_note_reads ... matching user)
--
-- A passenger's WhatsNew page shows 3 notes (audience='all' x3), but
-- this count returns 4 (including the 'drivers'-only note). Even after
-- visiting /whats-new and marking the 3 visible notes as read, the 4th
-- ('drivers') is still unread but never displayed — so the badge sticks.
--
-- ─── THE FIX ──────────────────────────────────────────────────────────
--
-- Match the same audience filtering rules already used by mig 068's
-- broadcast system, so behavior is consistent across the platform:
--
--   audience = 'all'        → everyone sees and counts
--   audience = 'drivers'    → only account_type IN ('driver', 'both')
--   audience = 'passengers' → only account_type IN ('passenger', 'both')
--   audience = 'admins'     → only role = 'admin'
--
-- A 'both' account type is BOTH a driver AND a passenger, so they see
-- both driver-targeted and passenger-targeted entries. Matches mig 068.
--
-- ─── EDGE CASES ───────────────────────────────────────────────────────
--
-- 1. account_type is NULL — treat as 'passenger'. New onboarders before
--    they pick a side still see release notes.
-- 2. role is NULL — treat as 'user'. Same fallback as the rest of the
--    codebase.
-- 3. Profile row missing for v_email — treat as 'passenger' / 'user'.
--    Very rare (deleted account, race during signup), but the function
--    shouldn't crash.

BEGIN;

CREATE OR REPLACE FUNCTION public.unread_release_notes_count()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email        TEXT;
  v_account_type TEXT;
  v_role         TEXT;
  v_count        INTEGER;
BEGIN
  v_email := auth.email();
  IF v_email IS NULL THEN RETURN 0; END IF;

  -- Pull the user's account_type + role with safe fallbacks. LEFT
  -- JOIN-style: if profile row is missing, both stay NULL and the
  -- COALESCE below treats them as ('passenger', 'user').
  SELECT account_type, role
    INTO v_account_type, v_role
    FROM public.profiles
   WHERE email = v_email
   LIMIT 1;

  v_account_type := COALESCE(v_account_type, 'passenger');
  v_role         := COALESCE(v_role, 'user');

  SELECT COUNT(*) INTO v_count
    FROM public.release_notes rn
   WHERE rn.published_at <= NOW()
     AND CASE rn.audience
           WHEN 'all'        THEN TRUE
           WHEN 'drivers'    THEN v_account_type IN ('driver', 'both')
           WHEN 'passengers' THEN v_account_type IN ('passenger', 'both')
           WHEN 'admins'     THEN v_role = 'admin'
           ELSE FALSE
         END
     AND NOT EXISTS (
       SELECT 1 FROM public.release_note_reads rr
        WHERE rr.user_email = v_email
          AND rr.release_note_id = rn.id
     );

  RETURN COALESCE(v_count, 0);
END;
$$;

-- Permissions unchanged from mig 083 — re-grant explicitly so the
-- migration is idempotent (if anyone re-ran the original without this
-- patch, the GRANT remains correct).
REVOKE ALL ON FUNCTION public.unread_release_notes_count() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.unread_release_notes_count() TO authenticated;

COMMIT;

-- ─── VERIFICATION QUERIES (run manually in SQL editor) ────────────────
--
-- Quick sanity check after applying:
--
--   -- As souqnamarketplace@gmail.com (admin):
--   SELECT public.unread_release_notes_count();   -- should match all
--                                                   unread notes
--
--   -- Inspect the audience distribution of current notes:
--   SELECT audience, count(*) FROM public.release_notes GROUP BY audience;
--
--   -- See what's unread for a specific passenger user:
--   SELECT rn.id, rn.title, rn.audience
--     FROM public.release_notes rn
--    WHERE rn.published_at <= NOW()
--      AND rn.audience IN ('all', 'passengers')
--      AND NOT EXISTS (
--        SELECT 1 FROM public.release_note_reads rr
--         WHERE rr.user_email = 'their-email@example.com'
--           AND rr.release_note_id = rn.id
--      );
