-- ════════════════════════════════════════════════════════════════════════
-- 089_deletion_stats_include_audit_log_orphans.sql
-- ════════════════════════════════════════════════════════════════════════
--
-- Backfills the admin deletion dashboard with historical deletions that
-- predate the soft-delete pattern (mig 035) and therefore have no row
-- in profiles.deleted_at.
--
-- ─── CONTEXT ──────────────────────────────────────────────────────────
--
-- Before mig 035, the deletion path on auth.users → CASCADE removed the
-- profile row entirely. The admin_audit_log still captured the event
-- (action='account_self_deleted'), but admin_deletion_stats() only
-- queries profiles, so those legacy events were invisible.
--
-- Investigation in production confirmed:
--   - 2 audit entries with action='account_self_deleted' exist
--   - Both have profile_still_exists=NULL (hard-deleted)
--   - Both have reason=NULL (old code didn't capture reasons)
--   - Both have account_type=NULL (no profile to read from)
--
-- ─── DESIGN DECISIONS ────────────────────────────────────────────────
--
-- 1. UNION the two sources, not fabricate profile rows
--    Inserting synthetic profiles with deleted_at would clash with
--    FK constraints (auth.users IDs are gone) and corrupt
--    "live users" counters elsewhere. The audit log is the canonical
--    source for "this deletion happened"; profiles is the canonical
--    source for "this user existed". Merging at the query layer is
--    correct.
--
-- 2. Dedupe by target_id taking the EARLIEST audit timestamp
--    If for any reason a deletion retried and re-logged, the first
--    entry is the canonical one. Practically unlikely (the original
--    code logs account_self_deleted ONLY after RPC success) but
--    defensive.
--
-- 3. Orphan entries show null reason / null account_type
--    The dashboard already handles these fields being null
--    (formatReason() returns "لم يُحدَّد" for null; ACCOUNT_TYPE_LABELS
--    falls back to "unknown" → "غير محدد"). No frontend change needed.
--
-- 4. The by_reason and by_account_type breakdowns INCLUDE orphan
--    entries in the "unknown" bucket so the headline totals match
--    the sum of the breakdowns.

BEGIN;

-- ─── 1. Updated admin_deletion_stats() — UNIONs both sources ────────────

CREATE OR REPLACE FUNCTION public.admin_deletion_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_role TEXT := public.auth_user_role();
  v_result      jsonb;
BEGIN
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'admin_only');
  END IF;

  -- ── Unified view of deletions: profile soft-deletes + audit orphans
  -- A CTE keeps the rest of the function readable. Each row has the
  -- shape (deleted_at TIMESTAMPTZ, deletion_reason TEXT, account_type TEXT)
  -- — null for fields we don't have for historical orphans.
  WITH unified_deletions AS (
    -- (A) Soft-deleted profile rows — the modern path
    SELECT p.deleted_at,
           NULLIF(TRIM(p.deletion_reason), '')  AS deletion_reason,
           p.account_type
      FROM public.profiles p
     WHERE p.deleted_at IS NOT NULL

    UNION ALL

    -- (B) Audit-log entries with no matching soft-deleted profile.
    -- The dedupe via DISTINCT ON keeps the FIRST audit entry per
    -- target_id so duplicates (theoretical, from retries) don't
    -- inflate the count.
    SELECT al.created_at      AS deleted_at,
           NULL::text          AS deletion_reason,   -- not captured by old path
           NULL::text          AS account_type       -- profile already gone
      FROM (
        SELECT DISTINCT ON (target_id)
               id, created_at, target_id
          FROM public.admin_audit_log
         WHERE action = 'account_self_deleted'
           AND target_id IS NOT NULL
         ORDER BY target_id, created_at ASC
      ) al
     WHERE NOT EXISTS (
       SELECT 1 FROM public.profiles p2
        WHERE p2.id::text = al.target_id
          AND p2.deleted_at IS NOT NULL
     )
  )
  SELECT jsonb_build_object(
    'total_deleted', (SELECT COUNT(*) FROM unified_deletions),
    'deleted_today', (
      SELECT COUNT(*) FROM unified_deletions
       WHERE deleted_at >= date_trunc('day', NOW())
    ),
    'deleted_this_week', (
      SELECT COUNT(*) FROM unified_deletions
       WHERE deleted_at >= date_trunc('week', NOW())
    ),
    'deleted_this_month', (
      SELECT COUNT(*) FROM unified_deletions
       WHERE deleted_at >= date_trunc('month', NOW())
    ),
    'by_reason', (
      SELECT COALESCE(jsonb_object_agg(reason_label, cnt), '{}'::jsonb)
        FROM (
          SELECT COALESCE(deletion_reason, 'لم يُحدَّد') AS reason_label,
                 COUNT(*) AS cnt
            FROM unified_deletions
           GROUP BY reason_label
           ORDER BY cnt DESC
           LIMIT 20
        ) r
    ),
    'by_account_type', (
      SELECT COALESCE(jsonb_object_agg(t, cnt), '{}'::jsonb)
        FROM (
          SELECT COALESCE(account_type, 'unknown') AS t,
                 COUNT(*) AS cnt
            FROM unified_deletions
           GROUP BY account_type
        ) a
    ),
    'daily_last_30', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day_str, 'count', cnt) ORDER BY day_str), '[]'::jsonb)
        FROM (
          SELECT to_char(date_trunc('day', deleted_at), 'YYYY-MM-DD') AS day_str,
                 COUNT(*) AS cnt
            FROM unified_deletions
           WHERE deleted_at >= NOW() - INTERVAL '30 days'
           GROUP BY day_str
        ) d
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_deletion_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deletion_stats() TO authenticated;

