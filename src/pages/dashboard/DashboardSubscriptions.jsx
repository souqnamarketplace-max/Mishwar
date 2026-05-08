/**
 * DashboardSubscriptions — admin approval queue for driver subscription
 * payments. The driver clicks "أرسل للمراجعة" in DriverSubscriptionSection,
 * which inserts a row in driver_subscriptions with status='pending'. This
 * page is where the admin (souqnamarketplace@gmail.com) verifies the
 * payment landed in their Reflect/Jawwal/bank account and approves/rejects.
 *
 * On approve: trg_subscription_compute_period (migration 009) auto-sets
 * period_start = NOW() and period_end = NOW() + subscription_period_days.
 * The driver's RPC will return status='active' on next call.
 *
 * On reject: rejected_reason is required. Driver can resubmit a new
 * pending request. Old rejected row stays for audit.
 */
import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { logAdminAction } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { formatArabicDate } from "@/lib/validation";
import {
  Wallet, CheckCircle, XCircle, Clock, ImageIcon, FileText, ExternalLink,
  TrendingUp, Users, AlertCircle, Calendar, Building2, Smartphone,
} from "lucide-react";

const METHOD_LABELS = {
  bank_transfer: { label: "تحويل بنكي", icon: Building2  },
  reflect:       { label: "Reflect",     icon: Wallet     },
  jawwal_pay:    { label: "Jawwal Pay",  icon: Smartphone },
  cash:          { label: "نقداً",        icon: Wallet     },
  other:         { label: "أخرى",        icon: Wallet     },
};

const STATUS_CONFIG = {
  pending:   { label: "قيد المراجعة", className: "bg-yellow-500/10 text-yellow-600", icon: Clock      },
  active:    { label: "ساري",          className: "bg-green-500/10 text-green-600",   icon: CheckCircle },
  rejected:  { label: "مرفوض",         className: "bg-destructive/10 text-destructive", icon: XCircle  },
  expired:   { label: "منتهي",         className: "bg-muted text-muted-foreground",   icon: Clock      },
  cancelled: { label: "ملغى",           className: "bg-muted text-muted-foreground",   icon: XCircle    },
};

