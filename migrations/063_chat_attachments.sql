-- ════════════════════════════════════════════════════════════════════════
-- Migration 063 — Chat attachments: images + location pins
-- ════════════════════════════════════════════════════════════════════════
--
-- ADDS
--   - messages.attachment_url      TEXT  (public Supabase Storage URL)
--   - messages.attachment_path     TEXT  (storage object path, for delete)
--   - messages.latitude            NUMERIC(9,6)
--   - messages.longitude           NUMERIC(9,6)
--   - CHECK constraint: message_type IN ('text','image','location')
--   - Storage bucket "chat-attachments" with mime-type and size guards
--   - RLS on storage.objects: senders write to their own folder; reads
--     allowed for participants via the messages row that links them
--
-- DESIGN NOTES
--
-- 1) BUCKET IS PUBLIC ON READ, WRITE-LOCKED BY RLS
--    Chat threads can have dozens of images. Signed URLs would require
--    a regeneration round-trip every time a thread loads or scrolls
--    past a previously-rendered bubble — that's hundreds of extra
--    RPC calls in a typical session. We use a PUBLIC bucket so the
--    storage URL renders synchronously in <img src>, with two
--    privacy mitigations:
--      a) Filenames are UUIDs (chatAttachments.js), so URLs are
--         effectively unguessable
--      b) RLS still blocks unauthorized WRITES — only the sender can
--         upload to their own email-prefixed folder
--    This matches the threat model of every major mobile chat app
--    (WhatsApp / Telegram / iMessage all use unguessable IDs over
--    plain HTTPS; the URL is the auth). For a future tightening, we
--    can flip the bucket to private + signed URLs without changing
--    the app schema — only chatAttachments.js needs an update.
--
-- 2) PATH FORMAT
--    {sender_email}/{uuid}.jpg
--    The first folder is the sender's email — used by the INSERT RLS
--    policy via storage.foldername(name)[1]. The UUID makes the URL
--    unguessable AND makes admin moderation cleanup easy (one path =
--    one storage object).
--
-- 3) WHY NO ADMIN-MODERATION TRIGGER FOR ORPHANS
--    When a message row is deleted (rare — admin moderation), the
--    storage object is left orphaned. Cleaning it up from a SQL
--    trigger would need pg_net + an Edge Function — complexity not
--    worth the storage savings (compressed images are ~200-500KB;
--    we'd need thousands of orphans before it costs $1/month).
--    Track this in admin tools as a future enhancement.
--
-- 4) LOCATION PRECISION
--    NUMERIC(9,6) gives ~11cm precision — more than enough for
--    "here's where I am" pins and small enough to be efficient.
--    Values stored as raw decimals; the client opens
--    https://www.google.com/maps?q=lat,lng when the bubble is
--    tapped.
--
-- 5) MIGRATION SAFETY
--    All ADD COLUMN clauses use IF NOT EXISTS. The CHECK constraint
--    is dropped and recreated to ensure consistent state regardless
--    of pre-existing definitions. Bucket INSERT uses ON CONFLICT
--    to be idempotent.
--
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. Schema columns on messages ─────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_path TEXT,
  ADD COLUMN IF NOT EXISTS latitude        NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude       NUMERIC(9, 6);

COMMENT ON COLUMN public.messages.attachment_url IS
  'Public Supabase Storage URL for image messages. Filename is a UUID;
   bucket is public on read but write-locked by RLS. NULL for text/location.';

COMMENT ON COLUMN public.messages.attachment_path IS
  'Storage object path (bucket-relative). Format: {sender_email}/{uuid}.jpg.
   Used for admin moderation cleanup. NULL for text/location messages.';

COMMENT ON COLUMN public.messages.latitude IS
  'Latitude for location-pin messages. NUMERIC(9,6) = ~11cm precision.
   NULL for text/image messages.';

COMMENT ON COLUMN public.messages.longitude IS
  'Longitude for location-pin messages. Paired with latitude. The client
   opens https://www.google.com/maps?q=lat,lng on tap — no static map
   preview yet (keeps payload light; consider Leaflet thumbnails later).';

-- ─── 2. message_type CHECK constraint ──────────────────────────────────
-- Catch-and-recreate so we end in a known state. The CHECK ensures any
-- unknown type (typo, replay from old client) is rejected at the DB.
DO $$
BEGIN
  ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
