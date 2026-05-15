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
import ModalPortal from "@/components/shared/ModalPortal";
import Pagination from "@/components/dashboard/Pagination";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { logAdminAction } from "@/lib/adminAudit";
import { notifyUser } from "@/lib/notifyUser";
import { api } from "@/api/apiClient";
import { formatArabicDate } from "@/lib/validation";
import {
  Wallet, CheckCircle, XCircle, Clock, ImageIcon, FileText, ExternalLink,
  TrendingUp, Users, AlertCircle, Calendar, Building2, Smartphone, Gift, UserPlus, X,
} from "lucide-react";

const METHOD_LABELS = {
  bank_transfer: { label: "تحويل بنكي",         icon: Building2  },
  reflect:       { label: "Reflect",             icon: Wallet     },
  jawwal_pay:    { label: "Jawwal Pay",          icon: Smartphone },
  cash:          { label: "نقداً",                icon: Wallet     },
  admin_grant:   { label: "منحة من الإدارة",    icon: Gift        },
  other:         { label: "أخرى",                icon: Wallet     },
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
  const [grantModal, setGrantModal] = useState(null);   // null | "single" | "bulk"
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Reset to page 1 when switching tabs — otherwise tab change leaves
  // page index stale and may land on an empty page.
  const setViewAndReset = (next) => { setView(next); setPage(1); };

  // ── Data ────────────────────────────────────────────────────────────────
  // Three separate paginated queries, one per tab. Powered by the
  // driver_subscriptions_v view (migration 014) which pre-computes
  // view_category server-side. Only the ACTIVE tab's query runs unless
  // that's what the admin is viewing — saves bandwidth at scale.
  //
  // Why a view instead of three .or() filters: 'history' is the negation
  // of pending+active, which is awkward in PostgREST syntax. The view
  // pushes that logic to SQL where it stays maintainable as the schema
  // evolves.
  const { data: rowsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["admin-subscriptions", view, page],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count, error } = await supabase
        .from("driver_subscriptions_v")
        .select("*", { count: "exact" })
        .eq("view_category", view)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return {
        rows: data ?? [],
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
      };
    },
    refetchOnWindowFocus: true,
  });
  const rows = rowsData.rows;
  const totalPages = rowsData.totalPages;

  // Counts for tab badges + stat cards. Three cheap parallel COUNT queries
  // with head:true (no rows transferred). Plus a sum-style query for
  // collected-this-month. Updates every 30s.
  const { data: counts = { pending: 0, active: 0, history: 0, collectedThisMonth: 0 } } = useQuery({
    queryKey: ["admin-subscriptions-counts"],
    queryFn: async () => {
      const monthAgoIso = new Date(Date.now() - 30 * 86400_000).toISOString();
      const make = (cat) => supabase
        .from("driver_subscriptions_v")
        .select("*", { count: "exact", head: true })
        .eq("view_category", cat);
      const [p, a, h, collected] = await Promise.all([
        make("pending"),
        make("active"),
        make("history"),
        // Sum amount of all approved-this-month active subs.
        // Limited fetch is OK because head:true returns just the count;
        // for the actual sum we pull only those rows (typically <month's worth).
        supabase
          .from("driver_subscriptions")
          .select("amount")
          .eq("status", "active")
          .gte("approved_at", monthAgoIso)
          .limit(10000),
      ]);
      const collectedSum = (collected.data || [])
        .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      return {
        pending:             p.count ?? 0,
        active:              a.count ?? 0,
        history:             h.count ?? 0,
        collectedThisMonth:  collectedSum,
      };
    },
    staleTime: 30_000,
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

  // ── Derived for legacy code below ──────────────────────────────────────
  // Existing render code references `pending`, `active`, `historyAll`
  // arrays. After the restructure, only the CURRENT view's rows are
  // available. Map them so existing JSX still works.
  const pending    = view === "pending" ? rows : [];
  const active     = view === "active"  ? rows : [];
  const historyAll = view === "history" ? rows : [];

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats = {
    pendingCount:        counts.pending,
    activeCount:         counts.active,
    mrr:                 counts.active * currentPrice,
    collectedThisMonth:  counts.collectedThisMonth,
  };

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
      // Routes through notifyUser → create_notification RPC (migration 027)
      // which handles cross-user authorization via Rule B (admin) and
      // captures any failure via Sentry. Direct insert was working
      // post-migration-037 but the RPC path is the right pattern in
      // case the RLS policy ever tightens.
      const periodEnd = data?.period_end;
      const endDateStr = periodEnd ? formatArabicDate(periodEnd) : "";
      await notifyUser({
        user_email: row.driver_email,
        title: "تم تفعيل اشتراكك ✅",
        message: endDateStr
          ? `تم تفعيل اشتراكك في مشوارو. الاشتراك ساري حتى ${endDateStr}.`
          : "تم تفعيل اشتراكك في مشوارو.",
        type: "subscription_approved",
        link: "/driver?tab=subscription",
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] }); qc.invalidateQueries({ queryKey: ["admin-subscriptions-counts"] });
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
      // Notify driver via the RPC path (handles RLS via Rule B, sends
      // failures to Sentry instead of dropping them silently).
      await notifyUser({
        user_email: row.driver_email,
        title: "لم نتمكن من تفعيل اشتراكك ❌",
        message: `لم نتمكن من التحقق من تحويل الدفع. السبب: ${reason}. يمكنك إعادة الإرسال من صفحة الاشتراك.`,
        type: "subscription_rejected",
        link: "/driver?tab=subscription",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] }); qc.invalidateQueries({ queryKey: ["admin-subscriptions-counts"] });
      setRejectModal(null);
      toast.success("تم رفض الطلب");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الرفض")),
  });

  // ── Grant complimentary subscription mutations ─────────────────────────
  // These call the SECURITY DEFINER RPCs from migration 011.
  //
  // Single: admin enters one driver's email + days. Used for loyalty
  // rewards, beta tester comps, make-goods after issues.
  //
  // Bulk: admin grants 30-day grace to ALL current drivers without
  // active subs. Use case: before flipping the kill switch on, give
  // existing drivers a runway so they're not abruptly cut off.

  const grantSingle = useMutation({
    mutationFn: async ({ email, days, note }) => {
      const { data, error } = await supabase.rpc("grant_complimentary_subscription", {
        p_driver_email: email,
        p_days: days,
        p_note: note || null,
      });
      if (error) throw error;
      // Notify the recipient driver via the canonical RPC path.
      await notifyUser({
        user_email: email,
        title: "تم منحك اشتراكاً مجانياً 🎁",
        message: `قامت إدارة مشوارو بتفعيل اشتراك مجاني لك لمدة ${days} يوماً.${note ? " السبب: " + note : ""}`,
        type: "subscription_complimentary",
        link: "/driver?tab=subscription",
      });
      await logAdminAction("subscription_granted", "driver_subscription", data, {
        driver_email: email, days, note,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] }); qc.invalidateQueries({ queryKey: ["admin-subscriptions-counts"] });
      setGrantModal(null);
      toast.success("تم منح الاشتراك ✓");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل المنح")),
  });

  const grantBulk = useMutation({
    mutationFn: async ({ days, note }) => {
      const { data, error } = await supabase.rpc("bulk_grant_grace_to_unsubscribed_drivers", {
        p_days: days,
        p_note: note || "فترة سماح من إدارة مشوارو",
      });
      if (error) throw error;
      await logAdminAction("subscription_bulk_granted", "driver_subscription", null, {
        days, count: data,
      });
      return data;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["admin-subscriptions"] }); qc.invalidateQueries({ queryKey: ["admin-subscriptions-counts"] });
      setGrantModal(null);
      toast.success(`تم منح ${count} اشتراكاً للسائقين الحاليين ✓`);
    },
    onError: (err) => toast.error(friendlyError(err, "فشل المنح الجماعي")),
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

      {/* View toggle + grant actions */}
      <div className="flex gap-2 flex-wrap items-center">
        <ViewTab id="pending"  active={view} onChange={setViewAndReset}
          label={`قيد المراجعة${stats.pendingCount > 0 ? ` (${stats.pendingCount})` : ""}`}
          alert={stats.pendingCount > 0} />
        <ViewTab id="active"   active={view} onChange={setViewAndReset} label={`نشطون (${stats.activeCount})`} />
        <ViewTab id="history"  active={view} onChange={setViewAndReset} label={`السجل (${counts.history})`} />

        {/* Grant complimentary actions — pushed to the right */}
        <div className="flex gap-2 mr-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGrantModal("single")}
            className="rounded-lg gap-1.5"
          >
            <Gift className="w-4 h-4 text-primary" />
            منح اشتراك مجاني
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGrantModal("bulk")}
            className="rounded-lg gap-1.5"
          >
            <UserPlus className="w-4 h-4 text-primary" />
            منح فترة سماح للجميع
          </Button>
        </div>
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

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
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

      {/* Grant comp subscription modal — single driver */}
      {grantModal === "single" && (
        <GrantSingleModal
          onClose={() => setGrantModal(null)}
          onSubmit={({ email, days, note }) => grantSingle.mutate({ email, days, note })}
          submitting={grantSingle.isPending}
        />
      )}

      {/* Grant grace to all — bulk */}
      {grantModal === "bulk" && (
        <GrantBulkModal
          onClose={() => setGrantModal(null)}
          onSubmit={({ days, note }) => grantBulk.mutate({ days, note })}
          submitting={grantBulk.isPending}
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
    <ModalPortal>
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
    </ModalPortal>
  );
}

