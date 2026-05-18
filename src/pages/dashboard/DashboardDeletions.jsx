// ════════════════════════════════════════════════════════════════════
// DashboardDeletions — admin panel for account-deletion observability
// ════════════════════════════════════════════════════════════════════
//
// Reads from two RPCs (mig 088):
//   - admin_deletion_stats() → headline counts + reason breakdown +
//     account-type breakdown + 30-day daily series for the chart
//   - admin_deletion_list(p_limit) → recent deletions table
//
// Both RPCs are SECURITY DEFINER + role-gated to admins server-side.
// The dashboard treats anything-not-admin as "no data" — the route is
// already admin-only on the layout level, so there shouldn't be a
// non-admin reaching this anyway.
//
// Refresh policy: useQuery with 60s staleTime. The data doesn't change
// on a per-second cadence — admin checking in once a day is the
// realistic usage.
// ════════════════════════════════════════════════════════════════════

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Loader2, UserX, TrendingDown, Calendar, Users } from "lucide-react";

// Friendly Arabic labels for the canonical deletion reasons. Matches
// the dropdown values in AccountSettings.jsx. Anything outside this
// set falls through as-is (e.g. free-text "other" reasons).
const REASON_LABELS = {
  no_longer_needed:       "لم يعد بحاجة للتطبيق",
  found_alternative:      "وجد بديلاً أفضل",
  privacy:                "مخاوف الخصوصية",
  duplicate_account:      "حساب آخر مكرر",
  too_many_notifications: "إشعارات كثيرة",
  bad_experience:         "تجربة سيئة",
  other:                  "سبب آخر",
};

const ACCOUNT_TYPE_LABELS = {
  passenger: "راكب",
  driver:    "سائق",
  both:      "راكب وسائق",
  unknown:   "غير محدد",
};

function formatReason(raw) {
  if (!raw) return "لم يُحدَّد";
  return REASON_LABELS[raw] || raw;
}

