import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Shield, Flag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { invalidateBlockCache, REPORT_CATEGORIES } from "@/lib/blockUtils";
import { toast } from "sonner";
import { createPortal } from "react-dom";

/**
 * Drop-in 3-dot menu for "Block user" + "Report user".
 * Use on trip cards, profile pages, message threads.
 *
 * Props:
 *   targetEmail   — the email of the user to act on
 *   targetName    — display name (for confirmation messages)
 *   contextType   — 'trip' | 'message' | 'profile' (optional, for reports)
 *   contextId     — id of the trip/message/profile (optional)
 */
export default function UserActionsMenu({ targetEmail, targetName, contextType, contextId }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportCategory, setReportCategory] = useState("");

  // Don't show menu if targeting self or no user
  if (!user || !targetEmail || user.email === targetEmail) return null;

  const blockMutation = useMutation({
    mutationFn: () => base44.entities.UserBlock.create({
      blocker_email: user.email,
      blocked_email: targetEmail,
    }),
    onSuccess: () => {
      invalidateBlockCache();
      toast.success("تم حظر المستخدم");
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["search-trips"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      // Existing chat threads + per-thread message lists must vanish
      // immediately. Without these invalidations the message inbox keeps
      // showing the conversation, the thread keeps loading, and the user
      // can keep typing into someone they just blocked.
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["my-blocks", user.email] });
      qc.invalidateQueries({ queryKey: ["my-blocks-list", user.email] });
      setShowBlock(false);
      setOpen(false);
    },
    onError: () => toast.error("فشل حظر المستخدم"),
  });

  const reportMutation = useMutation({
    mutationFn: async (data) => {
      // 1) Persist the report itself
      const report = await base44.entities.UserReport.create({
        reporter_email: user.email,
        reported_email: targetEmail,
        category: data.category,
        details: data.details || null,
        context_type: contextType || null,
        context_id: contextId || null,
      });

      // 2) Notify admins so reports don't sit unseen in the dashboard.
      // The notif goes to the souqnamarketplace@gmail.com admin account
      // (same channel already used for license-verification submissions
      // in Onboarding.jsx). Wrapped in try/catch so a notification failure
      // doesn't poison the report submission itself.
      try {
        await base44.entities.Notification.create({
          user_email: "souqnamarketplace@gmail.com",
          title: "بلاغ جديد من مستخدم 🚩",
          message: `${user.full_name || user.email} قدّم بلاغاً ضد ${targetEmail}. السبب: ${data.category}`,
          type: "system",
          is_read: false,
        });
      } catch {
        // The report is already saved — silent failure here just means
        // admins find it via the dashboard's pending filter instead of
        // the bell. Acceptable.
      }
      return report;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-reports", user.email] });
      toast.success("تم إرسال البلاغ — شكراً لك");
      setShowReport(false);
      setOpen(false);
      setReportCategory("");
    },
    onError: () => toast.error("فشل إرسال البلاغ"),
  });

  const handleReportSubmit = (e) => {
    e.preventDefault();
    const details = e.target.elements.details?.value || "";
    if (!reportCategory) {
      toast.error("يرجى اختيار سبب البلاغ");
      return;
    }
    reportMutation.mutate({ category: reportCategory, details });
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="p-2 rounded-lg hover:bg-muted/50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="إجراءات المستخدم"
        >
          <MoreVertical className="w-5 h-5 text-muted-foreground" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-[1500]" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full mt-1 bg-card border border-border rounded-xl shadow-lg z-[1600] min-w-[180px] overflow-hidden" dir="rtl">
              <button
                type="button"
                onClick={() => { setShowReport(true); setOpen(false); }}
                className="w-full px-3 py-2.5 text-sm text-right hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <Flag className="w-4 h-4 text-yellow-600" />
                <span>الإبلاغ عن المستخدم</span>
              </button>
              <button
                type="button"
                onClick={() => { setShowBlock(true); setOpen(false); }}
                className="w-full px-3 py-2.5 text-sm text-right hover:bg-muted/50 transition-colors flex items-center gap-2 border-t border-border"
              >
                <Shield className="w-4 h-4 text-destructive" />
                <span>حظر المستخدم</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Block confirm modal */}
      {showBlock && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 bg-black/50" dir="rtl">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-3">
                <Shield className="w-6 h-6 text-destructive" />
              </div>
              <h3 className="font-bold text-lg text-foreground">حظر {targetName || "هذا المستخدم"}؟</h3>
              <p className="text-sm text-muted-foreground mt-2">
                لن تستطيعا رؤية بعضكما البعض في نتائج البحث، حجز رحلات بعض، أو تبادل الرسائل.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowBlock(false)}>
                تراجع
              </Button>
              <Button
                className="flex-1 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={() => blockMutation.mutate()}
                disabled={blockMutation.isPending}
              >
                {blockMutation.isPending ? "..." : "حظر"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Report modal */}
      {showReport && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setShowReport(false); }} dir="rtl">
          <form onSubmit={handleReportSubmit} className="bg-card rounded-t-2xl sm:rounded-2xl border border-border w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-bold text-foreground">الإبلاغ عن مستخدم</h3>
              <button type="button" onClick={() => setShowReport(false)} aria-label="إغلاق">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                ساعدنا في الحفاظ على بيئة آمنة. سيتم مراجعة بلاغك من قبل فريق الإدارة.
              </p>
              <div>
                <label className="text-sm font-medium text-foreground">سبب البلاغ <span className="text-destructive">*</span></label>
                <div className="mt-2 space-y-2">
                  {REPORT_CATEGORIES.map(cat => (
                    <label key={cat.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${reportCategory === cat.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                      <input
                        type="radio"
                        name="category"
                        value={cat.id}
                        checked={reportCategory === cat.id}
                        onChange={(e) => setReportCategory(e.target.value)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">{cat.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">تفاصيل إضافية (اختياري)</label>
                <textarea
                  name="details"
                  rows={3}
                  className="mt-2 w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm resize-none"
                  placeholder="أخبرنا المزيد عما حدث..."
                  maxLength={500}
                />
              </div>
            </div>
            <div className="p-4 border-t border-border flex gap-2">
              <Button type="button" variant="outline" className="flex-1 rounded-xl" onClick={() => setShowReport(false)}>
                إلغاء
              </Button>
              <Button
                type="submit"
                className="flex-1 rounded-xl bg-yellow-600 hover:bg-yellow-700 text-white"
                disabled={reportMutation.isPending || !reportCategory}
              >
                {reportMutation.isPending ? "جاري الإرسال..." : "إرسال البلاغ"}
              </Button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  );
}
