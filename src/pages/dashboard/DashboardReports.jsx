import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Flag, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { REPORT_CATEGORIES } from "@/lib/blockUtils";
import { logAdminAction } from "@/lib/adminAudit";
import { notifyUser } from "@/lib/notifyUser";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";

const STATUS_LABELS = {
  pending: { label: "قيد المراجعة", color: "yellow" },
  reviewed: { label: "تمت المراجعة", color: "blue" },
  action_taken: { label: "تم اتخاذ إجراء", color: "green" },
  dismissed: { label: "مرفوض", color: "gray" },
};

// Arabic message shown to the reporter when admin marks the report
// done one way or the other. Kept separate so they can be tweaked
// without touching the action handler.
const REPORTER_NOTIF_BY_STATUS = {
  action_taken: {
    title: "تم اتخاذ إجراء على بلاغك ✓",
    body:  "شكراً على تنبيهنا. لقد راجعت الإدارة بلاغك واتخذت الإجراء المناسب.",
  },
  dismissed: {
    title: "تمت مراجعة بلاغك",
    body:  "راجعت الإدارة بلاغك ولم تجد ما يستوجب اتخاذ إجراء بناءً على المعلومات المتوفرة.",
  },
  reviewed: {
    title: "تمت مراجعة بلاغك",
    body:  "اطلعت الإدارة على بلاغك. سنتواصل معك إذا احتجنا إلى مزيد من التفاصيل.",
  },
};

