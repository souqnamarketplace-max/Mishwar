-- ════════════════════════════════════════════════════════════════════════
-- Migration 040 — gender: set-once for users, admin-only to change
-- ════════════════════════════════════════════════════════════════════════
--
-- USER REQUEST (2026-05-14)
-- "Gender can't be undefined. If the user logs in with email or another
-- tool later, he should be able to update his gender once. Later on he
-- will send request to the support to change it after they verify the
-- ID."
--
-- WHY THIS MATTERS
-- Google OAuth no longer exposes the gender field in OIDC scopes (removed
-- 2018 for privacy). So users who sign up via Google land in the app with
-- profile.gender = NULL. Onboarding.jsx only asks for gender on the
-- DRIVER track — passengers complete onboarding without ever being
-- asked. The previous design said "set during registration only" but
-- there was no way for a Google-signup passenger to ever fill it in.
-- This migration fixes that gap.
--
-- THE POLICY
-- Set-once semantics, enforced at the DB level:
--   • profile.gender starts NULL for everyone
--   • The owner can set their own gender ONCE (NULL → male|female)
--   • Once set, only an admin can change it
--   • Admins change it via set_user_gender_admin(target_email, gender)
--     after verifying the user's account ID through a support ticket
--
-- DATABASE-LEVEL ENFORCEMENT
-- The set-once rule is enforced by extending guard_profile_protected_
-- columns. This is the trigger that already protects email/role/
-- deleted_at/id from non-admin changes. Adding gender to the protected
-- list means clients can run a normal UPDATE on profiles.gender — the
-- trigger allows it if OLD.gender IS NULL, blocks it otherwise. No
-- separate RPC required for the happy path; the existing supabase-js
-- profile-update code in AccountSettings just works.
--
-- The trigger preserves:
--   • The deletion handshake from migration 035 (delete_user_account_v2
--     bypasses all protections via mishwar.deleting_account)
--   • The admin bypass (admins can change everything)
--   • Every original protection (email, role, deleted_at, id)
--
-- ADMIN-PATH RPC
-- set_user_gender_admin: SECURITY DEFINER, callable only by admins, with
-- audit logging and validation. Support uses this when a user contacts
-- them to correct their gender after the set-once was tripped. The RPC
-- logs the action via admin_audit_log so there's an audit trail for any
-- gender changes performed by support.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) Update guard_profile_protected_columns ──────────────────────
-- CREATE OR REPLACE preserving the deletion-handshake from migration 035
-- AND the original protections from migration 002. Adds ONE new check
-- block: gender (set-once).

CREATE OR REPLACE FUNCTION public.guard_profile_protected_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  caller_role           TEXT;
  v_deleting_uid_text   TEXT;
BEGIN
  -- Deletion handshake (migration 035). If delete_user_account_v2 set
  -- mishwar.deleting_account to this row's UUID for the current txn,
  -- bypass all protections — the entire anonymization needs to run.
  v_deleting_uid_text := current_setting('mishwar.deleting_account', true);
  IF v_deleting_uid_text IS NOT NULL
     AND v_deleting_uid_text <> ''
     AND v_deleting_uid_text = NEW.id::text
  THEN
    RETURN NEW;
  END IF;

  -- Resolve caller role. Admin bypasses every check below.
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'admin' THEN
    -- Original protections (migration 002).
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'modifying role requires admin' USING ERRCODE = '42501';
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'modifying email requires admin' USING ERRCODE = '42501';
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION 'modifying deleted_at requires admin or RPC' USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'cannot change id' USING ERRCODE = '42501';
    END IF;

    -- Gender: SET-ONCE (migration 040).
    -- Allowed transitions for non-admin owner:
    --   NULL → 'male' / 'female'   ✓ (the one-time set)
    --   value → SAME value         ✓ (no-op UPDATEs, e.g. saving city
    --                                 should not fail just because the
    --                                 gender column happened to be in
    --                                 the UPDATE payload)
    --   value → different value    ✗ (must contact support)
    --   value → NULL               ✗ (cannot un-set; would let users
    --                                 reset and pick again, defeating
    --                                 the point of set-once)
    --
    -- Validation of the value itself (must be 'male' or 'female') is
    -- left to the profile.gender CHECK constraint where one exists —
    -- this trigger only enforces the once-only policy.
    IF OLD.gender IS NOT NULL
       AND NEW.gender IS DISTINCT FROM OLD.gender
    THEN
      RAISE EXCEPTION 'gender is set-once — contact support to change it'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ─── (2) Admin RPC: change gender for any user ───────────────────────