// ─── Grant complimentary subscription — single driver ───────────────────────
function GrantSingleModal({ onClose, onSubmit, submitting }) {
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(30);
  const [note, setNote] = useState("");

  // Driver autocomplete — pull from profiles where account_type ∈ (driver, both).
  // Limited to the first 100 matches by email substring; for solo founder
  // scale this is fine, will need pagination later.
  const { data: matches = [] } = useQuery({
    queryKey: ["driver-search", email],
    queryFn: async () => {
      if (!email || email.length < 2) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("email, full_name, account_type")
        .in("account_type", ["driver", "both"])
        .ilike("email", `%${email}%`)
        .limit(8);
      if (error) return [];
      return data || [];
    },
    enabled: email.length >= 2,
  });

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Gift className="w-5 h-5 text-primary" />
            منح اشتراك مجاني
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg" aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          سيتم تفعيل اشتراك مجاني للسائق فوراً، بدون مراجعة. مناسب للسائقين المميزين أو في حالات خاصة.
        </p>

        <label className="text-xs text-muted-foreground mb-1 block">بريد السائق *</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="driver@example.com"
          className="w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm outline-none mb-1"
          autoFocus
        />
        {matches.length > 0 && email && !matches.find(m => m.email === email) && (
          <div className="bg-card border border-border rounded-xl mb-2 max-h-40 overflow-y-auto">
            {matches.map(m => (
              <button
                key={m.email}
                type="button"
                onClick={() => setEmail(m.email)}
                className="w-full text-right px-3 py-2 text-sm hover:bg-muted/30 border-b border-border last:border-b-0"
              >
                <div className="font-medium truncate">{m.full_name || m.email}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
              </button>
            ))}
          </div>
        )}

        <label className="text-xs text-muted-foreground mb-1 block mt-3">عدد الأيام *</label>
        <input
          type="number"
          min="1"
          max="365"
          value={days}
          onChange={e => {
            const raw = parseInt(e.target.value);
            setDays(Number.isFinite(raw) ? Math.max(1, Math.min(365, raw)) : 30);
          }}
          className="w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm outline-none mb-3"
        />

        <label className="text-xs text-muted-foreground mb-1 block">ملاحظة (اختياري)</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="مثال: مكافأة سائق متميز، تعويض عن مشكلة، مرحلة تجريبية"
          className="w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm outline-none resize-none"
        />

        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl" disabled={submitting}>
            إلغاء
          </Button>
          <Button
            onClick={() => onSubmit({ email: email.trim(), days, note: note.trim() })}
            disabled={!email.trim() || days < 1 || submitting}
            className="flex-1 bg-primary text-primary-foreground rounded-xl"
          >
            {submitting ? "جاري..." : "منح الاشتراك"}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

// ─── Bulk grace grant — to all current drivers without active subs ───────
function GrantBulkModal({ onClose, onSubmit, submitting }) {
  const [days, setDays] = useState(30);
  const [note, setNote] = useState("فترة سماح من إدارة مشوارو");

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            منح فترة سماح لجميع السائقين
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg" aria-label="إغلاق">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 mb-4 text-xs text-muted-foreground leading-relaxed">
          سيتم منح اشتراك مجاني لكل السائقين الذين لا يملكون اشتراكاً نشطاً حالياً.
          يفيد قبل تفعيل نظام الاشتراك ليحصل السائقون على فترة سماح بدلاً من حظرهم فجأة.
          <br /><br />
          السائقون الذين لديهم اشتراك نشط لن يتأثروا (لا يُضاف وقت إضافي).
        </div>

        <label className="text-xs text-muted-foreground mb-1 block">عدد الأيام لكل سائق *</label>
        <input
          type="number"
          min="1"
          max="365"
          value={days}
          onChange={e => {
            const raw = parseInt(e.target.value);
            setDays(Number.isFinite(raw) ? Math.max(1, Math.min(365, raw)) : 30);
          }}
          className="w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm outline-none mb-3"
        />

        <label className="text-xs text-muted-foreground mb-1 block">ملاحظة (تظهر للسائقين)</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm outline-none resize-none"
        />

        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl" disabled={submitting}>
            إلغاء
          </Button>
          <Button
            onClick={() => onSubmit({ days, note: note.trim() })}
            disabled={days < 1 || submitting}
            className="flex-1 bg-primary text-primary-foreground rounded-xl"
          >
            {submitting ? "جاري المنح..." : `منح ${days} يوماً للجميع`}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
