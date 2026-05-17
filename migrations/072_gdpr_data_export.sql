-- ════════════════════════════════════════════════════════════════════════
-- Migration 072 — GDPR Article 20 data-portability RPC
-- ════════════════════════════════════════════════════════════════════════
--
-- LEGAL CONTEXT
-- GDPR Article 20: "The data subject shall have the right to receive
-- the personal data concerning him or her, which he or she has
-- provided to a controller, in a structured, commonly used and
-- machine-readable format and have the right to transmit those data
-- to another controller without hindrance from the controller to
-- which the personal data have been provided."
--
-- In practice this means: any user can demand a JSON dump of their
-- account data. We're shipping that as a button in /account so it's
-- always available without a support ticket.
--
-- WHAT'S INCLUDED
--   1. Profile           — the user's own profile row (PII)
--   2. Trips as driver   — every trip the user posted
--   3. Bookings          — every seat the user booked as a passenger
--   4. Trip requests     — passenger-side "I want a ride from X→Y" posts
--   5. Messages sent     — chats the user originated
--   6. Messages received — chats addressed to the user (necessary
--                          to give the user full visibility into
--                          conversations they were part of)
--   7. Reviews given     — reviews the user wrote
--   8. Reviews received  — reviews about the user (with reviewer names
--                          since reviews are visible to the public anyway)
--   9. Reports filed     — content reports the user submitted
--  10. Trip preferences  — the user's saved route watchlist
--  11. Notifications     — the user's inbox (last 500, to keep the
--                          export under a reasonable size)
--  12. Device tokens     — push registration entries (per-device, with
--                          only the public-facing fields; the actual
--                          FCM/APNS token strings are NOT exported as
--                          they're security-sensitive)
--
-- WHAT'S DEFERRED / EXCLUDED
--   - Reports filed AGAINST the user — under GDPR Art. 14 the
--     reporter's identity is exempt from disclosure when revealing
--     it would prejudice ongoing moderation. We return a COUNT only,
--     and direct the user to support if they need more.
--   - Admin audit log entries about the user — same reasoning.
--   - Activity logs — internal operations, no PII the user provided.
--   - Driver subscriptions — these have payment refs that are sensitive
--     and live in a separate compliance flow.
--
-- RATE LIMITING
-- Generating the export is moderately expensive (8+ tables joined per
-- call). We rate-limit to ONE export per user per HOUR. Tracked in
-- the new public.data_export_log table — also serves as the GDPR
-- audit trail required by Art. 30 (record of processing activities).
--
-- SECURITY
--   - SECURITY DEFINER → bypasses RLS to gather data across tables.
--     Scoped to auth.email() so user can only ever export their own.
--   - Returns JSONB (not text) so the client doesn't have to parse.
--   - REVOKE from public/anon so only authenticated users can call.
--
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Export audit log + rate-limit table ────────────────────────────
CREATE TABLE IF NOT EXISTS public.data_export_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hint    TEXT,                    -- optional, for support investigation
  bytes      INTEGER,                 -- size of payload for capacity planning
  CONSTRAINT data_export_log_user_email_fk
    FOREIGN KEY (user_email) REFERENCES public.profiles(email) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_export_log_user_time
  ON public.data_export_log(user_email, exported_at DESC);

ALTER TABLE public.data_export_log ENABLE ROW LEVEL SECURITY;

-- Users can see their own export history (so they know when they
-- last downloaded). Useful for audit trail under Art. 15 ("right
-- of access" — separate from Art. 20 portability but related).
DROP POLICY IF EXISTS data_export_log_select_own ON public.data_export_log;
CREATE POLICY data_export_log_select_own ON public.data_export_log
  FOR SELECT TO authenticated
  USING (user_email = auth.email());

-- No INSERT/UPDATE/DELETE policy → only the RPC (SECURITY DEFINER)
-- can write. Prevents users from spoofing audit entries.

-- Admin can see all entries for compliance reporting.
DROP POLICY IF EXISTS data_export_log_admin_all ON public.data_export_log;
CREATE POLICY data_export_log_admin_all ON public.data_export_log
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.email = auth.email() AND p.role = 'admin'
    )
  );


-- ─── 2. The export RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_email          TEXT;
  v_recent_export  TIMESTAMPTZ;
  v_result         JSONB;
  v_bytes          INTEGER;
