import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { CreditCard, TrendingUp, DollarSign, CheckCircle, XCircle, Clock } from "lucide-react";

const statusConfig = {
  confirmed: { label: "مؤكد", color: "bg-accent/10 text-accent" },
  pending: { label: "معلق", color: "bg-yellow-500/10 text-yellow-600" },
  cancelled: { label: "ملغي", color: "bg-destructive/10 text-destructive" },
  completed: { label: "مكتمل", color: "bg-primary/10 text-primary" },
};

export default function DashboardPayments() {
  const [search, setSearch] = useState("");

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["bookings"],
    queryFn: () => base44.entities.Booking.list("-created_date", 100),
  });

  const filtered = bookings.filter((b) =>
    b.passenger_name?.includes(search) || b.passenger_email?.includes(search)
  );

  const totalRevenue = bookings.reduce((sum, b) => sum + (b.total_price || 0), 0);
  const confirmed = bookings.filter((b) => b.status === "confirmed" || b.status === "completed").length;
  const cancelled = bookings.filter((b) => b.status === "cancelled").length;

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

      {/* Search */}
      <div className="bg-card rounded-xl border border-border mb-4 p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث باسم الراكب أو البريد..."
          className="w-full bg-muted/50 rounded-lg px-4 py-2 text-sm outline-none"
        />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
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
                    {new Date(b.created_date).toLocaleDateString("ar")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}