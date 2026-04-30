import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import Pagination from "@/components/dashboard/Pagination";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
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

export default function DashboardPayments() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState("transactions"); // "transactions" | "drivers"

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Server-side paginated bookings list (for transactions view)
  const { data: bookingsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["payments-bookings", page],
    queryFn: () => base44.entities.Booking.paginate({ page, pageSize: PAGE_SIZE, sort: "-created_date" }),
  });
  const bookings = bookingsData.rows;
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

  const filtered = bookings.filter((b) =>
    b.passenger_name?.includes(search) || b.passenger_email?.includes(search)
  );

  const totalRevenue = summary.totals?.total_revenue ?? 0;
  const confirmed = summary.totals?.total_bookings ?? 0;
  const cancelled = bookingsData.total - confirmed; // approximate, can be improved
  const COMMISSION_RATE = summary.commission_rate ? summary.commission_rate / 100 : 0.10;
  const COMMISSION_PCT  = summary.commission_rate || 10;
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
            <span className="text-xs text-muted-foreground">عمولة المنصة: 10%</span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
              <th className="p-3">السائق/الراكب</th>
              <th className="p-3">إجمالي المعاملات</th>
              <th className="p-3">عمولة المنصة (10%)</th>
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

      {/* Search */}
      {view === "transactions" && (
      <div className="bg-card rounded-xl border border-border mb-4 p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث باسم الراكب أو البريد..."
          className="w-full bg-muted/50 rounded-lg px-4 py-2 text-sm outline-none"
        />
      </div>
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
                <th className="p-3">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">جاري التحميل...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد معاملات</td></tr>
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
                  <td className="p-3 text-muted-foreground text-xs">
                    {((b.created_at) ? new Date(b.created_at).toLocaleDateString("ar") : "—")}
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