-- The support path. When a user contacts support saying "I picked the
-- wrong gender, please change it", support verifies their account ID
-- and calls this RPC from the admin dashboard.

CREATE OR REPLACE FUNCTION public.set_user_gender_admin(
  p_target_email TEXT,
  p_gender       TEXT
)
RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_email TEXT := public.auth_user_email();
  v_caller_role  TEXT := public.auth_user_role();
  v_profile      public.profiles;
BEGIN
  -- Auth required
  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Admin only
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin required' USING ERRCODE = '42501';
  END IF;

  -- Validate gender value
  IF p_gender IS NULL OR p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'invalid gender — must be male or female';
  END IF;

  -- Validate target exists
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE email = p_target_email;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found: %', p_target_email;
  END IF;

  -- Perform update. Because the caller_role check inside the guard
  -- trigger looks up the CALLING user's role (admin, by definition
  -- here), the trigger's admin-bypass branch fires and the set-once
  -- block doesn't apply.
  UPDATE public.profiles
  SET gender = p_gender,
      updated_at = NOW()
  WHERE email = p_target_email
  RETURNING * INTO v_profile;

  -- Audit. Helpful when reviewing past support actions.
  INSERT INTO public.admin_audit_log (
    admin_email, action, target_type, target_id, details
  ) VALUES (
    v_caller_email,
    'admin_set_gender',
    'user',
    v_profile.id::text,
    jsonb_build_object(
      'target_email', p_target_email,
      'new_gender',   p_gender,
      'old_gender',   COALESCE((
        SELECT gender::text FROM public.profiles
        WHERE id = v_profile.id
      ), 'null')
    )
  );

  RETURN v_profile;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_user_gender_admin(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_user_gender_admin(TEXT, TEXT) TO authenticated;
-- Authorization is enforced inside the function body via the role check
-- above; the GRANT here just lets PostgREST expose the RPC at all.

-- ─── Verification ────────────────────────────────────────────────────
DO $$
DECLARE
  v_guard_def TEXT;
  v_rpc_exists BOOLEAN;
BEGIN
  -- Confirm the gender check is in the updated guard
  SELECT pg_get_functiondef(p.oid)
  INTO v_guard_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'guard_profile_protected_columns';

  IF v_guard_def NOT LIKE '%gender is set-once%' THEN
    RAISE EXCEPTION 'MIGRATION 040 FAILED: guard does not contain gender check';
  END IF;
  IF v_guard_def NOT LIKE '%mishwar.deleting_account%' THEN
    RAISE EXCEPTION 'MIGRATION 040 FAILED: guard lost deletion handshake — re-apply 035';
  END IF;
  IF v_guard_def NOT LIKE '%modifying email requires admin%' THEN
    RAISE EXCEPTION 'MIGRATION 040 FAILED: guard lost email protection';
  END IF;

  -- Admin RPC exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_user_gender_admin'
  ) INTO v_rpc_exists;
  IF NOT v_rpc_exists THEN
    RAISE EXCEPTION 'MIGRATION 040 FAILED: set_user_gender_admin RPC missing';
  END IF;

  RAISE NOTICE 'MIGRATION 040 OK — gender is set-once for users, set_user_gender_admin available for support';
END $$;
