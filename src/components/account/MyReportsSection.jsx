/**
 * MyReportsSection — reports the current user has filed against others.
 *
 * Closes the "I reported someone, what happened?" loop. Users would file
 * a report from the 3-dot menu, see a single thank-you toast, then never
 * hear back regardless of admin action. This screen lists their reports
 * with the current admin-set status (pending / reviewed / action_taken /
 * dismissed) plus admin_note when the admin left one. Admin actions also
 * push a notification to the reporter (wired in DashboardReports), so this
 * page is the long-form view of what the bell told them.
 *
 * Reports filed AGAINST the user are intentionally not shown — surfacing
 * "someone reported you" would just let bad actors confirm whether they
 * got away with something. Admins handle those silently.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Flag, Clock, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { REPORT_CATEGORIES } from "@/lib/blockUtils";

const STATUS_DISPLAY = {
  pending:      { label: "قيد المراجعة", icon: Clock,         className: "bg-yellow-500/10 text-yellow-700" },
  reviewed:     { label: "تمت المراجعة", icon: CheckCircle2,  className: "bg-blue-500/10 text-blue-700" },
  action_taken: { label: "تم اتخاذ إجراء", icon: ShieldCheck,  className: "bg-green-500/10 text-green-700" },
  dismissed:    { label: "مرفوض",         icon: XCircle,       className: "bg-muted text-muted-foreground" },
};

const CATEGORY_BY_ID = Object.fromEntries(REPORT_CATEGORIES.map(c => [c.id, c.label]));

export default function MyReportsSection({ user }) {
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["my-reports", user?.email],
    queryFn: () => user?.email
      ? base44.entities.UserReport.filter({ reporter_email: user.email }, "-created_at", 100)
      : [],
    enabled: !!user?.email,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>;
  }

  if (!reports.length) {
    return (
      <div className="text-center py-10">
        <Flag className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground mb-1">لم تقدم أي بلاغات</p>
        <p className="text-xs text-muted-foreground">
          يمكنك الإبلاغ عن أي مستخدم من قائمة الخيارات (⋮) في صفحته الشخصية أو في رحلة.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        نراجع جميع البلاغات. ستُشعر هنا وفي جرس الإشعارات عندما يتم اتخاذ إجراء.
      </p>
      {reports.map((r) => {
        const status = STATUS_DISPLAY[r.status] || STATUS_DISPLAY.pending;
        const StatusIcon = status.icon;
        return (
          <div
            key={r.id}
            className="p-3 bg-muted/30 rounded-xl border border-border/50 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {CATEGORY_BY_ID[r.category] || r.category}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  ضد {r.reported_email}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${status.className}`}>
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>
            </div>
            {r.details && (
              <p className="text-xs text-foreground/80 bg-card/50 rounded-lg p-2 border border-border/30">
                {r.details}
              </p>
            )}
            {r.admin_note && (
              <div className="text-xs bg-primary/5 border border-primary/20 rounded-lg p-2">
                <p className="font-medium text-primary mb-0.5">رد الإدارة</p>
                <p className="text-foreground/80">{r.admin_note}</p>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              {r.created_at && new Date(r.created_at).toLocaleString("ar")}
            </p>
          </div>
        );
      })}
    </div>
  );
}
