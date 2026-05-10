import React, { useState, useEffect, useCallback } from "react";
import { useGPSTripCompletion } from "@/lib/gpsTracking";
import DriverReviewWizard from "@/components/reviews/DriverReviewWizard";
import GPSTripTracker from "@/components/driver/GPSTripTracker";
import { createPortal } from "react-dom";
import { logAudit } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { notifyUser } from "@/lib/notifyUser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Clock, Users, ArrowLeft, Trash2, CheckCircle, AlertCircle, Pencil, X, Play, Flag, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { todayISO, isFutureOrToday } from "@/lib/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

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
  const [confirmCancel, setConfirmCancel] = useState(null); // tripId to cancel

  const cancelMutation = useMutation({
    mutationFn: async (tripId) => {
      await base44.entities.Trip.update(tripId, { status: "cancelled" });
      // Pull BOTH pending and confirmed bookings on this trip so they
      // all get flipped to cancelled_by_driver. Previously this only
      // pulled confirmed bookings, leaving pending ones stuck — a
      // passenger whose request was waiting for driver approval at
      // the moment the driver cancelled the trip ended up with a
      // pending booking on a cancelled trip forever, with no UI to
      // get out of that state.
      // Also captures the trip data here (name + cities) so we can
      // include them in the passenger notifications below.
      const tripData = await base44.entities.Trip.get(tripId).catch(() => null);
      const bookings = await base44.entities.Booking.filter(
        { trip_id: tripId },
        "-created_date",
        200
      );
      const affected = bookings.filter(b => b.status === "pending" || b.status === "confirmed");

      // Update booking rows. Track failures so the toast can report
      // accurately instead of claiming success when half the bookings
      // didn't actually move. allSettled lets independent updates
      // proceed if one row hits a transient error.
      const updateResults = await Promise.allSettled(
        affected.map(b => {
          // Cash bookings can't be "paid" in-flight, but transfer/Jawwal/
          // Reflect bookings can be — flag those for the admin refund queue.
          const refundFields = b.payment_status === "paid"
            ? { refund_required: true, refund_status: "pending" }
            : {};
          return base44.entities.Booking.update(b.id, {
            status: "cancelled_by_driver",
            ...refundFields,
          });
        })
      );
      const failedUpdates = updateResults.filter(r => r.status === "rejected").length;

      // Send actual notifications. The previous toast claimed
      // \"وإعلام الركاب\" but there was no Notification.create call
      // anywhere in this flow — passengers got zero notification.
      // They saw their booking status flip in /my-trips next time
      // they opened the app but had no push, no bell-icon nudge,
      // no Arabic explanation of what happened.
      // Best-effort: we still flipped the bookings even if some
      // notification inserts fail (allSettled, silent).
      const route = tripData
        ? `من ${tripData.from_city} إلى ${tripData.to_city}`
        : "";
      const date = tripData?.date || "";
      await Promise.allSettled(
        affected.map(b =>
          notifyUser({
            user_email: b.passenger_email,
            title: "تم إلغاء الرحلة من قبل السائق",
            message: `نأسف، السائق ألغى الرحلة ${route} ${date ? `بتاريخ ${date}` : ""}. ` +
              (b.payment_status === "paid"
                ? "سيتم استرداد المبلغ المدفوع — تابع الإشعارات."
                : "ابحث عن رحلة بديلة على نفس المسار."),
            type: "system",
            trip_id: tripId,
            link: "/my-trips",
          })
        )
      );

      return { tripId, affected: affected.length, failedUpdates };
    },
    onSuccess: ({ affected, failedUpdates }) => {
      // Honest toast — match what actually happened. The previous
      // \"تم إلغاء الرحلة وإعلام الركاب\" claimed success even when
      // notifications were never sent.
      if (failedUpdates === 0) {
        toast.success(
          affected === 0
            ? "تم إلغاء الرحلة"
            : `تم إلغاء الرحلة وإشعار ${affected} راكب`
        );
      } else {
        toast.warning(
          `تم إلغاء الرحلة، لكن لم نتمكن من تحديث ${failedUpdates} حجز. ` +
          `يمكنك مراجعتها من قائمة الرحلات.`
        );
      }
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
    },
    onError: (err) => toast.error(friendlyError(err, "فشل إلغاء الرحلة")),
  });

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
      toast.error(friendlyError(err, "فشل تحديث الرحلة"));
    },
    onSuccess: async (_, { id, data, trip, bookings: tripBookings }) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      if (data.status === "in_progress") {
        toast.success("🚗 انطلقت الرحلة!");
        // Notify all confirmed passengers
        const passengers = (tripBookings || []).filter(b => b.trip_id === id && b.status === "confirmed");
        await Promise.allSettled(passengers.map(b =>
          notifyUser({
            user_email: b.passenger_email,
            title: "رحلتك انطلقت! 🚗",
            message: `السائق ${trip?.driver_name || ""} انطلق من ${trip?.from_city} إلى ${trip?.to_city}. استعد للوصول خلال ${trip?.duration || "المدة المحددة"}.`,
            type: "system",
            trip_id: id,
          })
        ));
      } else if (data.status === "completed") {
        toast.success("✅ تم إنهاء الرحلة بنجاح!");
        // Notify passengers trip completed — with rating prompt
        const passengers = (tripBookings || []).filter(b => b.trip_id === id && b.status === "confirmed");
        await Promise.allSettled(passengers.map(b =>
          notifyUser({
            user_email: b.passenger_email,
            title: "اكتملت الرحلة ✅ — قيّم السائق",
            message: `وصلت رحلتك من ${trip?.from_city} إلى ${trip?.to_city} مع السائق ${trip?.driver_name || ""}. شكراً لاستخدامك مشوارو! اذهب إلى رحلاتي وقيّم السائق لمساعدة المجتمع.`,
            type: "system",
            trip_id: id,
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
    onError: (err) => toast.error(friendlyError(err, "فشل تحديث الرحلة")),
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
      toast.error(friendlyError(err, "فشل حذف الرحلة"));
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
                      onClick={() => {
                        setEditingTrip(trip.id);
                        setEditForm({
                          price: trip.price,
                          time: trip.time,
                          date: trip.date,
                          available_seats: trip.available_seats,
                          driver_note: trip.driver_note || "",
                          from_city: trip.from_city,
                          to_city: trip.to_city,
                          stops: Array.isArray(trip.stops) ? trip.stops : [],
                          amenities: Array.isArray(trip.amenities) ? trip.amenities : [],
                          payment_methods: Array.isArray(trip.payment_methods) ? trip.payment_methods : ["cash"],
                          _bookingsCount: trip.bookings_count || 0, // not sent — used to gate UI
                          _tripData: trip, // keep ref to original for reset
                        });
                      }}
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

                  {trip.status !== "completed" && trip.status !== "cancelled" && (
                    <button
                      className="rounded-lg text-xs text-yellow-700 hover:bg-yellow-500/10 gap-1 flex items-center px-2 py-1.5 border border-yellow-500/30 hover:border-yellow-500/50 transition-colors"
                      onClick={() => setConfirmCancel(trip.id)}
                    >
                      <span>⚠️</span>
                      إلغاء الرحلة
                    </button>
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
      {confirmCancel && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 bg-black/50" dir="rtl" onClick={(e) => { if (e.target === e.currentTarget) setConfirmCancel(null); }}>
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">⚠️</span>
              </div>
              <h3 className="font-bold text-lg text-foreground">إلغاء الرحلة</h3>
              <p className="text-sm text-muted-foreground mt-1">هل أنت متأكد من إلغاء هذه الرحلة؟ لا يمكن التراجع عن هذا الإجراء.</p>
              {(() => {
                const trip = trips?.find(t => t.id === confirmCancel);
                const pax = bookings?.filter(b => b.trip_id === confirmCancel && b.status === "confirmed").length || 0;
                return pax > 0 ? (
                  <div className="mt-2 p-2 bg-yellow-500/10 rounded-lg text-xs text-yellow-700 font-medium">
                    ⚠️ سيتم إعلام {pax} {pax === 1 ? "راكب محجوز" : "ركاب محجوزون"} وسيُسترد المبلغ المدفوع
                  </div>
                ) : (
                  <div className="mt-2 p-2 bg-muted/40 rounded-lg text-xs text-muted-foreground">
                    لا يوجد ركاب محجوزون — سيتم إخفاء الرحلة من نتائج البحث
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setConfirmCancel(null)}>
                تراجع
              </Button>
              <Button
                className="flex-1 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={() => { cancelMutation.mutate(confirmCancel); setConfirmCancel(null); }}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? "جاري الإلغاء..." : "نعم، إلغاء الرحلة"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Edit Trip Modal — expanded */}
      {editingTrip && (
        <div className="fixed inset-0 bg-black/50 z-[2000] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditingTrip(null); }}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl border border-border w-full sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h3 className="font-bold text-foreground">تعديل الرحلة</h3>
              <button onClick={() => setEditingTrip(null)} aria-label="إغلاق"><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>

            {/* Editability indicator */}
            <div className={`mx-4 mt-4 p-3 rounded-xl text-xs flex items-start gap-2 ${
              (editForm._bookingsCount || 0) === 0
                ? "bg-green-500/10 border border-green-500/30 text-green-700"
                : "bg-yellow-500/10 border border-yellow-500/30 text-yellow-700"
            }`}>
              <span>{(editForm._bookingsCount || 0) === 0 ? "🔓" : "🔒"}</span>
              <span className="flex-1">
                {(editForm._bookingsCount || 0) === 0
                  ? "لا يوجد ركاب محجوزون — يمكن تعديل جميع الحقول"
                  : `يوجد ${editForm._bookingsCount} ركاب محجوزون — لا يمكن تعديل الوجهات أو التاريخ`}
              </span>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">السعر (₪)</label>
                <Input type="number" min="1" max="1000" value={editForm.price ?? ""} onChange={e => setEditForm(f => ({...f, price: parseFloat(e.target.value)}))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">وقت الانطلاق</label>
                <Input type="time" value={editForm.time ?? ""} onChange={e => setEditForm(f => ({...f, time: e.target.value}))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">المقاعد المتاحة</label>
                <Input type="number" min="1" max="8" value={editForm.available_seats ?? ""} onChange={e => setEditForm(f => ({...f, available_seats: parseInt(e.target.value)}))} className="mt-1 h-10 rounded-xl" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">ملاحظة للركاب</label>
                <textarea value={editForm.driver_note ?? ""} onChange={e => setEditForm(f => ({...f, driver_note: e.target.value}))} className="w-full mt-1 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm resize-none h-16" />
              </div>

              {/* Cities + Date — only when 0 bookings */}
              {(editForm._bookingsCount || 0) === 0 && (
                <>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-bold text-muted-foreground mb-3">الوجهات والتاريخ</p>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div>
                        <label className="text-xs text-muted-foreground">من</label>
                        <Input value={editForm.from_city ?? ""} onChange={e => setEditForm(f => ({...f, from_city: e.target.value}))} className="mt-1 h-10 rounded-xl" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">إلى</label>
                        <Input value={editForm.to_city ?? ""} onChange={e => setEditForm(f => ({...f, to_city: e.target.value}))} className="mt-1 h-10 rounded-xl" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">التاريخ</label>
                      <Input type="date" min={todayISO()} value={editForm.date ?? ""} onChange={e => setEditForm(f => ({...f, date: e.target.value}))} className="mt-1 h-10 rounded-xl" />
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-muted-foreground">المحطات</p>
                      <button type="button" onClick={() => setEditForm(f => ({...f, stops: [...(f.stops || []), { city: "", location: "", price_from_origin: 0 }]}))} className="text-xs text-primary hover:underline">+ محطة</button>
                    </div>
                    {(editForm.stops || []).length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">رحلة مباشرة بدون محطات</p>
                    )}
                    {(editForm.stops || []).map((stop, idx) => (
                      <div key={idx} className="bg-muted/40 rounded-xl p-2 mb-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">محطة {idx + 1}</span>
                          <button type="button" onClick={() => setEditForm(f => ({...f, stops: f.stops.filter((_, i) => i !== idx)}))} className="text-xs text-destructive hover:underline">حذف</button>
                        </div>
                        <Input value={stop.city ?? ""} onChange={e => setEditForm(f => ({...f, stops: f.stops.map((s, i) => i === idx ? {...s, city: e.target.value} : s)}))} placeholder="مدينة المحطة" className="h-9 rounded-lg" />
                        <Input type="number" min="0" max="1000" value={stop.price_from_origin ?? 0} onChange={e => setEditForm(f => ({...f, stops: f.stops.map((s, i) => i === idx ? {...s, price_from_origin: parseFloat(e.target.value) || 0} : s)}))} placeholder="السعر (₪)" className="h-9 rounded-lg" />
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Amenities — always editable */}
              <div className="border-t border-border pt-4">
                <p className="text-xs font-bold text-muted-foreground mb-2">المرافق</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "wifi", label: "Wi-Fi" },
                    { id: "ac", label: "تكييف" },
                    { id: "music", label: "موسيقى" },
                    { id: "smoking", label: "مسموح بالتدخين" },
                    { id: "luggage", label: "متاح للأمتعة" },
                  ].map(a => {
                    const isOn = (editForm.amenities || []).includes(a.id);
                    return (
                      <button key={a.id} type="button" onClick={() => setEditForm(f => ({...f, amenities: isOn ? (f.amenities || []).filter(x => x !== a.id) : [...(f.amenities || []), a.id]}))} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${isOn ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground"}`}>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border flex gap-2 sticky bottom-0 bg-card">
              <Button className="flex-1 rounded-xl" onClick={() => {
                // Save-time validation — input attributes don't catch
                // typed-in values that bypass the picker. Block past
                // dates and zero/negative price/seats from going to DB.
                const price = parseFloat(editForm.price);
                if (isNaN(price) || price <= 0) {
                  toast.error("السعر يجب أن يكون أكبر من صفر ⚠️");
                  return;
                }
                const seats = parseInt(editForm.available_seats, 10);
                if (isNaN(seats) || seats < 1) {
                  toast.error("عدد المقاعد يجب أن يكون 1 على الأقل ⚠️");
                  return;
                }
                if (editForm.date && !isFutureOrToday(editForm.date)) {
                  toast.error("لا يمكن نقل الرحلة إلى تاريخ سابق ⚠️");
                  return;
                }
                const cleanStops = (editForm.stops || []).filter(s => s && s.city && s.city.trim()).map(s => ({
                  city: s.city.trim(),
                  location: (s.location || "").trim(),
                  price_from_origin: Math.max(0, Number(s.price_from_origin) || 0),
                }));
                const payload = { ...editForm };
                delete payload._bookingsCount;
                delete payload._tripData;
                payload.stops = cleanStops;
                payload.is_direct = cleanStops.length === 0;
                editMutation.mutate({ id: editingTrip, data: payload });
              }} disabled={editMutation.isPending}>
                {editMutation.isPending ? "جاري الحفظ..." : "حفظ التعديلات"}
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => setEditingTrip(null)}>إلغاء</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}