import React, { useState } from "react";
import { logAdminAction } from "@/lib/adminAudit";
import Pagination from "@/components/dashboard/Pagination";
import { base44 } from "@/api/base44Client";
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
  const qc = useQueryClient();

  React.useEffect(() => {
    const u = base44.entities.Booking.subscribe(() => qc.invalidateQueries({ queryKey: ["admin-bookings"] }));
    return () => u();
  }, []);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: bookingsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["bookings", page],
    queryFn: () => base44.entities.Booking.paginate({ page, pageSize: PAGE_SIZE, sort: "-created_date" }),
  });
  const bookings = bookingsData.rows;
  const totalBookings = bookingsData.total;
  const totalPages = bookingsData.totalPages;

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Booking.update(id, { status }),
    onSuccess: (_, { id, status }) => { qc.invalidateQueries({ queryKey: ["admin-bookings"] }); toast.success("تم تحديث الحالة"); logAdminAction("admin_update_booking_status", "booking", id, { new_status: status }); },
  });

  const filtered = bookings.filter((b) =>
    !search ||
    b.passenger_name?.includes(search) ||
    b.passenger_email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة الحجوزات</h1>
          <p className="text-sm text-muted-foreground">{bookings.length} حجز مسجل</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الإيميل..." className="pr-10 rounded-xl" />
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
                        {booking.created_at ? ((booking.created_at) ? new Date(booking.created_at).toLocaleDateString("ar") : "—") : "—"}
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