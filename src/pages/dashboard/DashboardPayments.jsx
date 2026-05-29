import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logAdminAction } from "@/lib/adminAudit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, CheckCircle, XCircle, Clock, Download, Users, AlertTriangle, RefreshCw } from "lucide-react";

function exportCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [headers.join(","), ...data.map(row => headers.map(h => `"${(row[h] || "").toString().replace(/"/g, '""')}"`)
    .join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

const bookingStatusConfig = {
  confirmed:          { label: "مؤكد",    color: "bg-accent/10 text-accent" },
  pending:            { label: "معلق",    color: "bg-yellow-500/10 text-yellow-600" },
  cancelled:          { label: "ملغي",    color: "bg-destructive/10 text-destructive" },
  cancelled_by_driver:{ label: "ملغي",    color: "bg-destructive/10 text-destructive" },
  completed:          { label: "مكتمل",   color: "bg-primary/10 text-primary" },
};

const paymentStatusConfig = {
  paid:     { label: "مدفوع",          color: "bg-green-500/10 text-green-600" },
  pending:  { label: "بانتظار الدفع",   color: "bg-yellow-500/10 text-yellow-600" },
  refunded: { label: "مسترد",          color: "bg-blue-500/10 text-blue-600" },
  failed:   { label: "فشل",            color: "bg-destructive/10 text-destructive" },
};

function StatCard({ icon: Icon, iconClass, label, value, sub }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPayments() {
  const [search, setSearch]             = useState("");
  const [view, setView]                 = useState("transactions");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("all");
  const [customFrom, setCustomFrom]     = useState("");
  const [customTo, setCustomTo]         = useState("");
  const [page, setPage]                 = useState(1);
  const [referenceInput, setReferenceInput] = useState({});
  const PAGE_SIZE = 25;

  const reset = (fn) => (v) => { fn(v); setPage(1); };
  const { dateFrom, dateTo } = resolveDateRange(dateRangePreset, customFrom, customTo);

  // ── Transactions (paginated bookings) ───────────────────────────────
  const { data: bookingsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["payments-bookings", page, search, statusFilter, dateRangePreset, customFrom, customTo],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      let q = supabase
        .from("bookings")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusFilter) q = q.eq("payment_status", statusFilter);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo)   q = q.lte("created_at", dateTo);
      if (search?.trim()) {
        const s = search.trim();
        q = q.or(`passenger_name.ilike.%${s}%,passenger_email.ilike.%${s}%`);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data || [], total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)) };
    },
  });
  const bookings    = bookingsData.rows;
  const totalRows   = bookingsData.total;
  const totalPages  = bookingsData.totalPages;

  // ── Summary (RPC) ────────────────────────────────────────────────────
  const { data: summary = { totals: {}, drivers: [] }, isLoading: summaryLoading } = useQuery({
    queryKey: ["payments-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("driver_payments_summary");
      if (error) throw error;
      return data || { totals: {}, drivers: [] };
    },
    staleTime: 60_000,
  });
  const totals       = summary.totals || {};
  const COMMISSION   = summary.commission_rate ?? 0;

  // ── Mark payment via new RPC ─────────────────────────────────────────
  const qc = useQueryClient();
  const markPaid = useMutation({
    mutationFn: async ({ id, paid }) => {
      const ref = referenceInput[id]?.trim() || null;
      const { data, error } = await supabase.rpc("admin_mark_booking_payment", {
        p_booking_id: id,
        p_paid: paid,
        p_reference: ref || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: (_, { id, paid }) => {
      qc.invalidateQueries({ queryKey: ["payments-bookings"] });
      qc.invalidateQueries({ queryKey: ["payments-summary"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(paid ? "تم تسجيل الدفع ✅" : "تم إعادة الحالة إلى بانتظار الدفع");
      logAdminAction("admin_mark_payment", "booking", id, { paid });
      setReferenceInput(prev => { const n = {...prev}; delete n[id]; return n; });
    },
    onError: (e) => toast.error(friendlyError(e, "تعذر تحديث حالة الدفع")),
  });

  // ── Mark refund ──────────────────────────────────────────────────────
  const markRefunded = useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from("bookings").update({
        payment_status:    "refunded",
        refund_status:     "completed",
        refund_issued_at:  new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["payments-bookings"] });
      qc.invalidateQueries({ queryKey: ["payments-summary"] });
      toast.success("تم تسجيل الاسترداد ✅");
      logAdminAction("admin_mark_refund", "booking", id, {});
    },
    onError: (e) => toast.error(friendlyError(e, "تعذر تسجيل الاسترداد")),
  });

  return (
    <div>
      {/* ── Stats ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={DollarSign} iconClass="bg-green-500/10 text-green-600"
          label="إجمالي المحصّل فعلاً"
          value={`₪${(totals.total_paid_revenue || 0).toLocaleString()}`}
          sub={`${totals.paid_bookings || 0} حجز مدفوع`}
        />
        <StatCard
          icon={Clock} iconClass="bg-yellow-500/10 text-yellow-600"
          label="بانتظار التحصيل"
          value={`₪${(totals.total_pending_revenue || 0).toLocaleString()}`}
          sub={`${totals.pending_bookings || 0} حجز`}
        />
        <StatCard
          icon={AlertTriangle} iconClass="bg-destructive/10 text-destructive"
          label="مستردات معلقة"
          value={`₪${(totals.refund_pending_amount || 0).toLocaleString()}`}
          sub={`${totals.refund_pending_count || 0} حجز ملغي بعد دفع`}
        />
        <StatCard
          icon={DollarSign} iconClass="bg-primary/10 text-primary"
          label="إجمالي الفواتير"
          value={`₪${(totals.total_billed || 0).toLocaleString()}`}
          sub={`${totals.total_bookings || 0} حجز نشط`}
        />
      </div>

      {/* ── View toggle + Export ──────────────────────────────────────── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setView("transactions")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === "transactions" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
          المعاملات
        </button>
        <button onClick={() => setView("drivers")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === "drivers" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
          <Users className="w-3.5 h-3.5 inline ml-1" />إيرادات السائقين
        </button>
        <Button size="sm" variant="outline" className="mr-auto rounded-lg gap-1"
          onClick={() => exportCSV(bookings.map(b => ({
            passenger: b.passenger_name, email: b.passenger_email,
            amount: b.total_price, seats: b.seats_booked,
            method: b.payment_method, booking_status: b.status,
            payment_status: b.payment_status,
            paid_at: b.paid_at || "", confirmed_by: b.payment_confirmed_by || "",
            reference: b.payment_reference || "",
            driver_amount: b.driver_amount || 0,
            date: b.created_at,
          })), "payments.csv")}>
          <Download className="w-3.5 h-3.5" /> تصدير CSV
        </Button>
      </div>

      {/* ── Driver Revenue View ───────────────────────────────────────── */}
      {view === "drivers" && (
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-4">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold text-sm">إيرادات السائقين</h3>
            <span className="text-xs text-muted-foreground">
              عمولة المنصة: {COMMISSION}%{COMMISSION === 0 && " — السائقون يحتفظون بكامل الأرباح"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="p-3">السائق</th>
                  <th className="p-3">محصّل / إجمالي</th>
                  <th className="p-3">بانتظار التحصيل</th>
                  <th className="p-3">عمولة المنصة</th>
                  <th className="p-3">صافي السائق</th>
                  <th className="p-3">مستردات معلقة</th>
                </tr>
              </thead>
              <tbody>
                {summaryLoading ? (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
                ) : (summary.drivers || []).length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد بيانات</td></tr>
                ) : (summary.drivers || []).map((d, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-3 font-medium">
                      {d.driver_name || d.driver_email}
                      <span className="text-xs text-muted-foreground block">{d.booking_count} حجز</span>
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-green-600">₪{(d.paid_revenue || 0).toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground"> / ₪{(d.total_billed || 0).toLocaleString()}</span>
                    </td>
                    <td className="p-3 text-yellow-600 font-medium">
                      {d.pending_count ? `₪${(d.pending_revenue || 0).toLocaleString()} (${d.pending_count})` : "—"}
                    </td>
                    <td className="p-3 text-primary font-bold">
                      {COMMISSION > 0 ? `₪${Math.round(d.commission || 0).toLocaleString()}` : "—"}
                    </td>
                    <td className="p-3 text-accent font-bold">₪{Math.round(d.driver_payout || d.paid_revenue || 0).toLocaleString()}</td>
                    <td className="p-3">
                      {d.refund_pending_count ? (
                        <span className="text-destructive font-medium">₪{(d.refund_pending_amount || 0).toLocaleString()} ({d.refund_pending_count})</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      {view === "transactions" && (
        <DashboardFilterBar
          searchValue={search}
          onSearch={reset(setSearch)}
          searchPlaceholder="ابحث باسم الراكب أو البريد..."
          selects={[{
            key: "payment_status",
            value: statusFilter,
            onChange: reset(setStatusFilter),
            placeholder: "كل حالات الدفع",
            options: [
              { value: "pending",  label: "بانتظار الدفع" },
              { value: "paid",     label: "مدفوعة" },
              { value: "refunded", label: "مستردة" },
              { value: "failed",   label: "فشل الدفع" },
            ],
          }]}
          dateRange={{
            value: dateRangePreset,
            onChange: reset(setDateRangePreset),
            dateFrom: customFrom, dateTo: customTo,
            onDateFromChange: reset(setCustomFrom),
            onDateToChange:   reset(setCustomTo),
          }}
          resultCount={totalRows}
        />
      )}

      {/* ── Transactions Table ────────────────────────────────────────── */}
      {view === "transactions" && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="p-3">الراكب</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">طريقة الدفع</th>
                  <th className="p-3">حالة الحجز</th>
                  <th className="p-3">حالة الدفع</th>
                  <th className="p-3">التاريخ / مؤكد بواسطة</th>
                  <th className="p-3">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
                ) : bookings.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">لا توجد معاملات</td></tr>
                ) : bookings.map((b) => {
                  const isCancelled = b.status === "cancelled" || b.status === "cancelled_by_driver";
                  const needsRefund = isCancelled && b.payment_status === "paid" && b.refund_status !== "completed";
                  return (
                    <tr key={b.id} className={`border-b border-border/50 hover:bg-muted/30 ${needsRefund ? "bg-destructive/5" : ""}`}>
                      <td className="p-3">
                        <p className="font-medium">{b.passenger_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{b.passenger_email || "—"}</p>
                      </td>
                      <td className="p-3">
                        <p className="font-bold text-primary">₪{b.total_price || 0}</p>
                        {b.driver_amount > 0 && (
                          <p className="text-xs text-muted-foreground">سائق: ₪{b.driver_amount}</p>
                        )}
                      </td>
                      <td className="p-3 text-sm">{b.payment_method || "نقدي"}</td>
                      <td className="p-3">
                        <Badge className={bookingStatusConfig[b.status]?.color || "bg-muted"}>
                          {bookingStatusConfig[b.status]?.label || b.status}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge className={paymentStatusConfig[b.payment_status]?.color || paymentStatusConfig.pending.color}>
                          {paymentStatusConfig[b.payment_status]?.label || "بانتظار الدفع"}
                        </Badge>
                        {needsRefund && (
                          <p className="text-[10px] text-destructive font-medium mt-1">⚠️ يحتاج استرداد</p>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        <p>{b.created_at ? new Date(b.created_at).toLocaleDateString("ar-EG") : "—"}</p>
                        {b.paid_at && <p className="text-green-600">دُفع: {new Date(b.paid_at).toLocaleDateString("ar-EG")}</p>}
                        {b.payment_confirmed_by && <p>بواسطة: {b.payment_confirmed_by.split("@")[0]}</p>}
                        {b.payment_reference && <p className="font-mono">مرجع: {b.payment_reference}</p>}
                      </td>
                      <td className="p-3">
                        {needsRefund ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30"
                            disabled={markRefunded.isPending}
                            onClick={() => markRefunded.mutate({ id: b.id })}>
                            <RefreshCw className="w-3 h-3 ml-1" />تسجيل استرداد
                          </Button>
                        ) : b.payment_status === "paid" ? (
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            disabled={markPaid.isPending}
                            onClick={() => markPaid.mutate({ id: b.id, paid: false })}>
                            إلغاء الدفع
                          </Button>
                        ) : !isCancelled ? (
                          <div className="space-y-1">
                            <input
                              value={referenceInput[b.id] || ""}
                              onChange={e => setReferenceInput(prev => ({...prev, [b.id]: e.target.value}))}
                              placeholder="رقم المرجع (اختياري)"
                              className="w-full text-xs h-6 px-2 rounded border border-border bg-background"
                            />
                            <Button size="sm" className="h-7 text-xs gap-1 w-full"
                              disabled={markPaid.isPending}
                              onClick={() => markPaid.mutate({ id: b.id, paid: true })}>
                              <CheckCircle className="w-3 h-3" />تأكيد الدفع
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && totalPages > 1 && view === "transactions" && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}
