-- =============================================================================
-- مِشوار  — STORAGE BACKFILL: audit + migrate public license URLs
-- =============================================================================
-- Companion to migrations/004_storage_hardening.sql. After 004 has been
-- applied AND the upload code change in 9816411 is live (paths are now
-- UUID-prefixed), use this script to:
--   1. AUDIT every existing license URL pointing at the public bucket
--   2. PLAN the migration (write your operator a list)
--   3. EXECUTE the moves (commented — uncomment after manual review)
--
-- WHY THIS IS A SEPARATE SCRIPT:
--   The public→private object copy must happen via the Supabase Storage
--   API, NOT via SQL. SQL can rewrite the row pointers in `profiles` and
--   `driver_licenses`, but the actual file copy needs a script with
--   service-role credentials. This file generates the work list.
--
-- USAGE:
--   1. Run section 1 in Supabase SQL Editor — outputs a list of leaked URLs
--   2. Hand the list to a Node/CLI script (template below) that:
--        - downloads each public file
--        - re-uploads to uploads-private with UUID-prefixed path
--        - returns the new path back via SQL UPDATE
--   3. Run section 3 to verify no leaked URLs remain
-- =============================================================================


-- =============================================================================
-- SECTION 1 — AUDIT: list every leaked URL
-- =============================================================================
-- Each row that comes back is a license image / KYC document currently
-- accessible to anyone with the URL. Save the output for the backfill script.

-- KYC fields on driver_licenses
SELECT
  'driver_licenses' AS source_table,
  id::text          AS row_id,
  driver_email,
  'license_image_url' AS column_name,
  license_image_url AS public_url
FROM public.driver_licenses
WHERE license_image_url IS NOT NULL
  AND license_image_url LIKE '%/object/public/uploads/%'

UNION ALL
SELECT 'driver_licenses', id::text, driver_email, 'car_registration_url', car_registration_url
FROM public.driver_licenses
WHERE car_registration_url LIKE '%/object/public/uploads/%'

UNION ALL
SELECT 'driver_licenses', id::text, driver_email, 'insurance_url', insurance_url
FROM public.driver_licenses
WHERE insurance_url LIKE '%/object/public/uploads/%'

UNION ALL
SELECT 'driver_licenses', id::text, driver_email, 'selfie_1_url', selfie_1_url
FROM public.driver_licenses
WHERE selfie_1_url LIKE '%/object/public/uploads/%'

UNION ALL
SELECT 'driver_licenses', id::text, driver_email, 'selfie_2_url', selfie_2_url
FROM public.driver_licenses
WHERE selfie_2_url LIKE '%/object/public/uploads/%'

ORDER BY source_table, row_id;


-- =============================================================================
-- SECTION 2 — Node/CLI BACKFILL TEMPLATE
-- =============================================================================
-- Save as scripts/backfill-private-uploads.mjs and run with:
--   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-private-uploads.mjs
--
--   import { createClient } from '@supabase/supabase-js';
--   import { readFileSync } from 'fs';
--
--   const supa = createClient(
--     process.env.SUPABASE_URL,
--     process.env.SUPABASE_SERVICE_ROLE_KEY,   // SERVICE ROLE — keep out of git
--     { auth: { persistSession: false } }
--   );
--
--   // 1. Pull the audit list (re-uses SECTION 1 above)
--   const auditSql = readFileSync('migrations/005_storage_backfill.sql', 'utf-8')
--     .split('-- SECTION 2')[0];   // run only the SELECT
--   const { data: rows, error } = await supa.rpc('exec_sql', { sql: auditSql });
--   // (or just paste the SELECT, copy CSV from SQL Editor, parse here)
--
--   for (const row of rows) {
--     const oldPath = new URL(row.public_url).pathname.split('/object/public/uploads/')[1];
--     // Get the user UUID via email
--     const { data: profile } = await supa.from('profiles')
--       .select('id').eq('email', row.driver_email).single();
--     const newPath = `${profile.id}/license-${Date.now()}-${row.column_name}.${oldPath.split('.').pop()}`;
--
--     // Download the public file
--     const { data: blob } = await supa.storage.from('uploads').download(oldPath);
--     // Upload to private bucket
--     await supa.storage.from('uploads-private').upload(newPath, blob, {
--       contentType: blob.type,
--     });
--     // Update the DB row
--     await supa.from(row.source_table)
--       .update({ [row.column_name]: newPath })   // store path, not URL
--       .eq('id', row.row_id);
--     // Optionally delete the public copy (defer until verification)
--     // await supa.storage.from('uploads').remove([oldPath]);
--     console.log(`migrated ${row.column_name} for ${row.driver_email}`);
--   }
--
-- After backfill, the admin license-review UI must change from:
--   <img src={license_image_url} />              // direct public URL
-- to:
--   const { data } = await supa.storage.from('uploads-private')
--     .createSignedUrl(license_image_path, 60);
--   <img src={data.signedUrl} />


-- =============================================================================
-- SECTION 3 — VERIFICATION (run after backfill)
-- =============================================================================
-- This should return 0. If it returns rows, those URLs are still leaked.
SELECT COUNT(*) AS leaked_url_count
FROM (
  SELECT license_image_url    FROM public.driver_licenses WHERE license_image_url    LIKE '%/object/public/uploads/%'
  UNION ALL
  SELECT car_registration_url FROM public.driver_licenses WHERE car_registration_url LIKE '%/object/public/uploads/%'
  UNION ALL
  SELECT insurance_url        FROM public.driver_licenses WHERE insurance_url        LIKE '%/object/public/uploads/%'
  UNION ALL
  SELECT selfie_1_url         FROM public.driver_licenses WHERE selfie_1_url         LIKE '%/object/public/uploads/%'
  UNION ALL
  SELECT selfie_2_url         FROM public.driver_licenses WHERE selfie_2_url         LIKE '%/object/public/uploads/%'
) AS leaked;


-- =============================================================================
-- SECTION 4 — Optional cleanup of legacy 'public/' prefix files
-- =============================================================================
-- Once everything has migrated and you want to reclaim storage, delete the
-- old public copies. Run via the Storage UI rather than SQL — Supabase's
-- storage.objects table can be touched via SQL but going through the API
-- enforces the same RLS rules and triggers any downstream cleanup.
--
-- Confirm the count first:
--
-- SELECT COUNT(*) FROM storage.objects
--  WHERE bucket_id = 'uploads' AND name LIKE 'public/%';
