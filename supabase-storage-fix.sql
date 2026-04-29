-- =====================================================
-- Mishwar — Storage Fix
-- Run this in Supabase SQL Editor if file uploads fail
-- =====================================================

-- 1. Create/update the uploads bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  TRUE,
  5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public            = TRUE,
  file_size_limit   = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf'];

-- 2. Drop old storage policies (clean slate)
DROP POLICY IF EXISTS "Public read access on uploads"          ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete files"   ON storage.objects;
DROP POLICY IF EXISTS "Give users access to own folder"        ON storage.objects;
DROP POLICY IF EXISTS "Allow public read"                      ON storage.objects;

-- 3. Re-create storage policies
-- Anyone can view uploaded files (avatars, car images, etc. are public)
CREATE POLICY "Public read access on uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'uploads');

-- Logged-in users can upload
CREATE POLICY "Authenticated users can upload files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'uploads');

-- Logged-in users can overwrite their own files
CREATE POLICY "Authenticated users can update files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'uploads');

-- Logged-in users can delete files
CREATE POLICY "Authenticated users can delete files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'uploads');

-- 4. Verify
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'uploads';