-- ─── 2. Updated admin_deletion_list() — same UNION pattern ──────────────

CREATE OR REPLACE FUNCTION public.admin_deletion_list(
  p_limit INT DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_caller_role TEXT := public.auth_user_role();
  v_result      jsonb;
BEGIN
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('error', 'admin_only');
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 50; END IF;
  IF p_limit > 200 THEN p_limit := 200; END IF;

  -- Same CTE pattern as admin_deletion_stats. id is built from the
  -- source row's id so React keys stay unique:
  --   - profile rows: use profiles.id directly
  --   - audit orphans: use the audit log entry's id (prefixed
  --     'audit-' so it never collides with a real profile UUID)
  WITH unified_deletions AS (
    SELECT p.id::text                                AS id,
           p.deleted_at,
           NULLIF(TRIM(p.deletion_reason), '')       AS deletion_reason,
           p.account_type,
           CASE
             WHEN p.created_at IS NOT NULL AND p.deleted_at IS NOT NULL
             THEN EXTRACT(DAY FROM (p.deleted_at - p.created_at))::int
             ELSE NULL
           END                                       AS days_active,
           'profile'::text                           AS source
      FROM public.profiles p
     WHERE p.deleted_at IS NOT NULL

    UNION ALL

    SELECT ('audit-' || al.id::text)                 AS id,
           al.created_at                             AS deleted_at,
           NULL::text                                AS deletion_reason,
           NULL::text                                AS account_type,
           NULL::int                                 AS days_active,
           'audit'::text                             AS source
      FROM (
        SELECT DISTINCT ON (target_id)
               id, created_at, target_id
          FROM public.admin_audit_log
         WHERE action = 'account_self_deleted'
           AND target_id IS NOT NULL
         ORDER BY target_id, created_at ASC
      ) al
     WHERE NOT EXISTS (
       SELECT 1 FROM public.profiles p2
        WHERE p2.id::text = al.target_id
          AND p2.deleted_at IS NOT NULL
     )
  )
  SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'deleted_at') DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'id',              ud.id,
        'deleted_at',      ud.deleted_at,
        'deletion_reason', ud.deletion_reason,
        'account_type',    ud.account_type,
        'days_active',     ud.days_active,
        'source',          ud.source
      ) AS row_data
        FROM unified_deletions ud
       ORDER BY ud.deleted_at DESC
       LIMIT p_limit
    ) sub;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_deletion_list(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deletion_list(INT) TO authenticated;

COMMIT;

-- ─── VERIFICATION ─────────────────────────────────────────────────────
--
--   -- After applying, as admin call:
--   SELECT public.admin_deletion_stats();
--   -- Expected (given your 2 historical orphans):
--   --   total_deleted        = 2
--   --   deleted_today        = 0
--   --   deleted_this_week    = 0  (depending on when you run this — both
--   --                              are from May 5-6 which may be in this
--   --                              week's window)
--   --   deleted_this_month   = 2  (both events are in May 2026)
--   --   by_reason            = {"لم يُحدَّد": 2}
--   --   by_account_type      = {"unknown": 2}
--   --   daily_last_30        = [{"date":"2026-05-05","count":1}, ...]
--
--   SELECT public.admin_deletion_list(50);
--   -- Expected: 2 rows, both with source='audit', null reason/account_type,
--   --          dated 2026-05-06 and 2026-05-05.
--
-- ─── FRONTEND IMPACT ─────────────────────────────────────────────────
--
-- The dashboard already handles null reason / null account_type
-- gracefully (renders as "لم يُحدَّد" / "غير محدد"). No frontend
-- changes needed. After applying this migration + hard-refreshing the
-- /dashboard?tab=deletions page, the 2 historical deletions will appear
-- in the headline counts, the breakdown panels (in the "unknown"
-- buckets), and the recent-deletions list.
