-- ════════════════════════════════════════════════════════════════════════
-- Migration 069 — Unsubscribe RPC fix + marketing default-on
-- ════════════════════════════════════════════════════════════════════════
--
-- Three independent fixes, bundled because they all touch the same
-- broadcast + marketing-preference machinery:
--
-- 1. UNSUBSCRIBE RPC — public_unsubscribe_marketing from mig 068 was
--    failing with a generic 'تعذّر إكمال الطلب' on the unsubscribe page
--    because:
--      a) hardcoded `extensions.hmac(...)` schema. pgcrypto's hmac may
--         live in `public` schema (older Supabase projects) so the call
--         threw a function-not-found exception that surfaced as a
--         generic error in the React catch block.
--      b) sole dependency on `_get_vault_secret()` helper — when that
--         returned NULL (some helper implementations have hardcoded
--         CASE lists that don't know about new secret names), the RPC
--         returned 'service_unavailable' which the page treated as a
--         generic error.
--    Fix: SET search_path includes 'extensions' so bare hmac() resolves
--    correctly anywhere, AND fallback to direct vault.decrypted_secrets
--    read if the helper returns NULL.
--
-- 2. MARKETING DEFAULT-ON — product decision: notif_marketing should
--    default to TRUE for new users. Existing users with NULL get
--    backfilled to TRUE. Existing users with explicit FALSE keep FALSE
--    (their previous opt-out is preserved).
--
-- 3. AUDIENCE FILTER — admin_send_broadcast's WHERE clause was
--    `notif_marketing = TRUE` (strict). With NULL → TRUE backfill, this
--    technically still works, but new users added later would have
--    notif_marketing = TRUE (per new default) so the strict filter
--    still works for them too. Switch to `notif_marketing IS NOT FALSE`
--    (NULL or TRUE pass) as defense in depth so future schema drift
--    doesn't silently exclude users.
--
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Fix public_unsubscribe_marketing ────────────────────────────────
CREATE OR REPLACE FUNCTION public.public_unsubscribe_marketing(
  p_email TEXT,
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- THE KEY FIX — extensions is on the search path, so bare hmac() finds
-- pgcrypto whether it lives in `public` (older projects) or `extensions`
-- (newer default).
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_secret         TEXT;
  v_expected_token TEXT;
  v_rows_updated   INTEGER;
BEGIN
  -- Input validation
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'missing_email');
  END IF;
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_token_format');
  END IF;

  -- ─── Two-tier secret lookup ──────────────────────────────────────
  -- Tier 1: established helper from mig 060 (preserves audit trail).
  BEGIN
    v_secret := public._get_vault_secret('unsubscribe_secret');
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  -- Tier 2: direct read from vault if helper returned NULL or threw.
  -- This covers the case where _get_vault_secret has a hardcoded
  -- whitelist of secret names that doesn't include 'unsubscribe_secret'.
  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    BEGIN
      SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets
       WHERE name = 'unsubscribe_secret'
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_secret := NULL;
    END;
  END IF;

  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE WARNING 'public_unsubscribe_marketing: unsubscribe_secret not in vault';
    RETURN jsonb_build_object('success', FALSE, 'error', 'service_unavailable');
  END IF;

  -- ─── Compute expected token (must match Edge Function signer) ────
  -- Wrapped in BEGIN/EXCEPTION so any pgcrypto-related failure
  -- (extension missing entirely, etc.) surfaces a clear error code
  -- instead of leaking a postgres exception to the React catch block.
  BEGIN
    v_expected_token := encode(
      hmac(
        lower(trim(p_email)) || ':unsubscribe-v1',
        v_secret,
        'sha256'
      ),
      'hex'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public_unsubscribe_marketing: hmac failed: % %', SQLSTATE, SQLERRM;
    RETURN jsonb_build_object('success', FALSE, 'error', 'hmac_unavailable');
  END;

  -- Compare. Token mismatch → likely a hand-tampered URL OR the
  -- function's UNSUBSCRIBE_SECRET env var doesn't match the vault
  -- secret value.
  IF v_expected_token <> lower(trim(p_token)) THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_token');
  END IF;

  -- ─── Token valid — flip the preference ──────────────────────────
  UPDATE public.profiles
     SET notif_marketing = FALSE
   WHERE lower(email) = lower(trim(p_email));

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Token was valid but no matching profile. Deleted account or
    -- email change. Return success either way — the user's intent
    -- (don't email me) is satisfied since the profile doesn't exist
    -- to receive emails.
    RETURN jsonb_build_object('success', TRUE, 'email', p_email, 'note', 'already_unsubscribed');
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'email', p_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_unsubscribe_marketing(TEXT, TEXT) TO anon, authenticated;

-- ─── 2. Marketing default-on ────────────────────────────────────────────
-- New users created from here on get notif_marketing = TRUE.
ALTER TABLE public.profiles
  ALTER COLUMN notif_marketing SET DEFAULT TRUE;

-- Backfill existing NULL → TRUE. Preserves explicit FALSE (users who
-- manually opted out keep their choice).
UPDATE public.profiles
   SET notif_marketing = TRUE
 WHERE notif_marketing IS NULL;

-- ─── 3. Relax audience filter in admin_send_broadcast ──────────────────
-- Switch from strict `= TRUE` to `IS NOT FALSE` (NULL or TRUE pass).
-- After the backfill above, NULL rows shouldn't exist anymore, but
-- this protects against future schema drift / direct INSERTs that
-- bypass the column default.
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

  v_link := COALESCE(NULLIF(trim(p_link), ''), '/');

  INSERT INTO public.broadcasts (
    created_by, title, message, audience, audience_city,
    channel_push, channel_email, recipient_count, link
  ) VALUES (
    v_caller_email, p_title, p_message, p_audience, p_audience_city,
    p_channel_push, p_channel_email, 0, v_link
  )
  RETURNING id INTO v_broadcast_id;

  WITH eligible AS (
    SELECT p.email
      FROM public.profiles p
     WHERE
        CASE p_audience
          WHEN 'all'        THEN TRUE
          WHEN 'drivers'    THEN p.account_type IN ('driver', 'both')
          WHEN 'passengers' THEN p.account_type IN ('passenger', 'both')
          WHEN 'by_city'    THEN p.city = p_audience_city
        END
        -- CHANGED: was `notif_marketing = TRUE` (strict).
        -- Now: NULL or TRUE both pass; only explicit FALSE excluded.
        -- After mig 069's NULL backfill + new default = TRUE, all new
        -- users will have explicit TRUE. This is defense in depth.
        AND p.notif_marketing IS NOT FALSE
        AND p.deleted_at IS NULL
  ),
  inserted AS (
    INSERT INTO public.notifications (
      user_email, title, message, type, link, is_read, created_by
    )
    SELECT
      e.email, p_title, p_message, 'broadcast', v_link, FALSE, 'system'
    FROM eligible e
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;

  UPDATE public.broadcasts
     SET recipient_count = v_count
   WHERE id = v_broadcast_id;

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

GRANT EXECUTE ON FUNCTION public.admin_send_broadcast(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT)
  TO authenticated;

COMMIT;

-- ─── Verification ───────────────────────────────────────────────────────
DO $$
DECLARE
  v_default        TEXT;
  v_null_count     INTEGER;
  v_true_count     INTEGER;
  v_false_count    INTEGER;
BEGIN
  -- Verify the column default flipped to TRUE
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'profiles'
     AND column_name = 'notif_marketing';

  IF v_default NOT LIKE '%true%' THEN
    RAISE EXCEPTION 'MIGRATION 069 FAILED — column default did not flip to TRUE (got: %)', v_default;
  END IF;

  -- Verify backfill
  SELECT COUNT(*) FILTER (WHERE notif_marketing IS NULL),
         COUNT(*) FILTER (WHERE notif_marketing = TRUE),
         COUNT(*) FILTER (WHERE notif_marketing = FALSE)
    INTO v_null_count, v_true_count, v_false_count
    FROM public.profiles;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION 069 FAILED — % profiles still have NULL notif_marketing', v_null_count;
  END IF;

  RAISE NOTICE 'MIGRATION 069 OK — default=%, true=%, false=%, null=%',
    v_default, v_true_count, v_false_count, v_null_count;
END $$;
