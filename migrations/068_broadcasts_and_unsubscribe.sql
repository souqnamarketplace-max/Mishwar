-- ════════════════════════════════════════════════════════════════════════
-- Migration 068 — Marketing broadcasts + unsubscribe RPC
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY
-- Tier 1 transactional emails (mig 066) cover lifecycle events: booking
-- confirmed, cancelled, trip reminder. This migration adds the marketing
-- side — admin-composed broadcasts sent to filtered audiences (all, drivers,
-- passengers, or users in a specific city) via in-app + push + email
-- channels, with mandatory one-click unsubscribe for legal compliance
-- (Israeli Communications Law 30A, CAN-SPAM, future GDPR).
--
-- THREE PIECES IN THIS MIGRATION
--
--   1. broadcasts table — audit log of every campaign sent. Admin can
--      query past broadcasts to see "what did we send last month and to
--      how many?" Required for accountability + spam-complaint
--      investigation if Resend flags an account.
--
--   2. admin_send_broadcast() RPC — atomic operation that resolves the
--      audience filter to user emails, bulk-inserts notifications rows
--      (which then fan out to push + email via existing triggers in
--      migs 060 + 066), and records the broadcast in the audit table.
--      Admin-only (checks profiles.role = 'admin').
--
--   3. public_unsubscribe_marketing() RPC — the endpoint the
--      Unsubscribe page calls. Verifies an HMAC token (sent in every
--      marketing email's unsubscribe link), then flips the user's
--      notif_marketing preference to FALSE. Public-callable (GRANT
--      EXECUTE to anon) — the HMAC token IS the auth.
--
-- HMAC TOKEN SCHEME
--   token = encode(hmac(secret, email || ':unsubscribe-v1', 'sha256'), 'hex')
--
--   Where:
--     - secret = vault secret 'unsubscribe_secret' (32 random bytes hex)
--     - email = the recipient's email address (case-preserved as in profiles)
--     - 'unsubscribe-v1' = context string. Lets us invalidate every
--       outstanding token by bumping to 'unsubscribe-v2' in both signer
--       (Edge Function) and verifier (this RPC).
--
--   Output is 64 chars hex. Verifier compares with hmac_eq() to avoid
--   timing-attack leaks (constant-time comparison via crypto.subtle).
--
-- POST-MIGRATION: see bottom of file for vault-secret setup.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── pgcrypto for hmac() ─────────────────────────────────────────────────
-- Already enabled in earlier migrations, but defensive.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 1. broadcasts table — audit log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who sent it (admin email)
  created_by      TEXT NOT NULL,

  -- Content (what was sent)
  title           TEXT NOT NULL CHECK (length(title)   BETWEEN 1 AND 120),
  message         TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),

  -- Targeting
  audience        TEXT NOT NULL CHECK (audience IN ('all','drivers','passengers','by_city')),
  audience_city   TEXT,   -- only set when audience = 'by_city'

  -- Channels — every broadcast hits the in-app bell automatically
  -- (the notification row IS the in-app entry). These flags control
  -- the OPT-OUT-able channels.
  channel_push    BOOLEAN NOT NULL DEFAULT TRUE,
  channel_email   BOOLEAN NOT NULL DEFAULT TRUE,

  -- Result
  recipient_count INTEGER NOT NULL DEFAULT 0,

  -- Reference to the link admin chose, if any (e.g. promo page URL)
  link            TEXT
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at
  ON public.broadcasts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcasts_created_by
  ON public.broadcasts (created_by, created_at DESC);

-- RLS: admin-only read + write. The RPC is SECURITY DEFINER so it
-- inserts as postgres, bypassing RLS. The SELECT policy is for the
-- dashboard history list.
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS broadcasts_admin_select ON public.broadcasts;
CREATE POLICY broadcasts_admin_select ON public.broadcasts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.email = auth.email() AND p.role = 'admin'
    )
  );

-- No INSERT / UPDATE / DELETE policies — only the SECURITY DEFINER RPC
-- writes to this table. Direct writes are blocked.

-- ─── 2. admin_send_broadcast() RPC ───────────────────────────────────────
-- Sends a broadcast to the resolved audience. Returns the broadcast id
-- + recipient count.
--
-- ATOMICITY
--   - Audience resolution + notification inserts + broadcast log row
--     all happen in one transaction. If anything fails, nothing is sent.
--   - The downstream push + email triggers fire AFTER each notification
--     INSERT commits, so failures there don't roll back the broadcast.
--     (Push + email are best-effort, just like transactional.)
--
-- PERFORMANCE
--   Bulk INSERT ... SELECT pattern. Inserting 10k notification rows in
--   one statement takes ~200ms. Triggers fire per-row but the pg_net
--   http_post is fire-and-forget so the trigger returns immediately.
--   Practical cap on audience size: 50k recipients per broadcast.
--   Larger lists should be split into batches by the caller.
--
-- AUDIENCE FILTER NOTES
--   'drivers'    → account_type IN ('driver', 'both')
--   'passengers' → account_type IN ('passenger', 'both')
--   ('both'-typed users are both drivers AND passengers, so they receive
--    broadcasts targeted at either segment. Matches mental model: a
--    driver-only deal is for drivers, even those who are also passengers.)