export default function DashboardSubscriptions() {
  const qc = useQueryClient();
  const [view, setView] = useState("pending"); // pending | active | history
  const [rejectModal, setRejectModal] = useState(null); // { row } when reject button tapped

  // ── Data ────────────────────────────────────────────────────────────────
  // Pull all subscription rows; categorize client-side. The table is small
  // enough that fetching all of them and filtering in JS avoids the
  // complexity of 3 separate paginated queries.
  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_subscriptions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500); // adjust pagination later if you outgrow this
      if (error) throw error;
      return data;
    },
    refetchOnWindowFocus: true,
  });

  // Read app_settings to compute MRR
  const { data: settingsArr = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("*").limit(1);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
  const settings = settingsArr[0] || {};
  const currentPrice = settings.subscription_price ?? 30;
  const switchOn = !!settings.subscription_required;

  // ── Categorize ──────────────────────────────────────────────────────────
  const { pending, active, historyAll } = useMemo(() => {
    const now = new Date();
    const pending = [];
    const active = [];
    const historyAll = [];
    for (const s of subs) {
      if (s.status === "pending") pending.push(s);
      else if (s.status === "active" && s.period_end && new Date(s.period_end) > now) active.push(s);
      else historyAll.push(s); // rejected, expired, cancelled, or active+past-period
    }
    return { pending, active, historyAll };
  }, [subs]);

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const monthAgo = new Date(Date.now() - 30 * 86400_000);
    // MRR proxy: active subscribers × current price
    const mrr = active.length * currentPrice;
    const collectedThisMonth = subs
      .filter(s => s.status === "active" && new Date(s.approved_at || s.created_at) > monthAgo)
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    return {
      pendingCount: pending.length,
      activeCount: active.length,
      mrr,
      collectedThisMonth,
    };
  }, [subs, pending, active, currentPrice]);

  // ── Approve mutation ───────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async (row) => {
      // The trigger trg_subscription_compute_period automatically sets
      // period_start, period_end, approved_at, approved_by when status
      // transitions pending → active. We just flip the status.
      const { data, error } = await supabase
        .from("driver_subscriptions")
        .update({ status: "active" })
        .eq("id", row.id)
        .select()
        .single();
      if (error) throw error;
      await logAdminAction("subscription_approved", "driver_subscription", row.id, {
        driver_email: row.driver_email,
        amount: row.amount,
      });
      // Notify the driver — formatArabicDate gives Gregorian Arabic
      // ("٧ يونيو ٢٠٢٦") rather than Hijri.
      try {
        const periodEnd = data?.period_end;
        const endDateStr = periodEnd ? formatArabicDate(periodEnd) : "";
        await base44.entities.Notification.create({
          user_email: row.driver_email,
          title: "تم تفعيل اشتراكك ✅",
          message: endDateStr
            ? `تم تفعيل اشتراكك في مِشوار. الاشتراك ساري حتى ${endDateStr}.`
            : "تم تفعيل اشتراكك في مِشوار.",
          type: "system",
          is_read: false,
        });
      } catch (notifyErr) {
        // Don't fail the approval if notification creation failed —
        // admin already approved, driver will see active status next
        // time they refresh. Log to console for triage.
        console.warn("subscription_approved notification failed:", notifyErr);
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      toast.success("تم تفعيل الاشتراك ✅");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل التفعيل")),
  });

  // ── Reject mutation ───────────────────────────────────────────────────
  const rejectMutation = useMutation({
    mutationFn: async ({ row, reason }) => {
      const { error } = await supabase
        .from("driver_subscriptions")
        .update({
          status: "rejected",
          rejected_reason: reason,
          approved_at: new Date().toISOString(),
          approved_by: null, // intentionally null — was rejected, not approved
        })
        .eq("id", row.id);
      if (error) throw error;
      await logAdminAction("subscription_rejected", "driver_subscription", row.id, {
        driver_email: row.driver_email,
        reason,
      });
      try {
        await base44.entities.Notification.create({
          user_email: row.driver_email,
          title: "لم نتمكن من تفعيل اشتراكك ❌",
          message: `لم نتمكن من التحقق من تحويل الدفع. السبب: ${reason}. يمكنك إعادة الإرسال من صفحة الاشتراك.`,
          type: "system",
          is_read: false,
        });
      } catch (notifyErr) {
        console.warn("subscription_rejected notification failed:", notifyErr);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      setRejectModal(null);
      toast.success("تم رفض الطلب");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الرفض")),
  });

  return (
    <div className="space-y-5">
      {/* Kill switch banner */}
      {!switchOn && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">نظام الاشتراك غير مفعّل حالياً</p>
              <p className="text-xs text-muted-foreground mt-1">
                يمكنك مراجعة الطلبات الواردة من السائقين الذين يرغبون بالاشتراك مبكراً، لكن لن يتم منع أي سائق من نشر الرحلات حتى تفعّل النظام من{" "}
                <a href="/dashboard?tab=settings" className="text-primary underline font-medium">إعدادات النظام</a>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Clock}
          color="text-yellow-600 bg-yellow-500/10"
          label="قيد المراجعة"
          value={stats.pendingCount}
          highlight={stats.pendingCount > 0}
        />
        <StatCard
          icon={Users}
          color="text-green-600 bg-green-500/10"
          label="مشتركون نشطون"
          value={stats.activeCount}
        />
        <StatCard
          icon={TrendingUp}
          color="text-primary bg-primary/10"
          label="MRR متوقع"
          value={`₪${stats.mrr.toLocaleString()}`}
        />
        <StatCard
          icon={Calendar}
          color="text-blue-600 bg-blue-500/10"
          label="تم تحصيله هذا الشهر"
          value={`₪${stats.collectedThisMonth.toLocaleString()}`}
        />
      </div>

      {/* View toggle */}
      <div className="flex gap-2 flex-wrap">
        <ViewTab id="pending"  active={view} onChange={setView}
          label={`قيد المراجعة${stats.pendingCount > 0 ? ` (${stats.pendingCount})` : ""}`}
          alert={stats.pendingCount > 0} />
        <ViewTab id="active"   active={view} onChange={setView} label={`نشطون (${stats.activeCount})`} />
        <ViewTab id="history"  active={view} onChange={setView} label={`السجل (${historyAll.length})`} />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="bg-card border border-border rounded-2xl p-4 animate-pulse h-32" />)}
        </div>
      ) : view === "pending" ? (
        <SubscriptionList
          rows={pending}
          emptyMessage="لا توجد طلبات قيد المراجعة"
          showActions
          onApprove={(r) => approveMutation.mutate(r)}
          onReject={(r) => setRejectModal({ row: r })}
          actionPending={approveMutation.isPending}
        />
      ) : view === "active" ? (
        <SubscriptionList rows={active} emptyMessage="لا يوجد مشتركون نشطون" />
      ) : (
        <SubscriptionList rows={historyAll} emptyMessage="السجل فارغ" />
      )}

      {/* Reject modal */}
      {rejectModal && (
        <RejectModal
          row={rejectModal.row}
          onClose={() => setRejectModal(null)}
          onSubmit={(reason) => rejectMutation.mutate({ row: rejectModal.row, reason })}
          submitting={rejectMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function StatCard({ icon: Icon, color, label, value, highlight }) {
  return (
    <div className={`bg-card border rounded-xl p-3 ${highlight ? "border-yellow-500/40" : "border-border"}`}>
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center shrink-0`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className="text-base font-bold text-foreground truncate">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ViewTab({ id, active, onChange, label, alert }) {
  return (
    <button
      onClick={() => onChange(id)}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all relative ${
        active === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
      }`}
    >
      {label}
      {alert && active !== id && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full" />
      )}
    </button>
  );
}

function SubscriptionList({ rows, emptyMessage, showActions, onApprove, onReject, actionPending }) {
  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-12 text-center">
        <Wallet className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <SubscriptionRow
          key={row.id}
          row={row}
          showActions={showActions}
          onApprove={onApprove}
          onReject={onReject}
          actionPending={actionPending}
        />
      ))}
    </div>
  );
}

