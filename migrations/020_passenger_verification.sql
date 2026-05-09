-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 020 — Passenger ID verification gate
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Adds an ID verification step before passengers can post trip requests.
-- Photos go to the existing private `uploads-private` bucket under the
-- `passenger-verifications/{user_id}/` prefix. RLS keeps photos visible
-- only to the owner and admins.
--
-- State machine:
--   (no row)                          → user has never submitted
--   row exists, status='pending'      → submitted, awaiting admin review
--   row exists, status='approved'     → can post trip requests
--   row exists, status='rejected'     → can resubmit (resubmit_count++)
--   row exists, status='revoked'      → admin pulled approval; can resubmit
--
-- Privacy:
--   - Photos in private storage, served via signed URLs only
--   - We capture full_name_on_id for visual matching against the photo,
--     but NEVER the ID number itself (not needed for our use case)
--   - ON DELETE CASCADE so verification + photos go when user deletes
--   - is_passenger_verified() returns boolean only — no PII surfaced
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── A) Schema ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.passenger_verifications (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_email         TEXT NOT NULL UNIQUE,           -- one verification record per user
  user_id            UUID,                            -- auth.users.id, for storage path

  -- Submitted data
  full_name_on_id    TEXT NOT NULL CHECK (length(full_name_on_id) BETWEEN 2 AND 200),
  id_front_url       TEXT NOT NULL,
  id_back_url        TEXT,                            -- optional but recommended
  selfie_url         TEXT NOT NULL,                   -- selfie holding the ID
  submission_note    TEXT CHECK (length(submission_note) <= 500),

  -- State
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','revoked')),
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at        TIMESTAMPTZ,
  reviewed_by        TEXT,                            -- admin email
  rejection_reason   TEXT CHECK (length(rejection_reason) <= 500),
  admin_note         TEXT CHECK (length(admin_note)      <= 1000),
  resubmit_count     INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.passenger_verifications IS
  'Passenger ID verification records. Required before a user can use the
   submit_trip_request RPC. One row per user (UNIQUE on user_email);
   resubmissions update the row and increment resubmit_count.';

CREATE INDEX IF NOT EXISTS passenger_verifications_status_idx
  ON public.passenger_verifications (status, submitted_at);
CREATE INDEX IF NOT EXISTS passenger_verifications_pending_queue_idx
  ON public.passenger_verifications (submitted_at)
  WHERE status = 'pending';

-- updated_at trigger reuses set_updated_at (created defensively in 019)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'passenger_verifications_set_updated_at') THEN
    EXECUTE 'CREATE TRIGGER passenger_verifications_set_updated_at
             BEFORE UPDATE ON public.passenger_verifications
             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;


-- ─── B) Helper: is the user verified? ─────────────────────────────────────
--
-- Used by submit_trip_request RPC + UI gate. SECURITY DEFINER so it can
-- read the verifications table without granting the caller direct rights.
-- Admins always pass — they're trusted by definition.

CREATE OR REPLACE FUNCTION public.is_passenger_verified(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_email IS NULL THEN RETURN FALSE; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE email = p_email LIMIT 1;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.passenger_verifications
    WHERE user_email = p_email AND status = 'approved'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.is_passenger_verified(TEXT) TO authenticated;


-- ─── C) RLS policies ──────────────────────────────────────────────────────

ALTER TABLE public.passenger_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pv_select_own       ON public.passenger_verifications;
DROP POLICY IF EXISTS pv_select_admin     ON public.passenger_verifications;
DROP POLICY IF EXISTS pv_insert_own       ON public.passenger_verifications;
DROP POLICY IF EXISTS pv_update_own       ON public.passenger_verifications;
DROP POLICY IF EXISTS pv_update_admin     ON public.passenger_verifications;

-- User can read their own verification (any status)
CREATE POLICY pv_select_own ON public.passenger_verifications
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_email = public.auth_user_email());

-- Admins can read everything
CREATE POLICY pv_select_admin ON public.passenger_verifications
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.auth_user_role() = 'admin');

-- Insert: user can create their own row, status starts at 'pending' via
-- column default. The submit RPC also enforces this with explicit checks.
CREATE POLICY pv_insert_own ON public.passenger_verifications
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (user_email = public.auth_user_email());

