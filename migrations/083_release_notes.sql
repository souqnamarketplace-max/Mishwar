-- ════════════════════════════════════════════════════════════════════════
-- Migration 083 — Release notes system ("What's new" in-app)
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY: User asked "how do I update users when new features are added?"
--
-- We already have a notifications table that could carry feature
-- announcements via type='admin_broadcast', but that's transient —
-- users dismiss the notification and the feature info is lost. For
-- a launching app shipping multiple features per week, we need a
-- PERSISTENT changelog that:
--   - Lives on its own page (/whats-new) the user can revisit
--   - Surfaces a badge in the navbar when there's unread content
--   - Marks-as-read per user, so the badge only shows for actually-new
--     entries
--   - Is editable by admin via /dashboard (no code change required
--     for each release)
--
-- ARCHITECTURE:
--
--   public.release_notes — admin-authored entries
--     id, title, body (markdown-ish), audience, published_at,
--     created_by, is_pinned, icon (lucide name string)
--
--   public.release_note_reads — per-user read tracking
--     user_email, release_note_id, read_at
--     Composite PK ensures one row per (user, note).
--
-- The audience column lets admin target subsets:
--   'all'        — everyone (default)
--   'drivers'    — anyone with role='driver' (or trip-creators)
--   'passengers' — everyone else
--   'admins'     — admin-only (internal release notes / dogfood)
--
-- Admin posts via a simple form in /dashboard. The form just INSERTs
-- a row — no code deploy needed. Users see new entries automatically
-- the next time they open the app.
--
-- USAGE EXAMPLES (admin SQL):
--
--   -- Announce the recurring trips feature to drivers only
--   INSERT INTO public.release_notes (title, body, audience, icon)
--   VALUES (
--     'الرحلات المتكررة 🔁',
--     'يمكنك الآن تعريف قالب رحلة ينشر تلقائياً كل يوم. اذهب إلى '||
--     '"رحلاتي" → "إدارة الرحلات المتكررة" للبدء.',
--     'drivers',
--     'Repeat'
--   );
--
--   -- Announce a passenger feature
--   INSERT INTO public.release_notes (title, body, audience, icon)
--   VALUES (
--     'سائقون مفضلون ⭐',
--     'احفظ السائقين الذين أعجبوك. سنشعرك عندما ينشرون رحلات جديدة.',
--     'passengers',
--     'Heart'
--   );
--
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. release_notes table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.release_notes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body          TEXT NOT NULL CHECK (length(body)  BETWEEN 1 AND 5000),
  -- Target audience. Frontend filters the /whats-new feed by this.
  audience      TEXT NOT NULL DEFAULT 'all'
                  CHECK (audience IN ('all', 'drivers', 'passengers', 'admins')),
  -- Optional lucide-react icon name (e.g. 'Repeat', 'Heart', 'Sparkles').
  -- Frontend imports lucide dynamically. If unknown, falls back to 'Sparkles'.
  icon          TEXT,
  -- Pinned entries float to the top of the feed regardless of date —
  -- useful for major launches like 'V1 is live' that should stay
  -- visible for weeks.
  is_pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  -- When the entry becomes visible to users. Defaults to creation
  -- time but admin can schedule (e.g. set to a future date to
  -- coordinate with a marketing push).
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_notes_published
  ON public.release_notes (published_at DESC);
-- Removed `WHERE published_at <= NOW()` partial-index predicate.
-- Postgres requires partial-index predicates to be IMMUTABLE, and
-- NOW() is STABLE (its value changes per transaction). The original
-- intent was to skip indexing future-published notes, but the table
-- will never grow beyond a few hundred rows (admin-authored
-- release notes over the app lifetime) so a full index is fine.

-- ─── 2. release_note_reads (per-user read tracking) ─────────────────

CREATE TABLE IF NOT EXISTS public.release_note_reads (
  user_email       TEXT NOT NULL,
  release_note_id  UUID NOT NULL REFERENCES public.release_notes(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_email, release_note_id)
);

CREATE INDEX IF NOT EXISTS idx_release_note_reads_user
  ON public.release_note_reads (user_email);

-- ─── 3. RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.release_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_note_reads ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read published notes meant for their audience.
-- We don't filter by role here (passengers see 'all' AND 'passengers';
-- drivers see 'all' AND 'drivers') because the frontend handles role
-- filtering — the RLS just gates published vs draft. This keeps the
-- policy simple and indexable.
DROP POLICY IF EXISTS "release_notes_read_published" ON public.release_notes;
CREATE POLICY "release_notes_read_published" ON public.release_notes
  FOR SELECT TO authenticated, anon
  USING (published_at <= NOW() AND audience <> 'admins');

DROP POLICY IF EXISTS "release_notes_admin_all" ON public.release_notes;
CREATE POLICY "release_notes_admin_all" ON public.release_notes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- release_note_reads — each user owns their own read records
DROP POLICY IF EXISTS "release_note_reads_own" ON public.release_note_reads;
CREATE POLICY "release_note_reads_own" ON public.release_note_reads
  FOR ALL TO authenticated
  USING  (user_email = auth.email())
  WITH CHECK (user_email = auth.email());

-- ─── 4. RPCs ────────────────────────────────────────────────────────

-- Mark a release note as read for the current user. Idempotent —
-- repeating the call is cheap and doesn't update the read_at to
-- the new time (we want first-read time, not last-read time).
CREATE OR REPLACE FUNCTION public.mark_release_note_read(p_note_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := auth.email();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.release_note_reads (user_email, release_note_id)
  VALUES (v_email, p_note_id)
  ON CONFLICT (user_email, release_note_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_release_note_read(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_release_note_read(UUID) TO authenticated;

-- Count of unread release notes for the current user. Used by the
-- navbar badge to show 'X new updates'.
CREATE OR REPLACE FUNCTION public.unread_release_notes_count()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_email TEXT;
  v_count INTEGER;
BEGIN
  v_email := auth.email();
  IF v_email IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.release_notes rn
   WHERE rn.published_at <= NOW()
     AND rn.audience <> 'admins'
     AND NOT EXISTS (
       SELECT 1 FROM public.release_note_reads rr
        WHERE rr.user_email = v_email
          AND rr.release_note_id = rn.id
     );

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.unread_release_notes_count() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.unread_release_notes_count() TO authenticated;

-- updated_at trigger (re-use canonical helper if present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_release_notes_updated_at ON public.release_notes';
    EXECUTE 'CREATE TRIGGER trg_release_notes_updated_at
             BEFORE UPDATE ON public.release_notes
             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;

COMMIT;

DO $$ BEGIN
  RAISE NOTICE 'MIGRATION 083 OK — release_notes table + RPCs ready';
  RAISE NOTICE '  Post a release note as admin via SQL:';
  RAISE NOTICE '    INSERT INTO public.release_notes (title, body, audience, icon, created_by)';
  RAISE NOTICE '    VALUES (''الرحلات المتكررة'', ''ميزة جديدة...'', ''drivers'', ''Repeat'', ''souqnamarketplace@gmail.com'');';
END $$;