function SubscriptionRow({ row, showActions, onApprove, onReject, actionPending }) {
  const cfg     = STATUS_CONFIG[row.status] || STATUS_CONFIG.pending;
  const method  = METHOD_LABELS[row.payment_method] || METHOD_LABELS.other;
  const StatusIcon = cfg.icon;
  const MethodIcon = method.icon;

  const proofIsImage = row.proof_url && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(row.proof_url);
  const proofIsPdf   = row.proof_url && /\.pdf(\?|$)/i.test(row.proof_url);

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-foreground truncate">{row.driver_email}</p>
            <Badge className={`${cfg.className} text-[10px] gap-1`}>
              <StatusIcon className="w-3 h-3" />
              {cfg.label}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            أُرسل {formatArabicDate(row.created_at)}
            {row.approved_at && row.status === "active" && ` · تم التفعيل ${formatArabicDate(row.approved_at)}`}
            {row.period_end && row.status === "active" && ` · ينتهي ${formatArabicDate(row.period_end)}`}
          </p>
        </div>
        <div className="text-left shrink-0">
          <p className="text-xl font-black text-primary">₪{Number(row.amount || 0).toLocaleString()}</p>
        </div>
      </div>

      {/* Payment claim details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-muted/30 rounded-lg p-3">
        <div>
          <p className="text-muted-foreground mb-0.5">طريقة الدفع</p>
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <MethodIcon className="w-3.5 h-3.5" />
            {method.label}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground mb-0.5">رقم العملية / المرجع</p>
          <p className="font-mono font-medium text-foreground" dir="ltr">{row.payment_reference || "—"}</p>
        </div>
        {row.driver_note && (
          <div className="sm:col-span-2 mt-1">
            <p className="text-muted-foreground mb-0.5">ملاحظة السائق</p>
            <p className="text-foreground">{row.driver_note}</p>
          </div>
        )}
        {row.rejected_reason && (
          <div className="sm:col-span-2 mt-1">
            <p className="text-muted-foreground mb-0.5">سبب الرفض</p>
            <p className="text-destructive">{row.rejected_reason}</p>
          </div>
        )}
      </div>

      {/* Proof */}
      {row.proof_url && (
        <div className="mt-3">
          <p className="text-[11px] text-muted-foreground mb-1.5">إثبات الدفع</p>
          {proofIsImage ? (
            <a href={row.proof_url} target="_blank" rel="noopener noreferrer" className="block">
              <img
                src={row.proof_url}
                alt="إثبات الدفع"
                className="w-full max-w-xs h-auto rounded-lg border border-border hover:opacity-90"
                loading="lazy"
              />
            </a>
          ) : proofIsPdf ? (
            <a href={row.proof_url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 text-xs text-primary underline">
              <FileText className="w-3.5 h-3.5" /> فتح ملف PDF
            </a>
          ) : (
            <a href={row.proof_url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 text-xs text-primary underline">
              <ImageIcon className="w-3.5 h-3.5" /> فتح الإثبات
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Action buttons (pending only) */}
      {showActions && (
        <div className="flex gap-2 mt-4">
          <Button
            size="sm"
            onClick={() => onApprove(row)}
            disabled={actionPending}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-lg gap-1.5"
          >
            <CheckCircle className="w-4 h-4" />
            موافقة
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(row)}
            disabled={actionPending}
            className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/5 rounded-lg gap-1.5"
          >
            <XCircle className="w-4 h-4" />
            رفض
          </Button>
        </div>
      )}
    </div>
  );
}

function RejectModal({ row, onClose, onSubmit, submitting }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-lg mb-1">رفض طلب الاشتراك</h3>
        <p className="text-sm text-muted-foreground mb-4">
          سنرسل سبب الرفض للسائق ليتمكن من تصحيح المعلومات وإعادة الإرسال.
        </p>
        <p className="text-xs text-muted-foreground mb-1.5">السائق</p>
        <p className="text-sm font-medium mb-3 truncate">{row.driver_email}</p>
        <label className="text-xs text-muted-foreground mb-1 block">سبب الرفض *</label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="مثال: لم يصل المبلغ إلى الحساب البنكي. تأكد من رقم الحساب وحاول مجدداً."
          className="w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm outline-none resize-none"
        />
        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl" disabled={submitting}>
            إلغاء
          </Button>
          <Button
            onClick={() => onSubmit(reason.trim())}
            disabled={!reason.trim() || submitting}
            className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl"
          >
            {submitting ? "جاري..." : "تأكيد الرفض"}
          </Button>
        </div>
      </div>
    </div>
  );
}
