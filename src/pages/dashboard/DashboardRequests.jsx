import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { logAdminAction } from "@/lib/adminAudit";
import { toast } from "sonner";
import { Inbox, Search, Filter, X, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Pagination from "@/components/dashboard/Pagination";
import RequestStatusBadge from "@/components/requests/RequestStatusBadge";
import { useConfirm } from "@/hooks/useConfirm";

/**
 * DashboardRequests — admin moderation list for trip_requests.
 *
 * Capabilities:
 *   - Status filter (open / matched / cancelled / expired / all)
 *   - Search by from/to city, passenger email
 *   - Per-row force-cancel with admin note (passenger gets notified
 *     in commit 5 once the notification wiring lands)
 *   - Stats panel: today / week / month / match rate / top routes
 *
 * RLS: admins are auto-passed by the trip_requests_select_admin policy
 * (migration 019). Cancel goes through cancel_trip_request RPC which
 * also enforces admin-only checks server-side.
 */

const STATUS_FILTERS = [
  { id: "all",       label: "الكل" },
  { id: "open",      label: "مفتوحة" },
  { id: "matched",   label: "تم الربط" },
  { id: "cancelled", label: "ملغاة" },
  { id: "expired",   label: "منتهية" },
];

const PAGE_SIZE = 25;

export default function DashboardRequests() {
  const qc = useQueryClient();

  // Realtime — admin sees changes instantly without manual refresh
  React.useEffect(() => {
    const u = api.entities.TripRequest.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["trip_requests"] });
    });
    return () => u && u();
  }, []);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [page, setPage]     = useState(1);
  const [adminNotes, setAdminNotes] = useState({}); // per-row admin note
  // Confirmation before force-cancelling a passenger request. The
  // passenger receives a notification with the admin note, so we want
  // admins to deliberate before triggering it — accidental cancel
  // would send a confusing message to a real user.
  const { confirm, dialog: confirmDialog } = useConfirm();

  const { data: pageData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["admin-trip-requests", filter, page, search],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      let q = supabase
        .from("trip_requests")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (filter !== "all") q = q.eq("status", filter);
      if (search?.trim()) {
        const s = search.trim();
        q = q.or(
          `from_city.ilike.%${s}%,to_city.ilike.%${s}%,passenger_email.ilike.%${s}%,passenger_name.ilike.%${s}%`
        );
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return {
        rows:       data || [],
        total:      count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
      };
    },
  });

  // Stats — independent of filter/page. Capped at 5000 rows for perf;
  // beyond that count we'd want a SQL aggregation RPC instead.
  const { data: allRequests = [] } = useQuery({
    queryKey: ["admin-trip-requests-all-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_requests")
        .select("created_at,status,from_city,to_city")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const stats = React.useMemo(() => {
    const now    = Date.now();
    const day    = 24 * 3600 * 1000;
    const todayN = allRequests.filter(r => now - new Date(r.created_at).getTime() < day).length;
    const weekN  = allRequests.filter(r => now - new Date(r.created_at).getTime() < 7 * day).length;
    const monthN = allRequests.filter(r => now - new Date(r.created_at).getTime() < 30 * day).length;
    const matchedN = allRequests.filter(r => r.status === "matched").length;
    const totalN   = allRequests.length;
    const matchRate = totalN > 0 ? (matchedN / totalN) * 100 : 0;

    // Top 5 routes by frequency
    const routeFreq = new Map();
    for (const r of allRequests) {
      const k = `${r.from_city} → ${r.to_city}`;
      routeFreq.set(k, (routeFreq.get(k) || 0) + 1);
    }
    const topRoutes = [...routeFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { todayN, weekN, monthN, matchRate, topRoutes };
  }, [allRequests]);

  const cancelMutation = useMutation({
    mutationFn: async ({ id, note }) => {
      const { error } = await supabase.rpc("cancel_trip_request", {
        p_request_id: id,
        p_admin_note: note || null,
      });
      if (error) throw error;
      try { await logAdminAction("admin_cancel_trip_request", "trip_request", id, { admin_note: note || null }); } catch {}
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-trip-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-trip-requests-all-stats"] });
      toast.success("تم إلغاء الطلب");
    },
    onError: (err) => toast.error(friendlyError(err, "تعذر الإلغاء")),
  });

  const requests = pageData.rows;

  return (
    <div dir="rtl" className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">طلبات الركاب</h1>
        <p className="text-sm text-muted-foreground mt-1">
          إدارة وموديريشن طلبات الرحلات التي ينشرها الركاب
        </p>
      </div>

      {/* Stats panel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="اليوم"          value={stats.todayN}    color="text-primary"   bg="bg-primary/10" />
        <StatTile label="آخر 7 أيام"      value={stats.weekN}     color="text-blue-600"  bg="bg-blue-500/10" />
        <StatTile label="آخر 30 يوماً"    value={stats.monthN}    color="text-green-600" bg="bg-green-500/10" />
        <StatTile label="معدل الربط"     value={`${stats.matchRate.toFixed(0)}%`} color="text-amber-600" bg="bg-amber-500/10" />
      </div>

      {/* Top routes */}
      {stats.topRoutes.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4">
          <h3 className="text-sm font-bold text-foreground mb-3">أكثر المسارات طلباً</h3>
          <div className="space-y-1.5">
            {stats.topRoutes.map(([route, count]) => (
              <div key={route} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{route}</span>
                <span className="text-muted-foreground font-bold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => { setFilter(f.id); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.id ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="بحث في المسار، البريد، الاسم..."
            className="pr-10"
          />
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Inbox className="w-12 h-12 mx-auto text-muted-foreground opacity-40 mb-3" />
          <p className="text-sm text-muted-foreground">لا توجد طلبات تطابق الفلاتر</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {requests.map(r => (
              <AdminRequestCard
                key={r.id}
                request={r}
                note={adminNotes[r.id] || ""}
                setNote={(v) => setAdminNotes(prev => ({ ...prev, [r.id]: v }))}
                onCancel={async () => {
                  const ok = await confirm({
                    title: "إلغاء طلب الرحلة",
                    message: `سيتم إلغاء طلب ${r.passenger_email} (${r.from_city} ← ${r.to_city}). سيصل الراكب إشعار بالإلغاء${adminNotes[r.id] ? ' مع الملاحظة المُدخلة' : ''}.`,
                    confirmLabel: "تأكيد الإلغاء",
                    destructive: true,
                  });
                  if (ok) cancelMutation.mutate({ id: r.id, note: adminNotes[r.id] });
                }}
                cancelling={cancelMutation.isPending}
              />
            ))}
          </div>
          <Pagination
            currentPage={page}
            totalPages={pageData.totalPages}
            onPageChange={setPage}
            total={pageData.total}
          />
        </>
      )}
      {confirmDialog}
    </div>
  );
}

function StatTile({ label, value, color, bg }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-2`}>
        <Inbox className={`w-4 h-4 ${color}`} />
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function AdminRequestCard({ request: r, note, setNote, onCancel, cancelling }) {
  const PS_MONTHS = ["كانون الثاني","شباط","آذار","نيسان","أيار","حزيران","تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول"];
  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d + "T12:00:00");
    return `${dt.getDate()} ${PS_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground">{r.from_city} ← {r.to_city}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {r.passenger_name} ({r.passenger_email})
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {fmtDate(r.requested_date)}
            {r.requested_time && ` — ${r.requested_time.slice(0,5)}`}
            {" • "}
            {r.seats_needed} مقعد • ₪{r.suggested_price}
          </p>
          {r.notes && (
            <p className="text-xs text-foreground/70 bg-muted/40 rounded-lg p-2 mt-2 line-clamp-2">
              {r.notes}
            </p>
          )}
          {r.cancelled_by_admin && r.admin_note && (
            <div className="mt-2 bg-destructive/5 border border-destructive/20 rounded-lg p-2">
              <p className="text-[11px] font-bold text-destructive">ملاحظة الإدارة:</p>
              <p className="text-xs text-foreground/80">{r.admin_note}</p>
            </div>
          )}
        </div>
        <RequestStatusBadge status={r.status} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/60 pt-2">
        <span>{r.view_count || 0} مشاهدة</span>
        <span>{r.contact_count || 0} تواصل</span>
        <span>أُنشئ في {new Date(r.created_at).toLocaleDateString("ar-EG", { day:"numeric", month:"short" })}</span>
      </div>

      {(r.status === "open" || r.status === "matched") && (
        <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="سبب الإلغاء (اختياري) — سيظهر للراكب"
            className="text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={cancelling}
            className="w-full text-destructive border-destructive/30 hover:bg-destructive/5 gap-1"
          >
            <X className="w-3.5 h-3.5" />
            إلغاء قسري
          </Button>
        </div>
      )}
    </div>
  );
}
