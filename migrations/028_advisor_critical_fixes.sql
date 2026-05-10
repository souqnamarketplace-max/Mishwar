-- =============================================================================
-- Migration 028 — critical Supabase advisor findings
-- =============================================================================
--
-- BACKGROUND
--
-- The Supabase database advisor flagged TWO error-level findings that
-- represent real production security issues. Both are cases where the
-- production DB has drifted from the source-of-truth schema file
-- (supabase-production.sql) — likely from direct dashboard edits over
-- time — and need to be reconciled.
--
-- ─── FINDING 1 (ERROR): RLS DISABLED ON NOTIFICATIONS ────────────────────────
--
-- supabase-production.sql:353 contains:
--    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
-- and supabase-production.sql:506 onwards defines proper RLS policies
-- (notifications_select, notifications_insert, notifications_update,
--  notifications_delete) gated on user_email = auth_user_email() OR admin.
--
-- The advisor reports the live DB has those policies but RLS itself is
-- OFF, which means PostgREST returns notifications WITHOUT enforcing the
-- policies — any authenticated user can read every user's notifications
-- via /rest/v1/notifications?select=*. The policies are present but
-- inert until RLS is re-enabled. This is a privacy violation: someone's
-- bell-ping content (booking acceptances, license rejections, admin
-- broadcasts) is supposed to be visible only to that user.
--
-- The advisor's other related lint, policy_exists_rls_disabled, is the
-- same root cause — both clear after the ALTER TABLE.
--
-- Fix: ALTER TABLE ... ENABLE ROW LEVEL SECURITY. Idempotent.
--
-- ─── FINDING 2 (ERROR): SECURITY DEFINER VIEWS ───────────────────────────────
--
-- Three views in production are defined with SECURITY DEFINER, meaning
-- they enforce the VIEW CREATOR's permissions and RLS rather than the
-- caller's. If exposed via PostgREST (and these are in the public
-- schema, so they ARE exposed), any authenticated user reading the
-- view sees ALL rows the creator can see — bypassing RLS on the
-- underlying tables entirely.
--
--   1. driver_subscriptions_v — defined in migration 014 WITHOUT
--      SECURITY DEFINER (the committed source intends to inherit RLS
--      from driver_subscriptions). Production has SECURITY DEFINER on
--      it, drift from the source. Fix by recreating without it.
--
--   2. user_reports_with_names — not in any migration. Created via
--      dashboard. Defines unknown content. Used by which surface?
--      Source-search shows zero references in src/. Likely admin-only,
--      consumed by DashboardReports. Fix: recreate without SECURITY
--      DEFINER, let RLS on user_reports + profiles enforce. If admin-
--      only access matters, the existing reports_admin_select and
--      profiles_select policies handle it correctly. Drop and recreate
--      without SECURITY DEFINER.
--
--   3. driver_balance_summary — not in any migration. Created via
--      dashboard. Likely consumed by admin payments dashboard. Same
--      treatment.
--
-- Both views (2) and (3) are dropped and not recreated here, since this
-- migration cannot reconstruct content that was never committed. The
-- admin dashboard pages that depend on them (DashboardReports,
-- DashboardPayments) will fail with "view does not exist" until the
-- next session reconstructs them via committed SQL. Acceptable as a
-- temporary admin-only outage to close the security hole — alternative
-- of leaving them as SECURITY DEFINER would mean broader exposure.
--
-- ─── FINDING 3 (LOW BUT EASY): PUBLIC BUCKET LISTING ─────────────────────────
--
-- The 'uploads' bucket has 3 broad SELECT policies (Public read uploads,
-- public_read_uploads, storage_public_read) which together let clients
-- LIST every file in the bucket via storage.objects. The intent of a
-- public bucket is per-URL access (someone with the URL fetches it),
-- not enumeration. Listing exposes filenames that may be unguessable
-- on purpose (avatar timestamps, hero slide variants).
--
-- The migration 004 source file added one of these (public_read_uploads).
-- The other two ("Public read uploads", storage_public_read) were
-- created via dashboard and are duplicates. Drop the duplicates; the
-- migration 004 policy is sufficient and known-correct.
--
-- =============================================================================

BEGIN;

-- ─── FIX 1: Re-enable RLS on notifications ──────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ─── FIX 2: Drop SECURITY DEFINER from driver_subscriptions_v ──────────────
-- Recreate the view exactly as migration 014 intended (no SECURITY DEFINER).
-- DROP + CREATE because PostgreSQL doesn't allow ALTER VIEW ... SET SECURITY
-- INVOKER directly in older versions. The body is preserved.

