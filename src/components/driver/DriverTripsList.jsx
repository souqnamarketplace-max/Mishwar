import React, { useState } from "react";
import { logAudit } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Clock, Users, ArrowLeft, Trash2, CheckCircle, AlertCircle, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const statusConfig = {
  confirmed: { label: "مؤكدة", className: "bg-primary/10 text-primary" },
  in_progress: { label: "جارية", className: "bg-yellow-500/10 text-yellow-600" },
  completed: { label: "مكتملة", className: "bg-green-500/10 text-green-600" },
  cancelled: { label: "ملغاة", className: "bg-destructive/10 text-destructive" },
};

export default function DriverTripsList({ trips, bookings, loading, onSelectTrip }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [editingTrip, setEditingTrip] = useState(null);
  const [editForm, setEditForm] = useState({});

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Trip.update(id, data),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["trips"] });
      const prev = qc.getQueryData(["trips"]);
      qc.setQueryData(["trips"], old => 
        old?.map(t => t.id === id ? { ...t, ...data } : t) || []
      );
      return prev;
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData(["trips"], ctx);
      toast.error("فشل التحديث");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("تم تحديث الحالة");
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Trip.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      setEditingTrip(null);
      toast.success("تم تحديث الرحلة ✅");
    },
    onError: () => toast.error("فشل التحديث"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Trip.delete(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["trips"] });
      const prev = qc.getQueryData(["trips"]);
      qc.setQueryData(["trips"], old => old?.filter(t => t.id !== id) || []);
      return prev;
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData(["trips"], ctx);
      toast.error("فشل الحذف");
    },
    onSuccess: (_, tripId) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("تم حذف الرحلة");
      const trip = trips?.find(t => t.id === tripId);
      logAudit("driver_delete_trip", "trip", tripId, {
        route: trip ? `${trip.from_city} → ${trip.to_city}` : null,
        date:  trip?.date,
        driver_email: trip?.driver_email,
      });
    },
  });

  const filters = [
    { id: "all", label: "الكل" },
    { id: "confirmed", label: "مؤكدة" },
    { id: "in_progress", label: "جارية" },
    { id: "completed", label: "مكتملة" },
  ];

  const filtered = filter === "all" ? trips : trips.filter((t) => t.status === filter);

  const getTripPassengers = (tripId) =>
    bookings.filter((b) => b.trip_id === tripId && b.status !== "cancelled").length;

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-card rounded-2xl border border-border p-5 animate-pulse h-28" />
      ))}
    </div>
  );

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">لا توجد رحلات</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((trip) => {
            const pax = getTripPassengers(trip.id);
            const cfg = statusConfig[trip.status] || statusConfig.confirmed;
            return (
              <div key={trip.id} className="bg-card rounded-2xl border border-border p-4 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 font-bold text-foreground">
                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                    <span>{trip.from_city}</span>
                    <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                    <span>{trip.to_city}</span>
                  </div>
                  <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{trip.date} • {trip.time}</span>
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{pax} راكب</span>
                  <span className="font-bold text-primary">₪{trip.price}</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg text-xs gap-1"
                    onClick={() => onSelectTrip(trip.id)}
                  >
                    <Users className="w-3.5 h-3.5" />
                    عرض الركاب ({pax})
                  </Button>
                  {trip.status !== "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg text-xs gap-1"
                      onClick={() => { setEditingTrip(trip.id); setEditForm({ price: trip.price, time: trip.time, available_seats: trip.available_seats, driver_note: trip.driver_note || "" }); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      تعديل
                    </Button>
                  )}

                  {trip.status === "confirmed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg text-xs gap-1 text-yellow-600 border-yellow-200"
                      onClick={() => updateMutation.mutate({ id: trip.id, data: { status: "in_progress" } })}
                    >
                      بدء الرحلة
                    </Button>
                  )}

                  {trip.status === "in_progress" && (
                    <Button
                      size="sm"
                      className="rounded-lg text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => updateMutation.mutate({ id: trip.id, data: { status: "completed" } })}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      إنهاء الرحلة
                    </Button>
                  )}

                  {trip.status !== "completed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-lg text-xs text-destructive hover:bg-destructive/10 mr-auto"
                      onClick={async () => {
                        const activeBookings = bookings.filter(
                          b => b.trip_id === trip.id && ['pending','confirmed'].includes(b.status)
                        );
                        if (activeBookings.length > 0) {
                          const msg = `هذه الرحلة لديها ${activeBookings.length} حجز نشط. سيتم إلغاء جميع الحجوزات وإخطار الركاب. هل تريد المتابعة؟`;
                          if (!confirm(msg)) return;
                          // Cancel all active bookings and notify each passenger
                          await Promise.all(activeBookings.map(async (b) => {
                            try {
                              await base44.entities.Booking.update(b.id, { status: 'cancelled' });
                              await base44.entities.Notification.create({
                                user_email: b.passenger_email,
                                title: 'تم إلغاء رحلتك ⚠️',
                                message: `عذراً، قام السائق بإلغاء الرحلة من ${trip.from_city} إلى ${trip.to_city} بتاريخ ${trip.date} الساعة ${trip.time}. تم إلغاء حجزك تلقائياً.`,
                                type: 'system',
                                trip_id: trip.id,
                                is_read: false,
                              });
                            } catch (e) { console.warn('Failed to cancel booking/notify:', e); }
                          }));
                        } else {
                          if (!confirm('هل تريد حذف هذه الرحلة؟')) return;
                        }
                        deleteMutation.mutate(trip.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Edit Trip Modal */}
      {editingTrip && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm" dir="rtl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">تعديل الرحلة</h3>
              <button onClick={() => setEditingTrip(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground">السعر (₪)</label>
                <Input type="number" value={editForm.price} onChange={e => setEditForm(f => ({...f, price: parseFloat(e.target.value)}))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">وقت الانطلاق</label>
                <Input type="time" value={editForm.time} onChange={e => setEditForm(f => ({...f, time: e.target.value}))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">المقاعد المتاحة</label>
                <Input type="number" min="0" max="8" value={editForm.available_seats} onChange={e => setEditForm(f => ({...f, available_seats: parseInt(e.target.value)}))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">ملاحظة للركاب</label>
                <textarea value={editForm.driver_note} onChange={e => setEditForm(f => ({...f, driver_note: e.target.value}))} className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm resize-none h-16" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1 rounded-xl" onClick={() => editMutation.mutate({ id: editingTrip, data: editForm })} disabled={editMutation.isPending}>
                  {editMutation.isPending ? "جاري الحفظ..." : "حفظ التعديلات"}
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={() => setEditingTrip(null)}>إلغاء</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}