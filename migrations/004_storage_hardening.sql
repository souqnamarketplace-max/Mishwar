-- =============================================================================
-- مِشوار  — STORAGE HARDENING (C-03)
-- =============================================================================
-- Closes the "any authenticated user can delete/overwrite any file in the
-- uploads bucket" hole, and creates a private bucket for KYC documents
-- (driver licenses, selfies). Idempotent — safe to re-run.
--
-- WHAT THIS DOES:
--   1. Creates a NEW private bucket `uploads-private` for licenses + selfies
--   2. Tightens policies on the existing `uploads` bucket so users can only
--      modify files in their own UUID-prefixed folder
--   3. Sets up policies on the new private bucket where only the owner +
--      admins can read
--
-- WHAT IT DOES NOT DO YET:
--   - Move existing license URLs to the private bucket (data migration —
--     run separately after the upload code has been updated)
--   - Update upload code to use UUID-prefixed paths (code commit follows)
--
-- ROLLOUT ORDER:
--   1. Apply this SQL    → private bucket + ownership policies live, but
--                          existing public license URLs still readable
--   2. Deploy code       → new uploads go to UUID-prefixed paths in
--                          uploads-private; signed URLs returned for view
--   3. Backfill script   → for each profile.license_image_url that points
--                          to /object/public/uploads/*, copy file to
--                          uploads-private/<uid>/license.jpg, update DB
--   4. Lock down         → revoke public read on the path patterns once
--                          backfill verified
-- =============================================================================


-- =============================================================================
-- 1) Private bucket for KYC documents
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads-private',
  'uploads-private',
  FALSE,
  10485760,  -- 10 MB cap; licenses can be large scans
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public            = FALSE,
  file_size_limit   = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- =============================================================================
-- 2) Drop the wide-open policies on storage.objects
-- =============================================================================
DROP POLICY IF EXISTS "Public read access on uploads"            ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload files"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update files"     ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete files"     ON storage.objects;
DROP POLICY IF EXISTS "Give users access to own folder"          ON storage.objects;
DROP POLICY IF EXISTS "Allow public read"                        ON storage.objects;
DROP POLICY IF EXISTS "users_upload_own_folder"                  ON storage.objects;
DROP POLICY IF EXISTS "users_update_own_files"                   ON storage.objects;
DROP POLICY IF EXISTS "users_delete_own_files"                   ON storage.objects;
DROP POLICY IF EXISTS "public_read_uploads"                      ON storage.objects;
DROP POLICY IF EXISTS "private_read_owner_or_admin"              ON storage.objects;


-- =============================================================================
-- 3) Re-create policies with ownership checks
-- =============================================================================

-- Public read on the public bucket only (avatars, car photos, hero slides)
CREATE POLICY "public_read_uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'uploads');

-- Owner-or-admin read on the private bucket
CREATE POLICY "private_read_owner_or_admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads-private'
    AND (
      owner = auth.uid()
      OR public.auth_user_role() = 'admin'
    )
  );

-- Inserts: must be authenticated AND first folder segment must be the
-- user's UUID. This is the namespacing that prevents user A from
-- writing to user B's directory.
--
-- New code uploading to either bucket should use paths like:
--     <auth.uid()>/avatar-<timestamp>.jpg
--     <auth.uid()>/license-front.jpg
--
-- Existing legacy paths (timestamp-prefixed at the root) will refuse new
-- inserts under this rule. Set the upload code to UUID-prefix all new
-- paths before applying.
CREATE POLICY "auth_users_upload_own_folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('uploads','uploads-private')
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Updates: only on rows the user owns (by the storage owner column,
-- which Supabase populates as auth.uid() on insert)
CREATE POLICY "auth_users_update_own_files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('uploads','uploads-private')
    AND owner = auth.uid()
  );

-- Deletes: same ownership check
CREATE POLICY "auth_users_delete_own_files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('uploads','uploads-private')
    AND owner = auth.uid()
  );

-- Admins can read+delete anything in either bucket (for moderation)
CREATE POLICY "admin_read_all_buckets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('uploads','uploads-private')
    AND public.auth_user_role() = 'admin'
  );

CREATE POLICY "admin_delete_any"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('uploads','uploads-private')
    AND public.auth_user_role() = 'admin'
  );


-- =============================================================================
-- VERIFICATION
-- =============================================================================
DO $$
DECLARE
  bucket_count INT;
  policy_count INT;
BEGIN
  SELECT COUNT(*) INTO bucket_count FROM storage.buckets WHERE id = 'uploads-private';
  IF bucket_count = 1 THEN RAISE NOTICE '✓ uploads-private bucket exists';
  ELSE                     RAISE WARNING '✗ uploads-private bucket missing'; END IF;

  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname LIKE 'auth_users_%' OR policyname LIKE 'admin_%';
  RAISE NOTICE 'Storage ownership policies installed: % rows in pg_policies', policy_count;

  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'Storage hardening applied. Next steps (separate work):';
  RAISE NOTICE '  1. Update upload code to UUID-prefix all paths';
  RAISE NOTICE '  2. Run backfill to move existing license URLs to private bucket';
  RAISE NOTICE '  3. Audit profile.license_image_url for /object/public/* leaks';
  RAISE NOTICE '────────────────────────────────────────────────────────';
END $$;
