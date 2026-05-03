import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Flag, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { REPORT_CATEGORIES } from "@/lib/blockUtils";

const STATUS_LABELS = {
  pending: { label: "قيد المراجعة", color: "yellow" },
  reviewed: { label: "تمت المراجعة", color: "blue" },
  action_taken: { label: "تم اتخاذ إجراء", color: "green" },
  dismissed: { label: "مرفوض", color: "gray" },
};

export default function DashboardReports() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("pending");

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["reports", filter],
    queryFn: () => base44.entities.UserReport.filter(
      filter === "all" ? {} : { status: filter },
      "-created_at",
      200
    ),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UserReport.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("تم تحديث البلاغ");
    },
    onError: () => toast.error("فشل التحديث"),
  });

  const handleAction = (report, status) => {
    updateMutation.mutate({
      id: report.id,
      data: {
        status,
        reviewed_at: new Date().toISOString(),
      },
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
            onClick={() => setFilter(f)}
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
              {r.status === "pending" && (
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