-- Update by user: only when current status is rejected/revoked (to allow
-- resubmission via UPDATE rather than INSERT-conflict). The submit RPC
-- handles this server-side; this policy is the safety net.
CREATE POLICY pv_update_own ON public.passenger_verifications
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    user_email = public.auth_user_email()
    AND status IN ('rejected', 'revoked')
  )
  WITH CHECK (user_email = public.auth_user_email());

-- Admin can update freely (approve/reject/revoke)
CREATE POLICY pv_update_admin ON public.passenger_verifications
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin')
  WITH CHECK (public.auth_user_role() = 'admin');


-- ─── D) Storage bucket access for verification photos ─────────────────────
--
-- Reuses the existing `uploads-private` bucket (created by migration 004).
-- Photos live under `passenger-verifications/{user_id}/...`. The user can
-- read/write their own folder; admins can read all.

DROP POLICY IF EXISTS storage_pv_user_rw   ON storage.objects;
DROP POLICY IF EXISTS storage_pv_admin_read ON storage.objects;

-- User can upload/read/update/delete files in their own verification folder
CREATE POLICY storage_pv_user_rw ON storage.objects
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    bucket_id = 'uploads-private'
    AND name LIKE 'passenger-verifications/' || auth.uid()::text || '/%'
  )
  WITH CHECK (
    bucket_id = 'uploads-private'
    AND name LIKE 'passenger-verifications/' || auth.uid()::text || '/%'
  );

-- Admin can read any verification photo (for review)
CREATE POLICY storage_pv_admin_read ON storage.objects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads-private'
    AND name LIKE 'passenger-verifications/%'
    AND public.auth_user_role() = 'admin'
  );


-- ─── E) RPC: submit_passenger_verification ────────────────────────────────
--
-- Idempotent submit — handles both new submissions and resubmits after
-- a rejection. Caller passes the storage paths (already uploaded by the
-- client via supabase.storage). RPC validates state and writes the row.