export default function DashboardReports() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Per-row admin note typed into a textarea before clicking an action.
  // Stored in component state keyed by report id so each row has its own.
  const [adminNotes, setAdminNotes] = useState({});

  // ─── Bulk-select state ──────────────────────────────────────────────
  // Set of report IDs the admin has checked. Used to enable bulk action
  // buttons and to drive the "select all" tristate. Cleared on every
  // filter/page change so we don't accidentally action items that
  // scrolled out of view.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const setFilterAndReset       = (v) => { setFilter(v); setPage(1); clearSelection(); };
  const setSearchAndReset       = (v) => { setSearch(v); setPage(1); clearSelection(); };
  const setCategoryAndReset     = (v) => { setCategoryFilter(v); setPage(1); clearSelection(); };
  const setDateRangeAndReset    = (v) => { setDateRangePreset(v); setPage(1); clearSelection(); };
  const setCustomFromAndReset   = (v) => { setCustomFrom(v); setPage(1); clearSelection(); };
  const setCustomToAndReset     = (v) => { setCustomTo(v); setPage(1); clearSelection(); };

  const { dateFrom, dateTo } = resolveDateRange(dateRangePreset, customFrom, customTo);

  const { data: reportsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["reports", filter, page, search, categoryFilter, dateRangePreset, customFrom, customTo],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      let q = supabase
        .from("user_reports")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (filter !== "all")  q = q.eq("status", filter);
      if (categoryFilter)    q = q.eq("category", categoryFilter);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo)   q = q.lte("created_at", dateTo);
      if (search?.trim()) {
        const s = search.trim();
        q = q.or(`reporter_email.ilike.%${s}%,reported_email.ilike.%${s}%,description.ilike.%${s}%`);
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
  const reports = reportsData.rows;
  const totalReports = reportsData.total;
  const totalPages = reportsData.totalPages;

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const { error } = await supabase.from("user_reports").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["my-reports"] });
      toast.success("تم تحديث البلاغ");
    },
    onError: (err) => toast.error(friendlyError(err, "تعذر التحديث")),
  });

  /** Bulk-apply a status update to every selected report. Walks them
   *  one at a time (same path as individual handleAction but without
   *  the per-row admin note — bulk doesn't try to capture a personal
   *  note for each). Used for sweeping pending → dismissed when an
   *  obvious wave of spam reports comes in, or pending → reviewed
   *  when a batch has been triaged in another window. */
  const handleBulkAction = async (status) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const confirmMsg = status === "dismissed"
      ? `رفض ${ids.length} بلاغ؟`
      : status === "reviewed"
        ? `وضع علامة "تمت المراجعة" على ${ids.length} بلاغ؟`
        : `تطبيق "${status}" على ${ids.length} بلاغ؟`;
    if (!window.confirm(confirmMsg)) return;
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        const { error } = await supabase.from("user_reports").update({
          status,
          reviewed_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) throw error;
        // Audit-trail entry per item so we have a record of who
        // did the bulk action — otherwise bulk operations leave a
        // gap in the moderation log.
        try {
          await logAdminAction(`report_bulk_${status}`, "report", id, { bulk: true });
        } catch { /* non-fatal */ }
        ok++;
      } catch {
        fail++;
      }
    }
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["my-reports"] });
    if (fail === 0) toast.success(`تم تحديث ${ok} بلاغ`);
    else if (ok === 0) toast.error(`فشل تحديث ${fail} بلاغ`);
    else toast.warning(`نجح ${ok}، فشل ${fail}`);
    clearSelection();
  };

  const handleAction = async (report, status) => {
    const note = (adminNotes[report.id] || "").trim();

    // 1) Update the report row with status + optional admin note
    updateMutation.mutate({
      id: report.id,
      data: {
        status,
        reviewed_at: new Date().toISOString(),
        ...(note ? { admin_note: note } : {}),
      },
    });

    // 2) Notify the reporter so they can follow up on their submission.
    //    Without this, reporters never know their report was even seen.
    //    Routes through notifyUser → create_notification RPC (migration
    //    027) which handles cross-user authorization via Rule B (admin)
    //    and captures any failure to Sentry. Previously this was a
    //    direct insert wrapped in `catch { }` (no logging at all) — so
    //    every silently-failed notification was completely invisible.
    const notifTemplate = REPORTER_NOTIF_BY_STATUS[status];
    if (notifTemplate && report.reporter_email) {
      await notifyUser({
        user_email: report.reporter_email,
        title: notifTemplate.title,
        message: note
          ? `${notifTemplate.body}\n\nملاحظة الإدارة: ${note}`
          : notifTemplate.body,
        type: "report_update",
        link: "/settings?section=reports",
      });
    }

    // 3) Audit-trail entry so we have a record of who actioned what.
    try {
      await logAdminAction(
        `report_${status}`,
        "report",
        report.id,
        {
          reporter_email: report.reporter_email,
          reported_email: report.reported_email,
          category: report.category,
          admin_note: note || null,
        }
      );
    } catch {
      // Non-fatal.
    }

    // Clear the textarea after the action lands.
    setAdminNotes((prev) => {
      const next = { ...prev };
      delete next[report.id];
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <Flag className="w-7 h-7 text-yellow-600" />
        <h1 className="text-2xl font-bold text-foreground">بلاغات المستخدمين</h1>
      </div>

      <div className="flex gap-2 mb-3 overflow-x-auto">
        {["pending", "reviewed", "action_taken", "dismissed", "all"].map(f => (
          <button
            key={f}
            onClick={() => setFilterAndReset(f)}
            className={`px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {f === "all" ? "الكل" : STATUS_LABELS[f]?.label}
          </button>
        ))}
      </div>

      <DashboardFilterBar
        searchValue={search}
        onSearch={setSearchAndReset}
        searchPlaceholder="ابحث في إيميل المُبلِّغ أو المُبلَّغ عنه أو نص البلاغ..."
        selects={[
          {
            key: "category",
            value: categoryFilter,
            onChange: setCategoryAndReset,
            placeholder: "كل التصنيفات",
            options: Object.entries(REPORT_CATEGORIES).map(([k, v]) => ({
              value: k,
              label: v.label || k,
            })),
          },
        ]}
        dateRange={{
          value: dateRangePreset,
          onChange: setDateRangeAndReset,
          dateFrom: customFrom,
          dateTo: customTo,
          onDateFromChange: setCustomFromAndReset,
          onDateToChange: setCustomToAndReset,
        }}
        resultCount={totalReports}
      />

      {isLoading && <p className="text-muted-foreground">جارٍ التحميل...</p>}
      {!isLoading && reports.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>لا توجد بلاغات</p>
        </div>
      )}

      {/* ─── Bulk action bar — shown only when items are selected ─── */}
      {selectedIds.size > 0 && (
        <div className="bg-primary/10 border border-primary/30 rounded-2xl p-3 mb-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-primary">
            تم اختيار {selectedIds.size.toLocaleString("ar-EG")} بلاغ
          </span>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => handleBulkAction("reviewed")}
              className="rounded-lg text-xs"
            >
              وضع علامة "تمت المراجعة"
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBulkAction("dismissed")}
              className="rounded-lg text-xs"
            >
              رفض الكل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              className="rounded-lg text-xs"
            >
              إلغاء التحديد
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {reports.map(r => {
          const cat = REPORT_CATEGORIES.find(c => c.id === r.category);
          const stat = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
          return (
            <div key={r.id} className="bg-card rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                {/* Per-row select checkbox — shown to admins for bulk
                    actions. Only practical for "pending" status reports
                    in most cases but we render it for every row so
                    admins can do post-hoc bulk audits too. */}
                <input
                  type="checkbox"
                  checked={selectedIds.has(r.id)}
                  onChange={() => toggleSelect(r.id)}
                  className="mt-1.5 shrink-0 w-4 h-4 rounded cursor-pointer accent-primary"
                  aria-label={`تحديد البلاغ من ${r.reporter_email}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {r.reporter_email} ← <span className="text-destructive">{r.reported_email}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(r.created_at).toLocaleString("ar-EG")}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full bg-${stat.color}-500/10 text-${stat.color}-700 whitespace-nowrap`}>
                  {stat.label}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-medium">{cat?.label || r.category}</span>
              </div>
              {r.details && (
                <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg p-3 mb-3">
                  {r.details}
                </p>
              )}
              {r.context_type && r.context_id && (
                <p className="text-xs text-muted-foreground mb-3">
                  السياق: {r.context_type} #{r.context_id}
                </p>
              )}
              {/* Existing admin note (if any) — shown for already-actioned reports */}
              {r.admin_note && (
                <div className="text-xs bg-primary/5 border border-primary/20 rounded-lg p-2 mb-3">
                  <p className="font-medium text-primary mb-0.5">ملاحظة الإدارة</p>
                  <p className="text-foreground/80 whitespace-pre-wrap">{r.admin_note}</p>
                </div>
              )}
              {r.status === "pending" && (
                <div className="space-y-2">
                  {/* Optional admin note — sent to the reporter inside their
                      follow-up notification, persisted on the report row. */}
                  <textarea
                    value={adminNotes[r.id] || ""}
                    onChange={(e) =>
                      setAdminNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    placeholder="ملاحظة اختيارية للمستخدم المُبلِّغ (تُرسل ضمن الإشعار)"
                    rows={2}
                    className="w-full text-xs rounded-lg border border-border bg-background p-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg text-xs"
                      onClick={() => handleAction(r, "action_taken")}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 ml-1" />
                      تم اتخاذ إجراء
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg text-xs"
                      onClick={() => handleAction(r, "dismissed")}
                    >
                      <XCircle className="w-3.5 h-3.5 ml-1" />
                      رفض
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}
