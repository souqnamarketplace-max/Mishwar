import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Flag, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { REPORT_CATEGORIES } from "@/lib/blockUtils";
import { logAdminAction } from "@/lib/adminAudit";
import Pagination from "@/components/dashboard/Pagination";

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
  // Per-row admin note typed into a textarea before clicking an action.
  // Stored in component state keyed by report id so each row has its own.
  const [adminNotes, setAdminNotes] = useState({});

  // Server-side pagination — was Report.filter(..., 200) before, which
  // hard-capped at the latest 200 reports system-wide. At 100k users a
  // pending report from week 2 would fall off the visible list within
  // days. Now: 25 per page, infinite scroll-back via pager.
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const { data: reportsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["reports", filter, page],
    queryFn: () => base44.entities.UserReport.paginate({
      page,
      pageSize: PAGE_SIZE,
      sort: "-created_at",
      conditions: filter === "all" ? {} : { status: filter },
    }),
  });
  const reports = reportsData.rows;
  const totalPages = reportsData.totalPages;

  // When filter changes (status tab tapped), reset to page 1 — otherwise
  // admin clicking 'pending' from page 5 of 'all' would land on an empty
  // page-5-of-pending if there aren't that many pending reports.
  const setFilterAndReset = (next) => { setFilter(next); setPage(1); };

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UserReport.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["my-reports"] });
      toast.success("تم تحديث البلاغ");
    },
    onError: () => toast.error("فشل التحديث"),
  });

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
    const notifTemplate = REPORTER_NOTIF_BY_STATUS[status];
    if (notifTemplate && report.reporter_email) {
      try {
        await base44.entities.Notification.create({
          user_email: report.reporter_email,
          title: notifTemplate.title,
          message: note
            ? `${notifTemplate.body}\n\nملاحظة الإدارة: ${note}`
            : notifTemplate.body,
          type: "system",
          is_read: false,
        });
      } catch {
        // Non-fatal — the admin update already succeeded.
      }
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

      <div className="flex gap-2 mb-6 overflow-x-auto">
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

      {isLoading && <p className="text-muted-foreground">جارٍ التحميل...</p>}
      {!isLoading && reports.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>لا توجد بلاغات</p>
        </div>
      )}

      <div className="space-y-3">
        {reports.map(r => {
          const cat = REPORT_CATEGORIES.find(c => c.id === r.category);
          const stat = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
          return (
            <div key={r.id} className="bg-card rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
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