CREATE OR REPLACE FUNCTION public.submit_passenger_verification(
  p_full_name_on_id  TEXT,
  p_id_front_url     TEXT,
  p_selfie_url       TEXT,
  p_id_back_url      TEXT DEFAULT NULL,
  p_submission_note  TEXT DEFAULT NULL
) RETURNS public.passenger_verifications
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email     TEXT := public.auth_user_email();
  v_uid       UUID := auth.uid();
  v_existing  public.passenger_verifications%ROWTYPE;
  v_row       public.passenger_verifications;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Basic validation
  IF length(TRIM(p_full_name_on_id)) < 2 THEN
    RAISE EXCEPTION 'full_name_on_id required';
  END IF;
  IF p_id_front_url IS NULL OR p_selfie_url IS NULL THEN
    RAISE EXCEPTION 'id_front and selfie photos are required';
  END IF;

  SELECT * INTO v_existing
  FROM public.passenger_verifications
  WHERE user_email = v_email;

  IF NOT FOUND THEN
    -- First submission
    INSERT INTO public.passenger_verifications (
      user_email, user_id, full_name_on_id,
      id_front_url, id_back_url, selfie_url,
      submission_note, status, submitted_at
    ) VALUES (
      v_email, v_uid, TRIM(p_full_name_on_id),
      p_id_front_url, p_id_back_url, p_selfie_url,
      NULLIF(TRIM(p_submission_note), ''),
      'pending', now()
    ) RETURNING * INTO v_row;
  ELSE
    -- Resubmission allowed only from rejected/revoked (or pending re-edit)
    IF v_existing.status = 'approved' THEN
      RAISE EXCEPTION 'already verified — no resubmission needed';
    END IF;

    UPDATE public.passenger_verifications
    SET full_name_on_id   = TRIM(p_full_name_on_id),
        id_front_url      = p_id_front_url,
        id_back_url       = p_id_back_url,
        selfie_url        = p_selfie_url,
        submission_note   = NULLIF(TRIM(p_submission_note), ''),
        status            = 'pending',
        submitted_at      = now(),
        rejection_reason  = NULL,
        resubmit_count    = COALESCE(resubmit_count, 0) + 1,
        updated_at        = now()
    WHERE user_email = v_email
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.submit_passenger_verification(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_passenger_verification(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ─── F) RPC: admin_review_passenger_verification ──────────────────────────

CREATE OR REPLACE FUNCTION public.admin_review_passenger_verification(
  p_verification_id UUID,
  p_decision        TEXT,    -- 'approved' | 'rejected' | 'revoked'
  p_reason          TEXT DEFAULT NULL,
  p_admin_note      TEXT DEFAULT NULL
) RETURNS public.passenger_verifications
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email TEXT := public.auth_user_email();
  v_role  TEXT := public.auth_user_role();
  v_row   public.passenger_verifications;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected', 'revoked') THEN
    RAISE EXCEPTION 'invalid decision';
  END IF;
  IF p_decision = 'rejected' AND (p_reason IS NULL OR length(TRIM(p_reason)) = 0) THEN
    RAISE EXCEPTION 'rejection reason required';
  END IF;

  UPDATE public.passenger_verifications
  SET status            = p_decision,
      reviewed_at       = now(),
      reviewed_by       = v_email,
      rejection_reason  = CASE WHEN p_decision = 'rejected' THEN TRIM(p_reason) ELSE NULL END,
      admin_note        = COALESCE(NULLIF(TRIM(p_admin_note), ''), admin_note),
      updated_at        = now()
  WHERE id = p_verification_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification not found';
  END IF;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.admin_review_passenger_verification(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_passenger_verification(UUID, TEXT, TEXT, TEXT) TO authenticated;


-- ─── G) Update submit_trip_request to require verification ────────────────
--
-- Re-defining to insert a verification gate at the very top (after auth
-- check). All previous logic preserved (3-active-max, expiry compute, etc).

CREATE OR REPLACE FUNCTION public.submit_trip_request(
  p_from_city        TEXT,
  p_to_city          TEXT,
  p_requested_date   DATE,
  p_requested_time   TIME,
  p_time_flexibility TEXT,
  p_seats_needed     INTEGER,
  p_suggested_price  INTEGER,
  p_pickup_details   TEXT DEFAULT NULL,
  p_dropoff_details  TEXT DEFAULT NULL,
  p_notes            TEXT DEFAULT NULL,
  p_from_lat         NUMERIC DEFAULT NULL,
  p_from_lng         NUMERIC DEFAULT NULL,
  p_to_lat           NUMERIC DEFAULT NULL,
  p_to_lng           NUMERIC DEFAULT NULL
) RETURNS public.trip_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email      TEXT := public.auth_user_email();
  v_name       TEXT;
  v_active_n   INTEGER;
  v_max_active CONSTANT INTEGER := 3;
  v_expiry     TIMESTAMPTZ;
  v_row        public.trip_requests;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- ─── ID VERIFICATION GATE (added in migration 020) ───
  -- Refuse if the passenger hasn't been verified. Admins auto-pass via
  -- is_passenger_verified. Friendly error mapped in src/lib/errors.js.
  IF NOT public.is_passenger_verified(v_email) THEN
    RAISE EXCEPTION 'passenger not verified' USING ERRCODE = '42501';
  END IF;

  -- Date sanity: must be today or future
  IF p_requested_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'request date is in the past';
  END IF;

  -- Anti-spam: max 3 active requests per passenger
  SELECT COUNT(*) INTO v_active_n
  FROM public.trip_requests
  WHERE passenger_email = v_email
    AND status = 'open';
  IF v_active_n >= v_max_active THEN
    RAISE EXCEPTION 'too many active requests (max %)', v_max_active;
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE email = v_email;
  v_expiry := public.compute_request_expiry(p_requested_date, p_requested_time, p_time_flexibility);

  INSERT INTO public.trip_requests (
    created_by, passenger_email, passenger_name,
    from_city, to_city, from_lat, from_lng, to_lat, to_lng,
    pickup_details, dropoff_details,
    requested_date, requested_time, time_flexibility, expires_at,
    seats_needed, suggested_price, notes,
    status
  ) VALUES (
    v_email, v_email, COALESCE(v_name, v_email),
    p_from_city, p_to_city, p_from_lat, p_from_lng, p_to_lat, p_to_lng,
    NULLIF(TRIM(p_pickup_details), ''), NULLIF(TRIM(p_dropoff_details), ''),
    p_requested_date, p_requested_time, p_time_flexibility, v_expiry,
    p_seats_needed, p_suggested_price, NULLIF(TRIM(p_notes), ''),
    'open'
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $$;
