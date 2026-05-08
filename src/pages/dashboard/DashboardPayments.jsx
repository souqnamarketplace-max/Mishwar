import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logAdminAction } from "@/lib/adminAudit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, TrendingUp, DollarSign, CheckCircle, XCircle, Clock, Download, Users } from "lucide-react";

function exportCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [headers.join(","), ...data.map(row => headers.map(h => `"${(row[h] || "").toString().replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

const statusConfig = {
  confirmed: { label: "مؤكد", color: "bg-accent/10 text-accent" },
  pending: { label: "معلق", color: "bg-yellow-500/10 text-yellow-600" },
  cancelled: { label: "ملغي", color: "bg-destructive/10 text-destructive" },
  completed: { label: "مكتمل", color: "bg-primary/10 text-primary" },
};

// Payment status badge — separate from booking status. A booking can be
// status=confirmed but payment_status=pending (driver accepted but cash
// not yet received). Marking it paid is a manual admin/driver action.
const paymentStatusConfig = {
  paid:     { label: "مدفوع",          color: "bg-green-500/10 text-green-600" },
  pending:  { label: "بانتظار الدفع",   color: "bg-yellow-500/10 text-yellow-600" },
  refunded: { label: "مسترد",          color: "bg-blue-500/10 text-blue-600" },
  failed:   { label: "فشل",            color: "bg-destructive/10 text-destructive" },
};

export default function DashboardPayments() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState("transactions"); // "transactions" | "drivers"
  const [statusFilter, setStatusFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const setSearchAndReset       = (v) => { setSearch(v); setPage(1); };
  const setStatusAndReset       = (v) => { setStatusFilter(v); setPage(1); };
  const setDateRangeAndReset    = (v) => { setDateRangePreset(v); setPage(1); };
  const setCustomFromAndReset   = (v) => { setCustomFrom(v); setPage(1); };
  const setCustomToAndReset     = (v) => { setCustomTo(v); setPage(1); };

  const { dateFrom, dateTo } = resolveDateRange(dateRangePreset, customFrom, customTo);

  // Server-side paginated bookings list (for transactions view)
  const { data: bookingsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["payments-bookings", page, search, statusFilter, dateRangePreset, customFrom, customTo],
    queryFn: () => base44.entities.Booking.paginate({
      page,
      pageSize: PAGE_SIZE,
      sort: "-created_date",
      conditions: statusFilter ? { payment_status: statusFilter } : undefined,
      searchTerm: search,
      searchColumns: ["passenger_name", "passenger_email", "passenger_phone"],
      dateColumn: "created_at",
      dateFrom,
      dateTo,
    }),
  });
  const bookings = bookingsData.rows;
  const totalBookings = bookingsData.total;
  const totalPages = bookingsData.totalPages;

  // Server-side aggregated summary (for stats + per-driver breakdown)
  const { data: summary = { totals: {}, drivers: [] } } = useQuery({
    queryKey: ["payments-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("driver_payments_summary");
      if (error) throw error;
      return data || { totals: {}, drivers: [] };
    },
    staleTime: 60000,
  });

  // Mark a booking as paid (or revert to pending). Until tonight the entire
  // payment_status column was dead weight — created bookings defaulted to
  // "pending" and nothing in the app ever wrote any other value, so admins
  // and drivers had no way to reconcile cash collected, transfers received,
  // or Jawwal Pay confirmations. This mutation is the missing write path.
  const qc = useQueryClient();
  const markPaid = useMutation({
    mutationFn: async ({ id, paid }) => {
      await base44.entities.Booking.update(id, {
        payment_status: paid ? "paid" : "pending",
        paid_at: paid ? new Date().toISOString() : null,
      });
    },
    onSuccess: (_, { id, paid }) => {
      qc.invalidateQueries({ queryKey: ["payments-bookings"] });
      qc.invalidateQueries({ queryKey: ["payments-summary"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(paid ? "تم تسجيل الدفع" : "تم إعادة الحالة إلى بانتظار الدفع");
      logAdminAction("admin_mark_payment", "booking", id, { paid });
    },
    onError: (e) => toast.error("فشل التحديث: " + (e?.message || "")),
  });

  // Server-side filtering — display rows directly
  const filtered = bookings;

  // Read commission rate from app_settings — the RPC may or may not
  // include it; reading directly from settings is the source of truth
  // and works whether or not the RPC was updated. Falsy-coalesce had
  // a bug where commission=0 fell through to the 10% default; we now
  // explicitly handle 0 by checking for null/undefined (??) instead
  // of falsy (||).
  const { data: appSettingsArr = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => base44.entities.AppSettings.list(),
    staleTime: 60000,
  });
  const settingsRate = appSettingsArr[0]?.commission_rate;

  const totalRevenue = summary.totals?.total_revenue ?? 0;
  const confirmed = summary.totals?.total_bookings ?? 0;
  const cancelled = bookingsData.total - confirmed; // approximate, can be improved

  // Commission resolution order: app_settings → RPC fallback → 0% default.
  // Critically uses ?? (nullish-coalesce), not || (falsy), so a real
  // configured value of 0 is preserved instead of falling through.
  // Default 0 matches DashboardSettings.defaultSettings — the launch
  // posture is "no commission" until volume justifies a cut.
  const COMMISSION_PCT  = settingsRate ?? summary.commission_rate ?? 0;
  const COMMISSION_RATE = COMMISSION_PCT / 100;
  // Build the same shape as before for downstream rendering
  const driverRevenue = (summary.drivers || []).reduce((acc, d) => {
    acc[d.driver_email || "unknown"] = {
      name: d.driver_name || d.driver_email,
      total: d.total_revenue,
      count: d.booking_count,
    };
    return acc;
  }, {});

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">إجمالي الإيرادات</p>
            <p className="text-xl font-bold text-foreground">₪{totalRevenue.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">معاملات ناجحة</p>
            <p className="text-xl font-bold text-foreground">{confirmed}</p>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
            <XCircle className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">معاملات ملغاة</p>
            <p className="text-xl font-bold text-foreground">{cancelled}</p>
          </div>
        </div>
      </div>

      {/* View toggle + Export */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setView("transactions")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === "transactions" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>المعاملات</button>
        <button onClick={() => setView("drivers")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === "drivers" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
          <Users className="w-3.5 h-3.5 inline ml-1" />إيرادات السائقين
        </button>
        <Button size="sm" variant="outline" className="mr-auto rounded-lg gap-1" onClick={() => exportCSV(bookings.map(b => ({ passenger: b.passenger_name, email: b.passenger_email, amount: b.total_price, seats: b.seats_booked, method: b.payment_method, status: b.status, date: b.created_at })), "payments.csv")}>
          <Download className="w-3.5 h-3.5" /> تصدير CSV
        </Button>
      </div>

      {/* Driver Revenue View */}
      {view === "drivers" && (
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-4">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold text-sm">إيرادات السائقين والعمولات</h3>
            <span className="text-xs text-muted-foreground">
              عمولة المنصة: {COMMISSION_PCT}%
              {COMMISSION_PCT === 0 && " — السائقون يحتفظون بكامل الأرباح"}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
              <th className="p-3">السائق/الراكب</th>
              <th className="p-3">إجمالي المعاملات</th>
              <th className="p-3">عمولة المنصة ({COMMISSION_PCT}%)</th>
              <th className="p-3">صافي المدفوع</th>
            </tr></thead>
            <tbody>
              {Object.values(driverRevenue).sort((a,b) => b.total - a.total).map((driver, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="p-3 font-medium">{driver.name}<span className="text-xs text-muted-foreground block">{driver.count} معاملة</span></td>
                  <td className="p-3 font-bold">₪{driver.total.toLocaleString()}</td>
                  <td className="p-3 text-primary font-bold">₪{Math.round(driver.total * COMMISSION_RATE).toLocaleString()}</td>
                  <td className="p-3 text-accent font-bold">₪{Math.round(driver.total * (1 - COMMISSION_RATE)).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      {view === "transactions" && (
        <DashboardFilterBar
          searchValue={search}
          onSearch={setSearchAndReset}
          searchPlaceholder="ابحث باسم الراكب أو البريد أو الهاتف..."
          selects={[
            {
              key: "payment_status",
              value: statusFilter,
              onChange: setStatusAndReset,
              placeholder: "كل حالات الدفع",
              options: [
                { value: "pending",  label: "بانتظار الدفع" },
                { value: "paid",     label: "مدفوعة" },
                { value: "refunded", label: "مستردة" },
                { value: "failed",   label: "فشل الدفع" },
              ],
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
          resultCount={totalBookings}
        />
      )}

      {/* Transactions Table */}
      {view === "transactions" && <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
                <th className="p-3">الراكب</th>
                <th className="p-3">المبلغ</th>
                <th className="p-3">المقاعد</th>
                <th className="p-3">طريقة الدفع</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">حالة الدفع</th>
                <th className="p-3">التاريخ</th>
                <th className="p-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">لا توجد معاملات</td></tr>
              ) : filtered.map((b) => (
                <tr key={b.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="p-3">
                    <p className="font-medium">{b.passenger_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{b.passenger_email || "—"}</p>
                  </td>
                  <td className="p-3 font-bold text-primary">₪{b.total_price || 0}</td>
                  <td className="p-3">{b.seats_booked || 1} مقعد</td>
                  <td className="p-3">{b.payment_method || "نقدي"}</td>
                  <td className="p-3">
                    <Badge className={statusConfig[b.status]?.color || "bg-muted"}>
                      {statusConfig[b.status]?.label || b.status}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Badge className={paymentStatusConfig[b.payment_status]?.color || paymentStatusConfig.pending.color}>
                      {paymentStatusConfig[b.payment_status]?.label || paymentStatusConfig.pending.label}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {((b.created_at) ? new Date(b.created_at).toLocaleDateString("ar-EG") : "—")}
                  </td>
                  <td className="p-3">
                    {b.payment_status === "paid" ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                              disabled={markPaid.isPending}
                              onClick={() => markPaid.mutate({ id: b.id, paid: false })}>
                        إلغاء
                      </Button>
                    ) : b.status !== "cancelled" && b.status !== "cancelled_by_driver" ? (
                      <Button size="sm" className="h-7 text-xs gap-1"
                              disabled={markPaid.isPending}
                              onClick={() => markPaid.mutate({ id: b.id, paid: true })}>
                        <CheckCircle className="w-3 h-3" />
                        تأكيد الدفع
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      }
      {!isLoading && totalPages > 1 && view === "transactions" && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}