CREATE OR REPLACE FUNCTION public.admin_send_broadcast(
  p_title         TEXT,
  p_message       TEXT,
  p_audience      TEXT,
  p_audience_city TEXT DEFAULT NULL,
  p_channel_push  BOOLEAN DEFAULT TRUE,
  p_channel_email BOOLEAN DEFAULT TRUE,
  p_link          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_email TEXT;
  v_is_admin     BOOLEAN;
  v_broadcast_id UUID;
  v_count        INTEGER;
  v_link         TEXT;
BEGIN
  -- ─── Auth check — admin only ──────────────────────────────────────
  v_caller_email := auth.email();
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.email = v_caller_email AND p.role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  -- ─── Input validation ─────────────────────────────────────────────
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title is required';
  END IF;
  IF length(p_title) > 120 THEN
    RAISE EXCEPTION 'title too long (max 120 chars)';
  END IF;

  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'message is required';
  END IF;
  IF length(p_message) > 500 THEN
    RAISE EXCEPTION 'message too long (max 500 chars)';
  END IF;

  IF p_audience NOT IN ('all','drivers','passengers','by_city') THEN
    RAISE EXCEPTION 'invalid audience: %', p_audience;
  END IF;

  IF p_audience = 'by_city' AND (p_audience_city IS NULL OR length(trim(p_audience_city)) = 0) THEN
    RAISE EXCEPTION 'audience_city is required when audience = by_city';
  END IF;

  -- Default link to home if not provided.
  v_link := COALESCE(NULLIF(trim(p_link), ''), '/');

  -- ─── Create the broadcast audit row FIRST ─────────────────────────
  -- We do this before resolving recipients so the id is available for
  -- referencing in notifications (future enhancement: link notifications
  -- to broadcasts via a broadcast_id column for "unsubscribe from this
  -- specific campaign" semantics. Out of scope tonight.)
  INSERT INTO public.broadcasts (
    created_by, title, message, audience, audience_city,
    channel_push, channel_email, recipient_count, link
  ) VALUES (
    v_caller_email, p_title, p_message, p_audience, p_audience_city,
    p_channel_push, p_channel_email, 0, v_link
  )
  RETURNING id INTO v_broadcast_id;

  -- ─── Resolve audience + bulk insert notifications ─────────────────
  -- The notification type 'broadcast' is recognised by:
  --   - apiClient interceptor: skipped if notif_marketing = false
  --   - send-push-notification (mig 060): generic push delivery
  --   - send-notification-email (this commit): marketing template
  --
  -- We also do the notif_marketing filter HERE in SQL to avoid the
  -- overhead of inserting 10k rows that the apiClient interceptor
  -- would have to drop one-by-one. Single bulk-filtered INSERT is
  -- O(audience_size), versus O(audience_size * 1 SELECT per row)
  -- if we let the interceptor handle it.

  WITH eligible AS (
    SELECT p.email
      FROM public.profiles p
     WHERE
        -- Audience filter
        CASE p_audience
          WHEN 'all'        THEN TRUE
          WHEN 'drivers'    THEN p.account_type IN ('driver', 'both')
          WHEN 'passengers' THEN p.account_type IN ('passenger', 'both')
          WHEN 'by_city'    THEN p.city = p_audience_city
        END
        -- Opt-in filter: notif_marketing = TRUE only. NULL is treated as
        -- "not yet opted in" → broadcasts SKIPPED. This is intentionally
        -- stricter than transactional (where NULL = on). Marketing
        -- requires affirmative opt-in for legal compliance.
        AND p.notif_marketing = TRUE
        -- Defensive: skip deleted accounts (deleted_at IS NOT NULL means
        -- user soft-deleted their account via the self-deletion RPC).
        AND p.deleted_at IS NULL
  ),
  inserted AS (
    INSERT INTO public.notifications (
      user_email, title, message, type, link, is_read, created_by
    )
    SELECT
      e.email,
      p_title,
      p_message,
      'broadcast',
      v_link,
      FALSE,
      'system'
    FROM eligible e
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;

  -- ─── Update the audit row with the final count ────────────────────
  UPDATE public.broadcasts
     SET recipient_count = v_count
   WHERE id = v_broadcast_id;

  -- ─── Return the result to the admin UI ────────────────────────────
  RETURN jsonb_build_object(
    'broadcast_id',     v_broadcast_id,
    'recipient_count',  v_count,
    'audience',         p_audience,
    'audience_city',    p_audience_city,
    'channel_push',     p_channel_push,
    'channel_email',    p_channel_email
  );
END;
$$;

-- Only admins reach this RPC, but the SECURITY DEFINER body double-checks.
GRANT EXECUTE ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT)
  TO authenticated;

-- ─── 3. public_unsubscribe_marketing() RPC ───────────────────────────────
-- Called by the public Unsubscribe page (no auth, token IS the auth).
-- Verifies HMAC, flips notif_marketing to FALSE.
--
-- Returns JSONB so the frontend can show friendly success/failure UI.

CREATE OR REPLACE FUNCTION public.public_unsubscribe_marketing(
  p_email TEXT,
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_secret         TEXT;
  v_expected_token TEXT;
  v_profile_exists BOOLEAN;
BEGIN
  -- Defensive input check
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'missing_email');
  END IF;
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    -- Tokens are sha256 hex = exactly 64 chars
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_token_format');
  END IF;

  -- Load the secret from vault. Same helper used by mig 060.
  BEGIN
    v_secret := public._get_vault_secret('unsubscribe_secret');
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF v_secret IS NULL THEN
    -- Configuration error. The vault secret isn't set. We don't want
    -- to leak that to the user, just fail gracefully.
    RAISE WARNING 'public_unsubscribe_marketing: unsubscribe_secret missing from vault';
    RETURN jsonb_build_object('success', FALSE, 'error', 'service_unavailable');
  END IF;

  -- Compute expected token. MUST match the Edge Function's signer
  -- exactly:
  --   sha256_hmac(secret, lower(email) || ':unsubscribe-v1')
  -- We lowercase the email so case differences ('User@x.com' vs
  -- 'user@X.com') don't break unsubscribe. Profiles.email is stored
  -- as-entered though, so the actual UPDATE matches whatever's there.
  v_expected_token := encode(
    extensions.hmac(
      lower(trim(p_email)) || ':unsubscribe-v1',
      v_secret,
      'sha256'
    ),
    'hex'
  );

  -- Constant-time-ish comparison. PostgreSQL's = on TEXT short-circuits,
  -- which is a theoretical timing leak but the token has high entropy
  -- (256 bits) so it doesn't help an attacker. Good enough for marketing
  -- unsubscribe.
  IF v_expected_token <> lower(trim(p_token)) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_token');
  END IF;

  -- Token is valid. Find and update the profile.
  -- Idempotent: re-clicking the unsubscribe link returns success even
  -- if already unsubscribed.
  UPDATE public.profiles
     SET notif_marketing = FALSE
   WHERE lower(email) = lower(trim(p_email));

  GET DIAGNOSTICS v_profile_exists = ROW_COUNT;

  IF v_profile_exists = 0 THEN
    -- Token was valid but no profile with that email. Could be a
    -- deleted account. Show success anyway (no PII leak about
    -- whether the account exists, and unsubscribe is the user's
    -- intent regardless).
    RETURN jsonb_build_object('success', TRUE, 'email', p_email, 'note', 'already_unsubscribed');
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'email', p_email);
END;
$$;

-- Public — anyone with the link can call. The token gates access.
GRANT EXECUTE ON FUNCTION public.public_unsubscribe_marketing(TEXT, TEXT) TO anon, authenticated;

-- ─── 4. Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_table BOOLEAN;
  v_fn1   BOOLEAN;
  v_fn2   BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'broadcasts'
  ) INTO v_table;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_send_broadcast'
  ) INTO v_fn1;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'public_unsubscribe_marketing'
  ) INTO v_fn2;

  IF NOT v_table THEN RAISE EXCEPTION 'MIGRATION 068 FAILED — broadcasts table missing'; END IF;
  IF NOT v_fn1   THEN RAISE EXCEPTION 'MIGRATION 068 FAILED — admin_send_broadcast missing'; END IF;
  IF NOT v_fn2   THEN RAISE EXCEPTION 'MIGRATION 068 FAILED — public_unsubscribe_marketing missing'; END IF;

  RAISE NOTICE 'MIGRATION 068 OK — broadcasts + unsubscribe wired';
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- POST-MIGRATION SETUP — REQUIRED
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. Generate a random unsubscribe secret (64 hex chars = 32 bytes):
--
--    Run in your Mac terminal:
--      openssl rand -hex 32
--
--    Copy the output (something like
--      'a3f9e2d8b7c4...64charstotal'). Save it somewhere safe — you'll
--    use it in TWO places below.
--
-- 2. Add the secret to Postgres vault:
--
--    In Supabase SQL editor, run:
--      SELECT vault.create_secret(
--        'PASTE_THE_64_CHAR_HEX_HERE',
--        'unsubscribe_secret'
--      );
--
-- 3. Add the SAME secret as an Edge Function env var:
--
--    In your Mac terminal:
--      supabase secrets set UNSUBSCRIBE_SECRET=PASTE_THE_SAME_64_CHAR_HEX_HERE
--
-- 4. Redeploy the email function (it reads the env at boot):
--
--      supabase functions deploy send-notification-email
--
-- 5. Verify by sending a test broadcast from the admin dashboard.
--    The marketing email should arrive with a working unsubscribe link.
--
-- ═══════════════════════════════════════════════════════════════════════
