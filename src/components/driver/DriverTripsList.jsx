import React, { useState, useEffect, useCallback } from "react";
import { useGPSTripCompletion } from "@/lib/gpsTracking";
import DriverReviewWizard from "@/components/reviews/DriverReviewWizard";
import GPSTripTracker from "@/components/driver/GPSTripTracker";
import { createPortal } from "react-dom";
import { logAudit } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Clock, Users, ArrowLeft, Trash2, CheckCircle, AlertCircle, Pencil, X, Play, Flag, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

export default function DriverTripsList({ trips, bookings, loading, onSelectTrip, driverUser }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [editingTrip, setEditingTrip] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [confirmDialog, setConfirmDialog] = useState(null); // { tripId, action: "start"|"complete" }
  const [deleteConfirm, setDeleteConfirm] = useState(null); // tripId to delete

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
    onSuccess: async (_, { id, data, trip, bookings: tripBookings }) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      if (data.status === "in_progress") {
        toast.success("🚗 انطلقت الرحلة!");
        // Notify all confirmed passengers
        const passengers = (tripBookings || []).filter(b => b.trip_id === id && b.status === "confirmed");
        await Promise.allSettled(passengers.map(b =>
          base44.entities.Notification.create({
            user_email: b.passenger_email,
            title: "رحلتك انطلقت! 🚗",
            message: `السائق ${trip?.driver_name || ""} انطلق من ${trip?.from_city} إلى ${trip?.to_city}. استعد للوصول خلال ${trip?.duration || "المدة المحددة"}.`,
            type: "system", trip_id: id, is_read: false,
          })
        ));
      } else if (data.status === "completed") {
        toast.success("✅ تم إنهاء الرحلة بنجاح!");
        // Notify passengers trip completed — with rating prompt
        const passengers = (tripBookings || []).filter(b => b.trip_id === id && b.status === "confirmed");
        await Promise.allSettled(passengers.map(b =>
          base44.entities.Notification.create({
            user_email: b.passenger_email,
            title: "اكتملت الرحلة ✅ — قيّم السائق",
            message: `وصلت رحلتك من ${trip?.from_city} إلى ${trip?.to_city} مع السائق ${trip?.driver_name || ""}. شكراً لاستخدامك مشوارو! اذهب إلى رحلاتي وقيّم السائق لمساعدة المجتمع.`,
            type: "system", trip_id: id, is_read: false,
          })
        ));
      } else {
        toast.success("تم تحديث الحالة");
      }
    },
  });

  // Real-time subscription — status updates instantly without reload
  useEffect(() => {
    const unsub = base44.entities.Trip.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
    });
    return () => unsub();
  }, [qc]);

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
              <div key={trip.id}>
              {trip.status === "in_progress" && (
                <GPSTripTracker
                  trip={trip}
                  bookings={bookings}
                  driverUser={driverUser}
                />
              )}
              <div className="bg-card rounded-2xl border border-border p-4 hover:shadow-sm transition-all">
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
                      onClick={() => setConfirmDialog({ tripId: trip.id, action: "start", trip })}
                    >
                      <Play className="w-3 h-3" />
                      بدء الرحلة
                    </Button>
                  )}

                  {trip.status === "in_progress" && (
                    <Button
                      size="sm"
                      className="rounded-lg text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setConfirmDialog({ tripId: trip.id, action: "complete", trip })}
                    >
                      <Flag className="w-3.5 h-3.5" />
                      إنهاء الرحلة
                    </Button>
                  )}

                  {trip.status !== "completed" && (
                    <button
                      className="rounded-lg text-xs text-destructive hover:bg-destructive/10 mr-auto gap-1 flex items-center px-2 py-1.5 border border-destructive/20 hover:border-destructive/40 transition-colors"
                      onClick={() => setDeleteConfirm(trip.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      حذف
                    </button>
                  )}
                </div>
              </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Delete Confirm Modal */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 bg-black/50" dir="rtl">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-6 h-6 text-destructive" />
              </div>
              <h3 className="font-bold text-lg text-foreground">حذف الرحلة</h3>
              <p className="text-sm text-muted-foreground mt-1">هل أنت متأكد من حذف هذه الرحلة؟ لا يمكن التراجع عن هذا الإجراء.</p>
              {deleteConfirm && (() => {
                const trip = trips?.find(t => t.id === deleteConfirm);
                const pax = bookings?.filter(b => b.trip_id === deleteConfirm && b.status !== "cancelled").length || 0;
                return pax > 0 ? (
                  <div className="mt-2 p-2 bg-destructive/10 rounded-lg text-xs text-destructive font-medium">
                    ⚠️ يوجد {pax} {pax === 1 ? "راكب محجوز" : "ركاب محجوزون"} — سيتم إلغاء حجوزاتهم
                  </div>
                ) : null;
              })()}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setDeleteConfirm(null)}>
                إلغاء
              </Button>
              <Button
                className="flex-1 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={() => { deleteMutation.mutate(deleteConfirm); setDeleteConfirm(null); }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "جاري الحذف..." : "حذف نهائياً"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
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