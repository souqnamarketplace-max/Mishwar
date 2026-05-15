import React, { useState } from "react";
import { logAdminAction } from "@/lib/adminAudit";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const statusConfig = {
  pending: { label: "معلقة", cls: "bg-yellow-500/10 text-yellow-600" },
  confirmed: { label: "مؤكدة", cls: "bg-accent/10 text-accent" },
  cancelled: { label: "ملغاة", cls: "bg-destructive/10 text-destructive" },
  completed: { label: "مكتملة", cls: "bg-muted text-muted-foreground" },
};

export default function DashboardBookings() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const qc = useQueryClient();

  React.useEffect(() => {
    const u = api.entities.Booking.subscribe(() => qc.invalidateQueries({ queryKey: ["bookings"] }));
    return () => u();
  }, []);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const setSearchAndReset       = (v) => { setSearch(v); setPage(1); };
  const setStatusAndReset       = (v) => { setStatusFilter(v); setPage(1); };
  const setPaymentAndReset      = (v) => { setPaymentFilter(v); setPage(1); };
  const setDateRangeAndReset    = (v) => { setDateRangePreset(v); setPage(1); };
  const setCustomFromAndReset   = (v) => { setCustomFrom(v); setPage(1); };
  const setCustomToAndReset     = (v) => { setCustomTo(v); setPage(1); };

  const { dateFrom, dateTo } = resolveDateRange(dateRangePreset, customFrom, customTo);

  const { data: bookingsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["bookings", page, search, statusFilter, paymentFilter, dateRangePreset, customFrom, customTo],
    queryFn: async () => {
      // Direct supabase — see DashboardLicenses for the rationale.
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      let q = supabase
        .from("bookings")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusFilter)  q = q.eq("status", statusFilter);
      if (paymentFilter) q = q.eq("payment_status", paymentFilter);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo)   q = q.lte("created_at", dateTo);
      if (search?.trim()) {
        const s = search.trim();
        q = q.or(
          `passenger_name.ilike.%${s}%,passenger_email.ilike.%${s}%,passenger_phone.ilike.%${s}%`
        );
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return {
        rows:       data || [],
        total:      count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
      };
    },
  });
  const bookings = bookingsData.rows;
  const totalBookings = bookingsData.total;
  const totalPages = bookingsData.totalPages;

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { id, status }) => { qc.invalidateQueries({ queryKey: ["bookings"] }); toast.success("تم تحديث الحالة"); logAdminAction("admin_update_booking_status", "booking", id, { new_status: status }); },
    onError: (err) => toast.error(err?.message || "تعذر تنفيذ الإجراء"),
  });

  // Server-side filtering — display rows directly
  const filtered = bookings;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة الحجوزات</h1>
          <p className="text-sm text-muted-foreground">{totalBookings.toLocaleString("ar-EG")} حجز مسجل</p>
        </div>
      </div>

      <DashboardFilterBar
        searchValue={search}
        onSearch={setSearchAndReset}
        searchPlaceholder="ابحث بالاسم أو الإيميل أو الهاتف..."
        selects={[
          {
            key: "status",
            value: statusFilter,
            onChange: setStatusAndReset,
            placeholder: "كل الحالات",
            options: [
              { value: "pending",   label: "معلقة" },
              { value: "confirmed", label: "مؤكدة" },
              { value: "cancelled", label: "ملغاة" },
              { value: "completed", label: "مكتملة" },
            ],
          },
          {
            key: "payment",
            value: paymentFilter,
            onChange: setPaymentAndReset,
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

      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 border-b border-border">
          <div className="text-xs text-muted-foreground">
            صفحة {page} من {totalPages}
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <CalendarCheck className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">لا توجد حجوزات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="p-3">المسافر</th>
                  <th className="p-3">الإيميل</th>
                  <th className="p-3">المقاعد</th>
                  <th className="p-3">السعر الكلي</th>
                  <th className="p-3">طريقة الدفع</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">تاريخ الحجز</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((booking) => {
                  const sc = statusConfig[booking.status] || statusConfig.pending;
                  return (
                    <tr key={booking.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-medium">{booking.passenger_name || "—"}</td>
                      <td className="p-3 text-muted-foreground text-xs">{booking.passenger_email || "—"}</td>
                      <td className="p-3">{booking.seats_booked || 1}</td>
                      <td className="p-3 font-bold text-primary">₪{booking.total_price || "—"}</td>
                      <td className="p-3 text-muted-foreground">{booking.payment_method || "—"}</td>
                      <td className="p-3">
                        <select
                          value={booking.status}
                          onChange={(e) => updateStatus.mutate({ id: booking.id, status: e.target.value })}
                          className={`text-xs rounded-lg px-2 py-1 border-0 font-medium ${sc.cls}`}
                        >
                          {Object.entries(statusConfig).map(([val, { label }]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {booking.created_at ? ((booking.created_at) ? new Date(booking.created_at).toLocaleDateString("ar-EG") : "—") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}