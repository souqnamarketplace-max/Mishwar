-- =============================================================================
-- مِشوار  — Admin-editable content tables
-- =============================================================================
-- Closes items 1, 2, 3, 4, 7 from docs/HARDCODED-CONTENT-AUDIT.md by giving
-- each of these things a real backing store + admin-editable interface,
-- so launch-day there's no fake data and post-launch they can be edited
-- without a deploy.
--
--   testimonials      — user testimonials carousel (TrustBadges.jsx)
--   team_members      — about-us team grid (AboutUs.jsx)
--   blog_posts        — blog page (Blog.jsx)
--   app_settings      — adds:
--                         hero_badge_text (replaces hardcoded "+10,000 user")
--                         public_stats_enabled (gate for the StatsBar)
--                         public_stats_min_users (threshold to show stats)
--
-- Pattern matches existing tables (announcements, support_tickets):
--   - Public SELECT for is_published / is_active rows
--   - INSERT/UPDATE/DELETE restricted to admins via auth_user_role() = 'admin'
--   - Standard timestamps + soft-delete via is_published flag
--
-- IDEMPOTENT — safe to re-run.
-- =============================================================================


-- =============================================================================
-- 1) TESTIMONIALS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.testimonials (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT,
  -- Display fields
  display_name TEXT     NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  city         TEXT     CHECK (length(city) <= 60),
  role         TEXT     CHECK (role IN ('passenger','driver','both')),
  avatar_letter TEXT    CHECK (length(avatar_letter) <= 4),  -- single Arabic char usually
  text         TEXT     NOT NULL CHECK (length(text) BETWEEN 5 AND 600),
  rating       SMALLINT CHECK (rating BETWEEN 1 AND 5),
  route        TEXT     CHECK (length(route) <= 80),  -- e.g. "رام الله ← نابلس"
  -- Order + visibility
  is_published BOOLEAN  NOT NULL DEFAULT FALSE,
  sort_order   INTEGER  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_testimonials_published_order
  ON public.testimonials (is_published, sort_order)
  WHERE is_published = TRUE;

ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "testimonials_select_published" ON public.testimonials;
CREATE POLICY "testimonials_select_published" ON public.testimonials
  FOR SELECT USING (is_published = TRUE OR public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "testimonials_insert_admin" ON public.testimonials;
CREATE POLICY "testimonials_insert_admin" ON public.testimonials
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "testimonials_update_admin" ON public.testimonials;
CREATE POLICY "testimonials_update_admin" ON public.testimonials
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "testimonials_delete_admin" ON public.testimonials;
CREATE POLICY "testimonials_delete_admin" ON public.testimonials
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');


-- =============================================================================
-- 2) TEAM MEMBERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.team_members (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT,
  -- Display fields
  full_name    TEXT     NOT NULL CHECK (length(full_name) BETWEEN 1 AND 100),
  role_title   TEXT     CHECK (length(role_title) <= 100),  -- e.g. "المؤسس"
  emoji        TEXT     CHECK (length(emoji) <= 8),         -- displayed if no avatar
  avatar_url   TEXT     CHECK (length(avatar_url) <= 1000),
  bio          TEXT     CHECK (length(bio) <= 500),
  -- Order + visibility
  is_published BOOLEAN  NOT NULL DEFAULT TRUE,
  sort_order   INTEGER  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_team_members_published_order
  ON public.team_members (is_published, sort_order)
  WHERE is_published = TRUE;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_select_published" ON public.team_members;
CREATE POLICY "team_select_published" ON public.team_members
  FOR SELECT USING (is_published = TRUE OR public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "team_insert_admin" ON public.team_members;
CREATE POLICY "team_insert_admin" ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "team_update_admin" ON public.team_members;
CREATE POLICY "team_update_admin" ON public.team_members
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "team_delete_admin" ON public.team_members;
CREATE POLICY "team_delete_admin" ON public.team_members
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');


-- =============================================================================
-- 3) BLOG POSTS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT,
  published_at TIMESTAMPTZ,
  -- Display fields
  title        TEXT     NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  slug         TEXT     UNIQUE CHECK (length(slug) <= 200),  -- URL-friendly, optional
  excerpt      TEXT     CHECK (length(excerpt) <= 500),
  body         TEXT     CHECK (length(body) <= 50000),       -- markdown
  emoji        TEXT     CHECK (length(emoji) <= 8),
  category     TEXT     CHECK (length(category) <= 60),
  cover_url    TEXT     CHECK (length(cover_url) <= 1000),
  author_name  TEXT     CHECK (length(author_name) <= 100),
  -- Visibility
  is_published BOOLEAN  NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published_date
  ON public.blog_posts (is_published, published_at DESC)
  WHERE is_published = TRUE;

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blog_select_published" ON public.blog_posts;
CREATE POLICY "blog_select_published" ON public.blog_posts
  FOR SELECT USING (is_published = TRUE OR public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "blog_insert_admin" ON public.blog_posts;
CREATE POLICY "blog_insert_admin" ON public.blog_posts
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "blog_update_admin" ON public.blog_posts;
CREATE POLICY "blog_update_admin" ON public.blog_posts
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "blog_delete_admin" ON public.blog_posts;
CREATE POLICY "blog_delete_admin" ON public.blog_posts
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');


-- =============================================================================
-- 4) APP SETTINGS — new columns for the hero badge + stats toggle
-- =============================================================================
DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS hero_badge_text TEXT
    CHECK (hero_badge_text IS NULL OR length(hero_badge_text) <= 200);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS public_stats_enabled BOOLEAN DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS public_stats_min_users INTEGER DEFAULT 100;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD COLUMN IF NOT EXISTS commission_label_visible BOOLEAN DEFAULT TRUE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;


-- =============================================================================
-- VERIFICATION
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE '────────────────────────────────────────────────────────';

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'testimonials')
  THEN RAISE NOTICE '✓ public.testimonials table installed';
  ELSE RAISE WARNING '✗ public.testimonials missing'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'team_members')
  THEN RAISE NOTICE '✓ public.team_members table installed';
  ELSE RAISE WARNING '✗ public.team_members missing'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'blog_posts')
  THEN RAISE NOTICE '✓ public.blog_posts table installed';
  ELSE RAISE WARNING '✗ public.blog_posts missing'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'app_settings'
               AND column_name = 'hero_badge_text')
  THEN RAISE NOTICE '✓ app_settings.hero_badge_text column added';
  ELSE RAISE WARNING '✗ app_settings.hero_badge_text missing'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'app_settings'
               AND column_name = 'public_stats_enabled')
  THEN RAISE NOTICE '✓ app_settings.public_stats_enabled column added';
  ELSE RAISE WARNING '✗ app_settings.public_stats_enabled missing'; END IF;

  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'After this migration:';
  RAISE NOTICE '  - All four sections (testimonials, team, blog, hero badge,';
  RAISE NOTICE '    stats bar) will render NOTHING until admin populates';
  RAISE NOTICE '    the corresponding tables / settings via the dashboard.';
  RAISE NOTICE '  - This is the correct launch-day state — no fake content.';
  RAISE NOTICE '────────────────────────────────────────────────────────';
END $$;