BEGIN
  v_email := auth.email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Rate limit: 1 export per hour per user. Returns the existing
  -- timestamp so the client can show "next available at..."
  SELECT MAX(exported_at) INTO v_recent_export
    FROM public.data_export_log
   WHERE user_email = v_email
     AND exported_at > NOW() - INTERVAL '1 hour';

  IF v_recent_export IS NOT NULL THEN
    RAISE EXCEPTION 'rate_limited: next allowed at %', v_recent_export + INTERVAL '1 hour'
      USING ERRCODE = 'P0001';
  END IF;

  -- Build the export. One pass per table. row_to_json on each row
  -- and array_agg to collect into the JSON arrays. COALESCE to empty
  -- array so missing data doesn't poison the structure.
  v_result := jsonb_build_object(
    'export_metadata', jsonb_build_object(
      'exported_at',    NOW(),
      'user_email',     v_email,
      'gdpr_article',   '20 (Right to data portability)',
      'format_version', '1',
      'app',            'Mishwaro',
      'note',           'This export contains all personal data Mishwaro holds about you that you have provided or generated through use of the app. To exercise the right to erasure (Article 17), use Delete Account in the app settings.'
    ),

    -- 1. Profile (own row)
    'profile', (
      SELECT to_jsonb(p) - 'access_key'  -- strip the internal access key
        FROM public.profiles p
       WHERE p.email = v_email
    ),

    -- 2. Trips as driver
    'trips_as_driver', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date DESC)
        FROM public.trips t
       WHERE t.driver_email = v_email
    ), '[]'::JSONB),

    -- 3. Bookings as passenger
    'bookings_as_passenger', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC)
        FROM public.bookings b
       WHERE b.passenger_email = v_email
    ), '[]'::JSONB),

    -- 4. Trip requests (passenger-side posts)
    'trip_requests', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
        FROM public.trip_requests r
       WHERE r.passenger_email = v_email
    ), '[]'::JSONB),

    -- 5. Messages SENT
    'messages_sent', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC)
        FROM public.messages m
       WHERE m.sender_email = v_email
    ), '[]'::JSONB),

    -- 6. Messages RECEIVED
    'messages_received', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC)
        FROM public.messages m
       WHERE m.receiver_email = v_email
    ), '[]'::JSONB),

    -- 7. Reviews GIVEN
    'reviews_given', COALESCE((
      SELECT jsonb_agg(to_jsonb(rv) ORDER BY rv.created_at DESC)
        FROM public.reviews rv
       WHERE rv.reviewer_email = v_email
    ), '[]'::JSONB),

    -- 8. Reviews RECEIVED
    'reviews_received', COALESCE((
      SELECT jsonb_agg(to_jsonb(rv) ORDER BY rv.created_at DESC)
        FROM public.reviews rv
       WHERE rv.reviewee_email = v_email
    ), '[]'::JSONB),

    -- 9. Reports FILED by user
    'reports_filed', COALESCE((
      SELECT jsonb_agg(to_jsonb(ur) ORDER BY ur.created_at DESC)
        FROM public.user_reports ur
       WHERE ur.reporter_email = v_email
    ), '[]'::JSONB),

    -- 10. Trip preferences
    'trip_preferences', COALESCE((
      SELECT jsonb_agg(to_jsonb(tp) ORDER BY tp.created_at DESC)
        FROM public.trip_preferences tp
       WHERE tp.user_email = v_email
    ), '[]'::JSONB),

    -- 11. Notifications inbox (last 500 to keep size sane)
    'notifications', COALESCE((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC)
        FROM (
          SELECT * FROM public.notifications
           WHERE user_email = v_email
           ORDER BY created_at DESC
           LIMIT 500
        ) n
    ), '[]'::JSONB),

    -- 12. Device tokens (without the actual token strings — those are
    --     cryptographic material used to deliver push notifications
    --     and don't constitute "personal data" the user provided)
    --
    --     NOTE: column is last_seen_at, not last_used_at. The naming
    --     here is the historical migration-059 choice (the column
    --     gets updated every app open, which the original author
    --     thought of as "we last saw this device" rather than "user
    --     last used it"). The exported JSON key reads more naturally
    --     as 'last_seen_at' for the recipient, so we don't rename
    --     it in the output either.
    'device_tokens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',          dt.id,
        'platform',    dt.platform,
        'device_id',   dt.device_id,
        'created_at',  dt.created_at,
        'last_seen_at', dt.last_seen_at
      ) ORDER BY dt.last_seen_at DESC NULLS LAST)
        FROM public.device_tokens dt
       WHERE dt.user_email = v_email
    ), '[]'::JSONB),

    -- Counts only for things we can't fully include
    'counts', jsonb_build_object(
      'reports_filed_against_you',
        COALESCE((SELECT COUNT(*) FROM public.user_reports WHERE reported_email = v_email), 0)
    ),

    -- Footer with support contact
    'note_unincluded', 'Some categories are excluded for legal reasons (third-party privacy): reports filed against you (see counts), admin notes, and internal audit logs. To request access to these under GDPR Article 15, contact privacy@mishwar.ps with a copy of this export.'
  );

  -- Log the export. Track byte size for capacity planning.
  v_bytes := length(v_result::TEXT);
  INSERT INTO public.data_export_log (user_email, bytes)
       VALUES (v_email, v_bytes);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.export_my_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;

COMMIT;

-- ─── Verification ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn    BOOLEAN;
  v_tbl   BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='export_my_data'
  ) INTO v_fn;

  SELECT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='data_export_log'
  ) INTO v_tbl;

  IF NOT v_fn  THEN RAISE EXCEPTION 'MIGRATION 072 FAILED — export_my_data function missing'; END IF;
  IF NOT v_tbl THEN RAISE EXCEPTION 'MIGRATION 072 FAILED — data_export_log table missing'; END IF;

  RAISE NOTICE 'MIGRATION 072 OK — GDPR Art. 20 export RPC in place';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- TEST USAGE
-- ═══════════════════════════════════════════════════════════════════════
--
-- As a user, from the SQL editor (set Role: authenticated, JWT for
-- a real user):
--   SELECT public.export_my_data();
--
-- First call returns the full JSONB.
-- Second call within an hour returns: 'rate_limited: next allowed at ...'
--
-- Admin can see all export activity:
--   SELECT user_email, exported_at, bytes
--     FROM public.data_export_log
--    ORDER BY exported_at DESC LIMIT 50;
--
-- Stats:
--   SELECT date_trunc('day', exported_at) AS day,
--          COUNT(*) AS exports,
--          AVG(bytes)::int AS avg_bytes
--     FROM public.data_export_log
--    GROUP BY 1 ORDER BY 1 DESC;
-- ═══════════════════════════════════════════════════════════════════════
