/**
 * adminPaginate — shared helper for paginated Supabase queries used in
 * the admin dashboard.
 *
 * Why this exists
 * ───────────────
 * Every dashboard tab originally called base44.entities.X.paginate(...).
 * The base44 SDK auto-injects a `created_by = auth.email()` filter on
 * every entity read, which means an admin sees only the rows they
 * themselves created — usually zero. Live counts vs what admin saw
 * on production:
 *
 *   trips=9  bookings=8  driver_licenses=4  notifications=26
 *   support_tickets=3  user_reports=5  trip_requests=1
 *
 *   …and admin saw 0 of most of these.
 *
 * Direct supabase queries respect RLS instead. RLS policies for the
 * admin dashboard already permit role='admin' to read every row across
 * the relevant tables (set up in earlier hardening migrations 002 +
 * 008-016). So switching to supabase fixes the data-blindness without
 * any RLS changes.
 *
 * Why a helper instead of inline supabase.from(...).range() everywhere
 * ────────────────────────────────────────────────────────────────────
 * Pagination + count + ordering is the same boilerplate at every
 * call-site. Centralizing it:
 *   1. ensures consistent shape ({rows, total, totalPages}) so existing
 *      destructuring patterns in the dashboard pages keep working
 *   2. makes future cross-cutting changes (e.g. switching to keyset
 *      pagination, adding telemetry) a one-file edit
 *   3. eliminates copy-paste errors in `.range(from, to)` math
 *
 * Usage
 * ─────
 *   const { data: tripsData = { rows: [], total: 0, totalPages: 1 } } = useQuery({
 *     queryKey: ["trips", page],
 *     queryFn: () => adminPaginate("trips", { page, pageSize: 50,
 *                                             orderBy: "created_at",
 *                                             ascending: false }),
 *   });
 *
 * Optional filters / search:
 *   adminPaginate("driver_licenses", {
 *     page, pageSize: 50,
 *     filters: { status: "pending" },          // .eq() each entry
 *     ilike: { driver_email: `%${q}%` },       // .ilike() each entry
 *   });
 *
 * If you need a richer query (joins, custom or-filters, etc.), call
 * supabase.from(...) directly — this helper covers the 95% case only.
 */

import { supabase } from "@/lib/supabase";

/**
 * @param {string} table  Postgres table name (e.g. "trips")
 * @param {object} opts
 * @param {number} [opts.page=1]            1-indexed page number
 * @param {number} [opts.pageSize=50]       rows per page
 * @param {string} [opts.select="*"]        select expression
 * @param {string} [opts.orderBy="created_at"]  column to order by
 * @param {boolean} [opts.ascending=false]  order direction
 * @param {Object<string,any>} [opts.filters]  exact-match filters via .eq()
 * @param {Object<string,string>} [opts.ilike]  case-insensitive LIKE via .ilike()
 * @returns {Promise<{rows:any[],total:number,totalPages:number}>}
 */
export async function adminPaginate(table, {
  page       = 1,
  pageSize   = 50,
  select     = "*",
  orderBy    = "created_at",
  ascending  = false,
  filters    = {},
  ilike      = {},
} = {}) {
  const from = (page - 1) * pageSize;
  const to   = from + pageSize - 1;

  let q = supabase
    .from(table)
    .select(select, { count: "exact" })
    .order(orderBy, { ascending })
    .range(from, to);

  // .eq() each filter
  for (const [col, val] of Object.entries(filters)) {
    if (val === undefined || val === null || val === "") continue;
    q = q.eq(col, val);
  }
  // .ilike() each pattern (caller is responsible for the % wildcards)
  for (const [col, pattern] of Object.entries(ilike)) {
    if (!pattern) continue;
    q = q.ilike(col, pattern);
  }

  const { data, error, count } = await q;
  if (error) throw error;

  return {
    rows:       data || [],
    total:      count || 0,
    totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
  };
}

/**
 * adminListAll — fetch ALL rows of a small table (no pagination).
 *
 * Use ONLY for small reference tables (app_settings, etc.) where the row
 * count is bounded by config (single digits to low hundreds). For
 * anything user-generated, use adminPaginate.
 */
export async function adminListAll(table, {
  select    = "*",
  orderBy   = "created_at",
  ascending = false,
  filters   = {},
} = {}) {
  let q = supabase.from(table).select(select).order(orderBy, { ascending });
  for (const [col, val] of Object.entries(filters)) {
    if (val === undefined || val === null || val === "") continue;
    q = q.eq(col, val);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
