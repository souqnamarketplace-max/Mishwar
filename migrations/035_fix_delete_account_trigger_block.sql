-- ════════════════════════════════════════════════════════════════════════
-- Migration 035 — fix account-deletion getting blocked by the profile
--                 protected-columns trigger
-- ════════════════════════════════════════════════════════════════════════
--
-- THE BUG (reported in prod)
-- User clicks "حذف الحساب نهائياً" in /account-settings. Toast appears:
-- "لا يمكن تعديل البريد الإلكتروني من هنا" (the friendlyError
-- mapping of 'modifying email requires admin'). Deletion fails. Modal
-- resets to step 1.
--
-- ROOT CAUSE
-- The author of migration 002 created the guard_profile_protected_columns
-- BEFORE UPDATE trigger to prevent non-admin users from changing their
-- own role / email / deleted_at via direct PostgREST updates. The trigger
-- comment claimed:
--
--   -- self-deletion sets deleted_at — that path runs through the
--   -- SECURITY DEFINER RPC (delete_user_account), bypassing this trigger.
--   -- Direct UPDATEs to deleted_at are NOT allowed.
--
-- That comment is WRONG. SECURITY DEFINER only changes which role's
-- permissions are checked for the function body — it does NOT bypass
-- row-level triggers. The trigger fires on every UPDATE regardless of
-- who's calling. And the trigger reads auth.uid() to identify the
-- caller's role — auth.uid() comes from the JWT and stays unchanged
-- through SECURITY DEFINER calls. So when delete_user_account_v2 runs
-- `UPDATE public.profiles SET email = 'deleted-<uuid>@deleted.local',
-- deleted_at = NOW(), ...`, the trigger evaluates NEW.email IS DISTINCT
-- FROM OLD.email → true; caller_role := 'user' → not admin; RAISE
-- EXCEPTION 'modifying email requires admin'. Delete dies.
--
-- The exact same problem happens on the deleted_at column. The legacy
-- fallback path in AccountSettings.jsx (only used when the RPC isn't
-- deployed) would hit the deleted_at branch instead — same outcome.
--
-- THE FIX
-- Use a per-transaction session-variable handshake. The RPC sets
-- `mishwar.deleting_account` to its caller's UUID before the UPDATE
-- via set_config(name, value, is_local=true). The trigger checks that
-- variable: if it equals NEW.id, this UPDATE is part of an authorized
-- self-deletion and the protections are skipped. Otherwise the trigger
-- behaves exactly as before.
--
-- WHY THIS IS SAFE
-- - set_config(..., is_local := true) scopes the setting to the current
--   transaction. It doesn't leak across requests or persist after the
--   txn commits/rolls back.
-- - The trigger requires an EXACT UUID match with NEW.id — a malicious
--   caller can't just SET the variable to bypass the trigger, because:
--     (a) RLS still requires id = auth.uid() to UPDATE a profile row
--     (b) Even if a row-level policy could be bypassed (it can't), the
--         caller would have to know the target's UUID AND that UUID
--         would have to equal NEW.id, meaning they'd be updating their
--         own row anyway
-- - The variable is set INSIDE the SECURITY DEFINER function, not by
--   the client. There's no way for a client to set
--   `mishwar.deleting_account` via PostgREST — set_config from the
--   wire is restricted to known prefixes.
-- - If anyone ever adds a public function that calls set_config with
--   this name, code review catches it because the name is namespaced
--   under `mishwar.` rather than a generic prefix.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── (1) Updated trigger ───────────────────────────────────────────────
-- Two changes from the migration 002 version:
--   (a) Early-return when the per-txn deletion handshake matches NEW.id.
--   (b) Same search_path pinning that migration 029 added to all
--       SECURITY DEFINER funcs — re-asserted here so the CREATE OR
--       REPLACE doesn't drop it.

CREATE OR REPLACE FUNCTION public.guard_profile_protected_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  caller_role           TEXT;
  v_deleting_uid_text   TEXT;
BEGIN
  -- Deletion handshake: if a SECURITY DEFINER deletion RPC has set
  -- mishwar.deleting_account to this row's UUID for the current txn,
  -- allow the update unconditionally. Only delete_user_account_v2 sets
  -- this variable; it sets it to auth.uid()::text right before its
  -- UPDATE on profiles and never to any other value.
  v_deleting_uid_text := current_setting('mishwar.deleting_account', true);
  IF v_deleting_uid_text IS NOT NULL
     AND v_deleting_uid_text <> ''
     AND v_deleting_uid_text = NEW.id::text
  THEN
    RETURN NEW;
  END IF;

  -- Original protections.
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS DISTINCT FROM 'admin' THEN
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
  END IF;
  RETURN NEW;
END $$;

-- CREATE OR REPLACE on the function above doesn't touch the trigger
-- itself — the trigger keeps pointing at the function by name and picks
-- up the new body on the next UPDATE. No DROP/CREATE TRIGGER needed.

-- ─── (2) Updated RPC: set the deletion handshake before UPDATE ────────
-- The only line that changes from migration 003 is the new PERFORM
-- set_config right before the UPDATE block. To keep the migration self-
-- contained (and to avoid the trap where a future migration replaces
-- the function and forgets the handshake), CREATE OR REPLACE the entire
-- function below. The body is identical to migration 003's version
-- except for the marked line.

CREATE OR REPLACE FUNCTION public.delete_user_account_v2(
  p_reason TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_old_email        TEXT;
  v_new_email        TEXT;
  v_today            DATE := CURRENT_DATE;
  v_active_trips     INT;
  v_active_bookings  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_old_email FROM auth.users WHERE id = v_uid;
  IF v_old_email IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- Server-side precondition: no active trips/bookings
  SELECT COUNT(*) INTO v_active_trips
  FROM public.trips
  WHERE driver_email = v_old_email
    AND status = 'confirmed'
    AND date >= v_today;
  IF v_active_trips > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming trips as driver', v_active_trips;
  END IF;

  SELECT COUNT(*) INTO v_active_bookings
  FROM public.bookings b
  JOIN public.trips t ON t.id::text = b.trip_id
  WHERE b.passenger_email = v_old_email
    AND b.status = 'confirmed'
    AND t.date >= v_today;
  IF v_active_bookings > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming bookings as passenger', v_active_bookings;
  END IF;

  v_new_email := 'deleted-' || v_uid || '@deleted.local';

  -- ─── DELETION HANDSHAKE (migration 035) ──────────────────────────
  -- Tell the guard_profile_protected_columns trigger this UPDATE is
  -- part of an authorized self-deletion. The trigger checks
  -- NEW.id::text = current_setting('mishwar.deleting_account') and
  -- short-circuits its checks when they match. is_local=true scopes
  -- the setting to this txn only.
  PERFORM set_config('mishwar.deleting_account', v_uid::text, true);

  -- 1) Anonymize the profile (preserves trip/review history but drops PII)
  UPDATE public.profiles SET
    full_name              = '[حساب محذوف]',
    email                  = v_new_email,
    avatar_url             = NULL,
    phone                  = NULL,
    bio                    = NULL,
    bank_iban              = NULL,
    bank_account_number    = NULL,
    bank_account_name      = NULL,
    bank_name              = NULL,
    card_holder_name       = NULL,
    card_last_four         = NULL,
    car_model              = NULL,
    car_year               = NULL,
    car_color              = NULL,
    car_plate              = NULL,
    driver_note            = NULL,
    deleted_at             = NOW(),
    deletion_reason        = p_reason,
    is_active              = FALSE
  WHERE id = v_uid;

  -- 2) Rotate the auth.users email so the user can't log back in with
  -- the same credentials. Privileged write — only the postgres role
  -- can update auth.users, but SECURITY DEFINER lets this RPC do it.
  UPDATE auth.users
  SET email                = v_new_email,
      raw_user_meta_data   = jsonb_build_object('deleted', true)
  WHERE id = v_uid;

  -- 3) Anonymize denormalized email columns across the schema so the
  -- old email doesn't leak through messages, bookings, trips, etc.
  UPDATE public.messages       SET sender_email   = v_new_email WHERE sender_email   = v_old_email;
  UPDATE public.messages       SET receiver_email = v_new_email WHERE receiver_email = v_old_email;
  UPDATE public.bookings       SET passenger_email = v_new_email WHERE passenger_email = v_old_email;
  UPDATE public.trips          SET driver_email    = v_new_email WHERE driver_email    = v_old_email;
  UPDATE public.notifications  SET user_email     = v_new_email WHERE user_email     = v_old_email;

  -- Reviews / blocks / reports / support_tickets — same pattern, only
  -- the columns that actually exist on each table.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewer_email') THEN
    UPDATE public.reviews SET reviewer_email = v_new_email WHERE reviewer_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewed_email') THEN
    UPDATE public.reviews SET reviewed_email = v_new_email WHERE reviewed_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_blocks' AND column_name='blocker_email') THEN
    UPDATE public.user_blocks SET blocker_email = v_new_email WHERE blocker_email = v_old_email;
    UPDATE public.user_blocks SET blocked_email = v_new_email WHERE blocked_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trip_requests') THEN
    UPDATE public.trip_requests SET passenger_email = v_new_email WHERE passenger_email = v_old_email;
  END IF;

  RETURN jsonb_build_object(
    'success',     true,
    'deleted_at',  NOW(),
    'reason',      p_reason
  );
END $$;

REVOKE ALL ON FUNCTION public.delete_user_account_v2(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account_v2(TEXT) TO authenticated;

-- ─── Verification ─────────────────────────────────────────────────────
-- Confirm the trigger picked up the new body (otherwise the handshake
-- check just doesn't exist and we'd still fail).
DO $$
DECLARE
  v_has_handshake BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) LIKE '%mishwar.deleting_account%'
  INTO v_has_handshake
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'guard_profile_protected_columns';
  IF NOT v_has_handshake THEN
    RAISE EXCEPTION 'MIGRATION 035 FAILED: guard_profile_protected_columns missing handshake';
  END IF;
  RAISE NOTICE 'MIGRATION 035 OK — handshake installed, delete_user_account_v2 ready';
END $$;
