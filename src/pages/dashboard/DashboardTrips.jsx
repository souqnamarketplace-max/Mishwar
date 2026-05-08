import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";
import { logAdminAction } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, Search, MapPin, ArrowLeft, Clock, Users, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const statusConfig = {
  confirmed: { label: "مؤكدة", cls: "bg-accent/10 text-accent" },
  in_progress: { label: "جارية", cls: "bg-primary/10 text-primary" },
  completed: { label: "مكتملة", cls: "bg-muted text-muted-foreground" },
  cancelled: { label: "ملغاة", cls: "bg-destructive/10 text-destructive" },
};

export default function DashboardTrips() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const qc = useQueryClient();

  // Realtime — admin sees trip changes instantly
  React.useEffect(() => {
    const u1 = base44.entities.Trip.subscribe(() => qc.invalidateQueries({ queryKey: ["trips"] }));
    const u2 = base44.entities.Booking.subscribe(() => qc.invalidateQueries({ queryKey: ["trips"] }));
    return () => { u1(); u2(); };
  }, []);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Reset page when any filter changes — otherwise admin can land on
  // an empty page-N of a smaller filtered set.
  const setSearchAndReset       = (v) => { setSearch(v); setPage(1); };
  const setStatusAndReset       = (v) => { setStatusFilter(v); setPage(1); };
  const setDateRangeAndReset    = (v) => { setDateRangePreset(v); setPage(1); };
  const setCustomFromAndReset   = (v) => { setCustomFrom(v); setPage(1); };
  const setCustomToAndReset     = (v) => { setCustomTo(v); setPage(1); };

  const { dateFrom, dateTo } = resolveDateRange(dateRangePreset, customFrom, customTo);

  const { data: tripsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["trips", page, search, statusFilter, dateRangePreset, customFrom, customTo],
    queryFn: () => base44.entities.Trip.paginate({
      page,
      pageSize: PAGE_SIZE,
      sort: "-created_date",
      conditions: statusFilter ? { status: statusFilter } : undefined,
      searchTerm: search,
      searchColumns: ["from_city", "to_city", "driver_name", "driver_email"],
      dateColumn: "created_at",
      dateFrom,
      dateTo,
    }),
  });
  const trips = tripsData.rows;
  const totalTrips = tripsData.total;
  const totalPages = tripsData.totalPages;

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Trip.delete(id),
    onSuccess: (_, tripId) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("تم حذف الرحلة");
      const trip = trips?.find(t => t.id === tripId);
      logAdminAction("admin_delete_trip", "trip", tripId, {
        route: trip ? `${trip.from_city} → ${trip.to_city}` : null,
        date:  trip?.date,
        driver_email: trip?.driver_email,
      });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Trip.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trips"] }); toast.success("تم تحديث الحالة"); },
  });

  // No more client-side filter — server does it all. Display rows directly.
  const filtered = trips;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة الرحلات</h1>
          <p className="text-sm text-muted-foreground">{totalTrips.toLocaleString("ar-EG")} رحلة مسجلة</p>
        </div>
      </div>

      <DashboardFilterBar
        searchValue={search}
        onSearch={setSearchAndReset}
        searchPlaceholder="ابحث بالمدينة أو السائق أو معرّف الرحلة..."
        selects={[
          {
            key: "status",
            value: statusFilter,
            onChange: setStatusAndReset,
            placeholder: "كل الحالات",
            options: [
              { value: "confirmed",   label: "مؤكدة" },
              { value: "in_progress", label: "جارية" },
              { value: "completed",   label: "مكتملة" },
              { value: "cancelled",   label: "ملغاة" },
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
        resultCount={totalTrips}
      />

      <div className="bg-card rounded-xl border border-border">
        <div className="p-4 border-b border-border">
          <div className="text-xs text-muted-foreground">
            صفحة {page} من {totalPages}
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="p-3">المسار</th>
                  <th className="p-3">السائق</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">المقاعد</th>
                  <th className="p-3">السعر</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((trip) => {
                  const sc = statusConfig[trip.status] || statusConfig.confirmed;
                  return (
                    <tr key={trip.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-1 font-medium">
                          <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                          {trip.from_city}
                          <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
                          {trip.to_city}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{trip.driver_name || "—"}</td>
                      <td className="p-3 text-muted-foreground text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {trip.date} {trip.time}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-muted-foreground" />
                          {trip.available_seats}/{trip.total_seats || trip.available_seats}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-primary">₪{trip.price}</td>
                      <td className="p-3">
                        <select
                          value={trip.status}
                          onChange={(e) => updateStatus.mutate({ id: trip.id, status: e.target.value })}
                          className={`text-xs rounded-lg px-2 py-1 border-0 font-medium ${sc.cls}`}
                        >
                          {Object.entries(statusConfig).map(([val, { label }]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10 w-8 h-8"
                          onClick={() => deleteMutation.mutate(trip.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
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