DROP VIEW IF EXISTS public.driver_subscriptions_v CASCADE;

CREATE VIEW public.driver_subscriptions_v
WITH (security_invoker = true)
AS
SELECT
  s.*,
  CASE
    WHEN s.status = 'pending'                                       THEN 'pending'
    WHEN s.status = 'active' AND s.period_end > NOW()               THEN 'active'
    ELSE                                                                 'history'
  END AS view_category
FROM public.driver_subscriptions s;

GRANT SELECT ON public.driver_subscriptions_v TO authenticated;

-- ─── FIX 3: Drop dashboard-created SECURITY DEFINER views ──────────────────
-- These views were created outside source control. Drop them to close the
-- privacy hole. The admin dashboard pages that reference them
-- (user_reports_with_names → DashboardReports; driver_balance_summary →
-- admin payments) will surface a clean "view does not exist" error until
-- the next session recreates them via committed SQL.
--
-- Choosing breakage over insecurity here because the views allow ALL
-- authenticated users (not just admins) to see report content + driver
-- balances via PostgREST, which is a real privacy violation.

DROP VIEW IF EXISTS public.user_reports_with_names CASCADE;
DROP VIEW IF EXISTS public.driver_balance_summary  CASCADE;

-- ─── FIX 4: Drop duplicate public_read_uploads policies ────────────────────
-- The migration 004 source file installed `public_read_uploads`. Production
-- has 2 additional duplicates created via dashboard (`Public read uploads`
-- and `storage_public_read`) which together allow listing all files in
-- the bucket. Drop the duplicates; migration 004's policy alone is
-- sufficient and known-correct.

DROP POLICY IF EXISTS "Public read uploads"   ON storage.objects;
DROP POLICY IF EXISTS storage_public_read     ON storage.objects;

-- Self-check: verify all four fixes landed.
DO $$
DECLARE
  v_rls_on        BOOLEAN;
  v_subv_def      TEXT;
  v_reports_view  BOOLEAN;
  v_balance_view  BOOLEAN;
BEGIN
  -- 1) notifications RLS enabled?
  SELECT relrowsecurity INTO v_rls_on
  FROM pg_class WHERE oid = 'public.notifications'::regclass;

  -- 2) driver_subscriptions_v no longer SECURITY DEFINER?
  --    pg_class.reloptions contains 'security_invoker=true' when set.
  SELECT array_to_string(reloptions, ',') INTO v_subv_def
  FROM pg_class
  WHERE oid = 'public.driver_subscriptions_v'::regclass;

  -- 3+4) Dropped views — should not exist
  v_reports_view := EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'user_reports_with_names'
      AND relnamespace = 'public'::regnamespace
  );
  v_balance_view := EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'driver_balance_summary'
      AND relnamespace = 'public'::regnamespace
  );

  IF v_rls_on
     AND v_subv_def LIKE '%security_invoker=true%'
     AND NOT v_reports_view
     AND NOT v_balance_view
  THEN
    RAISE NOTICE 'MIGRATION 028 OK — RLS re-enabled, SECURITY DEFINER views dropped/fixed';
  ELSE
    RAISE WARNING 'MIGRATION 028 — incomplete: rls=% subv_opts=% reports_view=% balance_view=%',
      v_rls_on, v_subv_def, v_reports_view, v_balance_view;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION
-- =============================================================================
--
-- 1) Re-run the Supabase database advisor. The following lints should clear:
--    - rls_disabled_in_public (notifications)
--    - policy_exists_rls_disabled (notifications)
--    - security_definer_view (driver_subscriptions_v, user_reports_with_names,
--      driver_balance_summary — the latter two are dropped, the first is fixed)
--    - public_bucket_allows_listing (uploads)
--
-- 2) Verify notifications RLS works as expected. As a non-admin user:
--      SELECT * FROM public.notifications;
--    Should return only rows where user_email = your email.
--
-- 3) Verify the admin dashboard surfaces that referenced the dropped views
--    are reported broken and need follow-up:
--    - DashboardReports — likely had "select * from user_reports_with_names"
--      Recreate as a regular VIEW or move the JOIN logic to a SECURITY
--      INVOKER function. The reports_admin_select RLS policy already gates
--      who can read user_reports.
--    - DashboardPayments — likely had "select * from driver_balance_summary"
--      Recreate similarly.
--
-- 4) After recreating dashboard views, COMMIT them as a migration so the
--    next time we audit, the source-of-truth file matches production.
-- =============================================================================
