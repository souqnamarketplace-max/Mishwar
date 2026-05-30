-- Migration 114: Recover audit_log_search + audit_log_facets RPCs
-- Applied: 2026-05-29
-- Used by DashboardLogs.jsx for the audit-log search interface.

CREATE OR REPLACE FUNCTION public.audit_log_facets()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', action, 'count', n) ORDER BY n DESC)
      FROM (SELECT action, COUNT(*)::int AS n FROM admin_audit_log GROUP BY action) a), '[]'::jsonb),
    'actors',  COALESCE((SELECT jsonb_agg(jsonb_build_object('email', admin_email, 'count', n) ORDER BY n DESC)
      FROM (SELECT admin_email, COUNT(*)::int AS n FROM admin_audit_log GROUP BY admin_email) a), '[]'::jsonb),
    'targetTypes', COALESCE((SELECT jsonb_agg(jsonb_build_object('target_type', target_type, 'count', n) ORDER BY n DESC)
      FROM (SELECT target_type, COUNT(*)::int AS n FROM admin_audit_log WHERE target_type IS NOT NULL GROUP BY target_type) a), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.audit_log_search(
  filter_type text DEFAULT 'all',
  search_text text DEFAULT NULL,
  search_email text DEFAULT NULL,
  date_from timestamptz DEFAULT NULL,
  date_to timestamptz DEFAULT NULL,
  page_param integer DEFAULT 1,
  page_size_param integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT id, created_at, admin_email, action, target_type, target_id, details, ip_address
    FROM admin_audit_log
    WHERE (filter_type = 'all' OR target_type = filter_type)
      AND (search_email IS NULL OR admin_email ILIKE '%' || search_email || '%')
      AND (search_text  IS NULL OR action ILIKE '%' || search_text || '%' OR target_id ILIKE '%' || search_text || '%' OR details::text ILIKE '%' || search_text || '%')
      AND (date_from IS NULL OR created_at >= date_from)
      AND (date_to   IS NULL OR created_at <  date_to)
  ),
  total AS (SELECT COUNT(*)::int AS n FROM filtered),
  page  AS (SELECT * FROM filtered ORDER BY created_at DESC LIMIT GREATEST(page_size_param,1) OFFSET GREATEST(page_param-1,0)*GREATEST(page_size_param,1))
  SELECT jsonb_build_object(
    'rows',       COALESCE((SELECT jsonb_agg(p.*) FROM page p), '[]'::jsonb),
    'total',      (SELECT n FROM total),
    'totalPages', GREATEST(CEIL((SELECT n FROM total)::numeric / GREATEST(page_size_param,1))::int, 1),
    'page',       page_param,
    'pageSize',   page_size_param
  );
$$;

REVOKE ALL ON FUNCTION public.audit_log_facets() FROM public, anon;
REVOKE ALL ON FUNCTION public.audit_log_search(text,text,text,timestamptz,timestamptz,integer,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_facets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_log_search(text,text,text,timestamptz,timestamptz,integer,integer) TO authenticated;
