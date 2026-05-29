import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";
import { logAdminAction } from "@/lib/adminAudit";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, MapPin, ArrowLeft, Clock, Users, Trash2, Pencil, X, Check } from "lucide-react";
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
  const [editingTrip, setEditingTrip] = useState(null); // { id, fields: {} }
  const qc = useQueryClient();

  // Realtime — admin sees trip changes instantly
  React.useEffect(() => {
    const u1 = api.entities.Trip.subscribe(() => qc.invalidateQueries({ queryKey: ["trips"] }));
    const u2 = api.entities.Booking.subscribe(() => qc.invalidateQueries({ queryKey: ["trips"] }));
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
    queryFn: async () => {
      // Direct supabase — api.entities.Trip.paginate auto-injects
      // created_by = admin_email and hides every trip the admin didn't
      // create themselves (i.e. all of them in production).
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      let q = supabase
        .from("trips")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusFilter) q = q.eq("status", statusFilter);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo)   q = q.lte("created_at", dateTo);
      // Search across multiple columns via or() — case-insensitive
      if (search?.trim()) {
        const s = search.trim();
        q = q.or(
          `from_city.ilike.%${s}%,to_city.ilike.%${s}%,driver_name.ilike.%${s}%,driver_email.ilike.%${s}%`
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
  const trips = tripsData.rows;
  const totalTrips = tripsData.total;
  const totalPages = tripsData.totalPages;

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("trips").delete().eq("id", id);
      if (error) throw error;
    },
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
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from("trips").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trips"] }); toast.success("تم تحديث الحالة"); },
    onError: (err) => toast.error(err?.message || "تعذر تنفيذ الإجراء"),
  });

  const editTrip = useMutation({
    mutationFn: async ({ id, fields }) => {
      const { data, error } = await supabase.rpc("admin_edit_trip", {
        p_trip_id:        id,
        p_from_city:      fields.from_city      || null,
        p_to_city:        fields.to_city        || null,
        p_price:          fields.price          ? Number(fields.price) : null,
        p_available_seats:fields.available_seats? Number(fields.available_seats) : null,
        p_driver_note:    fields.driver_note    || null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("تم تعديل الرحلة ✅");
      logAdminAction("admin_edit_trip", "trip", id, {});
      setEditingTrip(null);
    },
    onError: (err) => toast.error(err?.message || "تعذر تعديل الرحلة"),
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
                      <td className="p-3 flex items-center gap-1">
                        <Button
                          variant="ghost" size="icon"
                          className="w-8 h-8 hover:bg-primary/10"
                          title="تعديل الرحلة"
                          onClick={() => setEditingTrip({
                            id: trip.id,
                            fields: {
                              from_city:       trip.from_city,
                              to_city:         trip.to_city,
                              price:           trip.price,
                              available_seats: trip.available_seats,
                              driver_note:     trip.driver_note || "",
                            },
                          })}
                        >
                          <Pencil className="w-3.5 h-3.5 text-primary" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="text-destructive hover:bg-destructive/10 w-8 h-8"
                          onClick={() => deleteMutation.mutate(trip.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                    {/* Inline edit row */}
                    {editingTrip?.id === trip.id && (
                      <tr key={trip.id + "-edit"} className="bg-primary/5 border-b border-primary/20">
                        <td colSpan={7} className="p-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2" dir="rtl">
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-1">من</p>
                              <input value={editingTrip.fields.from_city}
                                onChange={e => setEditingTrip(t => ({ ...t, fields: { ...t.fields, from_city: e.target.value } }))}
                                className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-background" />
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-1">إلى</p>
                              <input value={editingTrip.fields.to_city}
                                onChange={e => setEditingTrip(t => ({ ...t, fields: { ...t.fields, to_city: e.target.value } }))}
                                className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-background" />
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-1">السعر ₪</p>
                              <input type="number" value={editingTrip.fields.price}
                                onChange={e => setEditingTrip(t => ({ ...t, fields: { ...t.fields, price: e.target.value } }))}
                                className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-background" />
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-1">المقاعد المتاحة</p>
                              <input type="number" value={editingTrip.fields.available_seats}
                                onChange={e => setEditingTrip(t => ({ ...t, fields: { ...t.fields, available_seats: e.target.value } }))}
                                className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-background" />
                            </div>
                            <div className="sm:col-span-2">
                              <p className="text-[10px] text-muted-foreground mb-1">ملاحظة السائق</p>
                              <input value={editingTrip.fields.driver_note}
                                onChange={e => setEditingTrip(t => ({ ...t, fields: { ...t.fields, driver_note: e.target.value } }))}
                                className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-background" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs gap-1"
                              disabled={editTrip.isPending}
                              onClick={() => editTrip.mutate({ id: editingTrip.id, fields: editingTrip.fields })}>
                              <Check className="w-3 h-3" />حفظ
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                              onClick={() => setEditingTrip(null)}>
                              <X className="w-3 h-3" />إلغاء
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
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