function StatCard({ icon: Icon, label, value, hint, color = "primary" }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${color}/10`}>
          <Icon className={`w-4 h-4 text-${color}`} />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export default function DashboardDeletions() {
  // Stats RPC — headline numbers + reason map + daily series.
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ["admin-deletion-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_deletion_stats");
      if (error) throw error;
      if (data?.error === "admin_only") throw new Error("admin_only");
      return data;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Recent-deletions list (max 50). Separate query so the headline
  // panel can render before the list loads.
  const { data: list = [], isLoading: listLoading } = useQuery({
    queryKey: ["admin-deletion-list"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_deletion_list", { p_limit: 50 });
      if (error) throw error;
      if (data?.error) return [];
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Derive sorted reason rows for the breakdown table. JSON object
  // keys aren't iterated in deterministic order; we sort by count desc.
  const reasonRows = useMemo(() => {
    const raw = stats?.by_reason || {};
    return Object.entries(raw)
      .map(([key, count]) => ({ key, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  const accountTypeRows = useMemo(() => {
    const raw = stats?.by_account_type || {};
    return Object.entries(raw)
      .map(([key, count]) => ({ key, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  // Daily counts for the last 30 days. We need to backfill missing
  // days with zero so the bar chart renders a full 30-bar grid even
  // when most days have no deletions.
  const dailySeries = useMemo(() => {
    const map = new Map();
    (stats?.daily_last_30 || []).forEach((d) => {
      if (d?.date) map.set(d.date, Number(d.count) || 0);
    });
    const out = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().split("T")[0];
      out.push({ date: key, count: map.get(key) || 0 });
    }
    return out;
  }, [stats]);

  const maxDaily = useMemo(() => {
    return dailySeries.reduce((m, d) => Math.max(m, d.count), 1);
  }, [dailySeries]);

  // ── Render ────────────────────────────────────────────────────────
  if (statsError) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center" dir="rtl">
        <UserX className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">تعذّر تحميل إحصائيات الحذف</p>
        <p className="text-xs text-destructive mt-2">{String(statsError.message)}</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">حذف الحسابات</h1>
        <p className="text-sm text-muted-foreground mt-1">
          إحصائيات وأسباب حذف المستخدمين لحساباتهم. يساعدك على فهم سبب مغادرة المستخدمين.
        </p>
      </div>

      {/* Headline stats */}
      {statsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Users}
            label="إجمالي الحسابات المحذوفة"
            value={stats?.total_deleted ?? 0}
            color="primary"
          />
          <StatCard
            icon={Calendar}
            label="اليوم"
            value={stats?.deleted_today ?? 0}
            color="primary"
          />
          <StatCard
            icon={TrendingDown}
            label="هذا الأسبوع"
            value={stats?.deleted_this_week ?? 0}
            color="primary"
          />
          <StatCard
            icon={TrendingDown}
            label="هذا الشهر"
            value={stats?.deleted_this_month ?? 0}
            color="primary"
          />
        </div>
      )}

      {/* Two-column layout for breakdowns */}
      {!statsLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* By reason */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="text-base font-bold text-foreground mb-3">أسباب الحذف</h2>
            {reasonRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">لا توجد بيانات بعد</p>
            ) : (
              <div className="space-y-2">
                {reasonRows.map(({ key, count }) => {
                  const pct = stats?.total_deleted
                    ? Math.round((count / stats.total_deleted) * 100)
                    : 0;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-foreground">{formatReason(key)}</span>
                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* By account type */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="text-base font-bold text-foreground mb-3">نوع الحساب</h2>
            {accountTypeRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">لا توجد بيانات بعد</p>
            ) : (
              <div className="space-y-2">
                {accountTypeRows.map(({ key, count }) => {
                  const pct = stats?.total_deleted
                    ? Math.round((count / stats.total_deleted) * 100)
                    : 0;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-foreground">{ACCOUNT_TYPE_LABELS[key] || key}</span>
                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 30-day trend bar chart (lightweight inline SVG-less, just divs) */}
      {!statsLoading && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-base font-bold text-foreground mb-3">آخر 30 يوماً</h2>
          {stats?.total_deleted === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">لا توجد عمليات حذف بعد</p>
          ) : (
            <div className="flex items-end gap-1 h-32 px-1" aria-label="30-day deletion trend">
              {dailySeries.map((d) => {
                const heightPct = (d.count / maxDaily) * 100;
                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col items-center justify-end group relative"
                    title={`${d.date}: ${d.count}`}
                  >
                    <div
                      className={`w-full rounded-t transition-all ${
                        d.count > 0 ? "bg-primary" : "bg-muted/30"
                      }`}
                      style={{ height: d.count > 0 ? `${Math.max(8, heightPct)}%` : "4px" }}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2 px-1">
            <span>{dailySeries[0]?.date}</span>
            <span>اليوم</span>
          </div>
        </div>
      )}

      {/* Recent deletions list */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="text-base font-bold text-foreground mb-3">
          آخر الحسابات المحذوفة {list.length > 0 && <span className="text-muted-foreground font-normal">({list.length})</span>}
        </h2>
        {listLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">لا توجد عمليات حذف حتى الآن</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-right py-2 font-medium">التاريخ</th>
                  <th className="text-right py-2 font-medium">نوع الحساب</th>
                  <th className="text-right py-2 font-medium">السبب</th>
                  <th className="text-center py-2 font-medium">مدة العضوية</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2.5 text-foreground">
                      <div className="flex items-center gap-2">
                        <span>
                          {row.deleted_at ? new Date(row.deleted_at).toLocaleDateString("ar-EG", {
                            year: "numeric", month: "short", day: "numeric",
                          }) : "—"}
                        </span>
                        {/* Historical-orphan badge — these are deletions
                            from before mig 035 introduced the soft-delete
                            pattern. The profile was hard-deleted, so we
                            have the audit log entry but no reason or
                            account_type. Surfaced as a small badge so
                            admin understands why those fields are empty. */}
                        {row.source === "audit" && (
                          <span
                            className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground border border-border"
                            title="حذف قديم — البيانات التفصيلية غير متوفرة"
                          >
                            سجل قديم
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 text-foreground">
                      {ACCOUNT_TYPE_LABELS[row.account_type] || "—"}
                    </td>
                    <td className="py-2.5 text-foreground">
                      {formatReason(row.deletion_reason)}
                    </td>
                    <td className="py-2.5 text-center text-muted-foreground text-xs">
                      {row.days_active != null ? `${row.days_active} يوم` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