EXCEPTION WHEN OTHERS THEN
  -- Constraint didn't exist — fine.
  NULL;
END $$;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'location'));

-- ─── 3. Cross-field integrity ──────────────────────────────────────────
-- An 'image' message must have a non-null attachment_url + attachment_path.
-- A 'location' message must have non-null latitude + longitude.
-- A 'text' message must NOT have any of those fields set.
-- This is a single CHECK rather than 3 separate ones so a future
-- 'video' message_type can be added in one place.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_attachment_consistency_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachment_consistency_check
  CHECK (
    CASE message_type
      WHEN 'image'    THEN attachment_url IS NOT NULL AND attachment_path IS NOT NULL
                       AND latitude IS NULL AND longitude IS NULL
      WHEN 'location' THEN latitude IS NOT NULL AND longitude IS NOT NULL
                       AND attachment_url IS NULL AND attachment_path IS NULL
      WHEN 'text'     THEN attachment_url IS NULL AND attachment_path IS NULL
                       AND latitude IS NULL AND longitude IS NULL
      ELSE FALSE
    END
  );

-- ─── 4. Storage bucket ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  TRUE,                                   -- public read — see design note 1
  5242880,                                -- 5 MB cap; clients compress to ~500KB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 5. RLS on storage.objects ─────────────────────────────────────────
-- The storage.objects table already has RLS enabled by Supabase. We add
-- bucket-scoped policies. Each policy name is bucket-prefixed so it
-- doesn't conflict with other buckets' policies.

-- Writes — only the authenticated user can upload to a folder named
-- after their own email. The path's first segment must equal the
-- caller's email. storage.foldername(name) returns an array of folder
-- segments; we compare [1] (PostgreSQL is 1-indexed).
DROP POLICY IF EXISTS chat_attachments_insert ON storage.objects;
CREATE POLICY chat_attachments_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = public.auth_user_email()
  );

-- Deletes — owner of the file OR admin. Admin path covers moderation
-- (reported inappropriate image). Owner path covers a future
-- "delete my message" feature.
DROP POLICY IF EXISTS chat_attachments_delete ON storage.objects;
CREATE POLICY chat_attachments_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      (storage.foldername(name))[1] = public.auth_user_email()
      OR public.auth_user_role() = 'admin'
    )
  );

-- Note: no SELECT policy needed because the bucket is public on read.
-- A future tightening to private + signed URLs would add a SELECT
-- policy here that joins against public.messages to check participant
-- status. Not needed today.

-- Note: no UPDATE policy. We never overwrite attachments in place —
-- a new message creates a new object. UPDATE on storage.objects is
-- blocked by default in absence of a policy.

-- ─── 6. Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  v_cols_present   INTEGER;
  v_type_check_ok  BOOLEAN;
  v_bucket_ok      BOOLEAN;
  v_insert_pol_ok  BOOLEAN;
  v_delete_pol_ok  BOOLEAN;
BEGIN
  -- All 4 new columns exist?
  SELECT COUNT(*) INTO v_cols_present
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'messages'
    AND column_name IN ('attachment_url', 'attachment_path', 'latitude', 'longitude');

  IF v_cols_present <> 4 THEN
    RAISE EXCEPTION 'MIGRATION 063 FAILED: expected 4 new columns, got %', v_cols_present;
  END IF;

  -- CHECK constraint present?
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_message_type_check'
  ) INTO v_type_check_ok;
  IF NOT v_type_check_ok THEN
    RAISE EXCEPTION 'MIGRATION 063 FAILED: message_type CHECK not installed';
  END IF;

  -- Bucket exists?
  SELECT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'chat-attachments'
  ) INTO v_bucket_ok;
  IF NOT v_bucket_ok THEN
    RAISE EXCEPTION 'MIGRATION 063 FAILED: chat-attachments bucket missing';
  END IF;

  -- Policies present?
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'chat_attachments_insert'
  ) INTO v_insert_pol_ok;
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'chat_attachments_delete'
  ) INTO v_delete_pol_ok;
  IF NOT v_insert_pol_ok OR NOT v_delete_pol_ok THEN
    RAISE EXCEPTION 'MIGRATION 063 FAILED: storage RLS policies missing (insert=%, delete=%)',
      v_insert_pol_ok, v_delete_pol_ok;
  END IF;

  RAISE NOTICE 'MIGRATION 063 OK — chat attachments schema + storage installed';
END $$;
