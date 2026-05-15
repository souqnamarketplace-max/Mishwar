import React, { useState, useEffect } from "react";
import DriverReviewWizard from "@/components/reviews/DriverReviewWizard";
import GPSTripTracker from "@/components/driver/GPSTripTracker";
import { createPortal } from "react-dom";
import { logAudit } from "@/lib/adminAudit";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
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
  // Time-change dialog state. action='change_time' with the current
  // trip object so the modal can pre-fill the time input + show
  // the route header. Sized to ~60 minutes either side so the
  // server-side delta gate doesn't reject a legitimate adjustment.
  const [timeChangeDialog, setTimeChangeDialog] = useState(null); // { trip, newTime }

  const cancelMutation = useMutation({
    mutationFn: async (tripId) => {
      await api.entities.Trip.update(tripId, { status: "cancelled" });
      // Pull BOTH pending and confirmed bookings on this trip so they
      // all get flipped to cancelled_by_driver. Previously this only
      // pulled confirmed bookings, leaving pending ones stuck — a
      // passenger whose request was waiting for driver approval at
      // the moment the driver cancelled the trip ended up with a
      // pending booking on a cancelled trip forever, with no UI to
      // get out of that state.
      // Also captures the trip data here (name + cities) so we can
      // include them in the passenger notifications below.
      const tripData = await api.entities.Trip.get(tripId).catch(() => null);
      const bookings = await api.entities.Booking.filter(
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
          return api.entities.Booking.update(b.id, {
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
            // Cancelled by driver — passenger lands on الملغاة tab where
            // the booking's reason field renders 'ألغاه السائق' so they
            // can immediately see who triggered it.
            link: "/my-trips?tab=cancelled",
          })
        )
      );

      return { tripId, affected: affected.length, failedUpdates };
    },
    onSuccess: ({ tripId, affected, failedUpdates }) => {
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
      // Audit log — was previously missing. The matching driver_delete_trip
      // path lower in this file (deleteMutation.onSuccess) already writes
      // its own entry; this restores parity so admins reviewing
      // strike-eligible behaviour can see BOTH soft cancellations
      // (trip stays in the DB with status='cancelled', bookings flip to
      // 'cancelled_by_driver') AND hard deletes, and tell which one
      // happened on any given driver/date pair. The metadata schema is
      // intentionally identical to driver_delete_trip's so the two
      // actions can be union-queried without column gymnastics. The
      // affected_passengers + failed_updates counters are unique to
      // cancellation — deletes happen on trips with zero non-cancelled
      // bookings (enforced by the UI confirm step) so they're not
      // meaningful there.
      const trip = trips?.find(t => t.id === tripId);
      logAudit("driver_cancel_trip", "trip", tripId, {
        route: trip ? `${trip.from_city} → ${trip.to_city}` : null,
        date:  trip?.date,
        driver_email: trip?.driver_email,
        affected_passengers: affected,
        failed_updates: failedUpdates,
      });
    },
    onError: (err) => toast.error(friendlyError(err, "فشل إلغاء الرحلة")),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Lifecycle transitions go through SECURITY DEFINER RPCs
      // (migration 048) which enforce: driver ownership, status
      // precondition, time gate on start. Other field edits
      // (price, seats, driver_note, etc.) keep using Trip.update.
      if (data.status === "in_progress") {
        const { error } = await supabase.rpc("start_trip", { p_trip_id: id });
        if (error) throw error;
        return { id };
      }
      if (data.status === "completed") {
        const { error } = await supabase.rpc("complete_trip", { p_trip_id: id });
        if (error) throw error;
        return { id };
      }
      return api.entities.Trip.update(id, data);
    },
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
            // Live trip → land in the in-progress tab where the user
            // sees the trip's live status, can message the driver, etc.
            link: "/my-trips?tab=in_progress",
          })
        ));
        // Audit log — trip lifecycle transitions were previously
        // unaudited, so admins reviewing complaints ("driver started
        // the trip late" / "driver never marked complete") had no
        // server-side timestamp to compare against the passenger's
        // claim. logAudit goes through logAdminAction (lib/adminAudit
        // .js) and stamps the call site's auth.uid + now() server-
        // side, so this is the canonical record of when the driver
        // tapped Start.
        logAudit("driver_start_trip", "trip", id, {
          route: trip ? `${trip.from_city} → ${trip.to_city}` : null,
          date:  trip?.date,
          driver_email: trip?.driver_email,
          notified_passengers: passengers.length,
        });
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
            // Lands on completed tab — taps the trip → opens the
            // PassengerReviewWizard so they can rate the driver
            // straight from the notification.
            link: "/my-trips?tab=completed",
          })
        ));
        // Same rationale as the in_progress branch above. Distinct
        // action name so an admin reviewing a single trip's audit
        // trail sees the full lifecycle: created → start → complete
        // (or → cancel). Without these entries the trail had a hole
        // from create to either complete-by-cron or cancel.
        logAudit("driver_complete_trip", "trip", id, {
          route: trip ? `${trip.from_city} → ${trip.to_city}` : null,
          date:  trip?.date,
          driver_email: trip?.driver_email,
          notified_passengers: passengers.length,
        });
      } else {
        toast.success("تم تحديث الحالة");
      }
    },
  });

  // Time-change mutation — calls the change_trip_time RPC (migration
  // 048) which enforces driver ownership + ≤60-minute delta + same
  // date + status=confirmed + past-date guard, AND inserts a
  // notification row for every active booking with the new time and
  // a deep-link to /my-trips?tab=confirmed where the passenger can
  // cancel if the change doesn't suit them. Notifications happen
  // server-side inside the RPC so they're atomic with the time update
  // — no race where the time updates but notifications fail.
  const changeTimeMutation = useMutation({
    mutationFn: async ({ tripId, newTime }) => {
      const { data, error } = await supabase.rpc("change_trip_time", {
        p_trip_id:  tripId,
        p_new_time: newTime,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (updatedTrip, { tripId, newTime, oldTime, bookingsCount }) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      setTimeChangeDialog(null);
      toast.success(
        bookingsCount > 0
          ? `تم تحديث الوقت وإشعار ${bookingsCount} ${bookingsCount === 1 ? "راكب" : "ركاب"} ✅`
          : "تم تحديث الوقت ✅"
      );
      logAudit("driver_change_trip_time", "trip", tripId, {
        old_time: oldTime,
        new_time: newTime,
        notified_passengers: bookingsCount || 0,
      });
    },
    onError: (err) => toast.error(friendlyError(err, "فشل تحديث الوقت")),
  });

  // Real-time subscription — status updates instantly without reload
  useEffect(() => {
    const unsub = api.entities.Trip.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
    });
    return () => unsub();
  }, [qc]);

  const editMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.Trip.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      setEditingTrip(null);
      toast.success("تم تحديث الرحلة ✅");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل تحديث الرحلة")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.Trip.delete(id),
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

                  {/* Time-change — only on confirmed trips. Passengers are
                      notified server-side via the change_trip_time RPC.
                      Server enforces ≤60-min delta; anything bigger
                      requires cancel & repost. */}
                  {trip.status === "confirmed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg text-xs gap-1 text-blue-600 border-blue-200"
                      onClick={() => setTimeChangeDialog({ trip, newTime: trip.time || "" })}
                    >
                      <Clock className="w-3 h-3" />
                      تعديل الوقت
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

      {/* ─── Start / Complete Trip Confirmation Modal ──────────────────
          Was previously declared via setConfirmDialog state but never
          rendered — the buttons set state, no modal ever appeared, and
          the trip lifecycle was completely unreachable in production.
          This is the fix that ships in the same commit as the
          start_trip / complete_trip RPCs (migration 048).

          Two actions: 'start' (confirmed → in_progress) and 'complete'
          (in_progress → completed). Each shows its own copy + passenger
          count + GPS hint where appropriate.

          createPortal so fixed-position layout escapes any
          framer-motion transform on ancestors (same reason as the
          other modals in this component). */}
      {confirmDialog && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center px-4 bg-black/50"
          dir="rtl"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDialog(null); }}
        >
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-2xl">
            {(() => {
              const isStart = confirmDialog.action === "start";
              const trip = confirmDialog.trip;
              const pax = bookings?.filter(b => b.trip_id === confirmDialog.tripId && b.status === "confirmed").length || 0;
              return (
                <>
                  <div className="text-center mb-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
                      isStart ? "bg-yellow-500/10" : "bg-green-500/10"
                    }`}>
                      {isStart
                        ? <Play className="w-6 h-6 text-yellow-600" />
                        : <Flag className="w-6 h-6 text-green-600" />}
                    </div>
                    <h3 className="font-bold text-lg text-foreground">
                      {isStart ? "بدء الرحلة" : "إنهاء الرحلة"}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isStart
                        ? "هل تريد بدء هذه الرحلة الآن؟ سيتم إشعار الركاب وتفعيل تتبع GPS لإنهاء الرحلة تلقائياً عند الوصول."
                        : "هل تريد تأكيد إنهاء هذه الرحلة؟ سيتم إشعار الركاب وفتح صفحة تقييم الركاب."}
                    </p>
                    {/* Trip identity — gives the driver a chance to
                        bail if they tapped the wrong trip card */}
                    {trip && (
                      <div className="mt-3 p-2 bg-muted/40 rounded-lg text-xs text-muted-foreground">
                        {trip.from_city} ← {trip.to_city}
                        {trip.date ? ` · ${trip.date}` : ""}
                        {trip.time ? ` · ${trip.time}` : ""}
                      </div>
                    )}
                    {/* Passenger-count line: for 'start' it's an FYI
                        ('N passengers will be notified'); for
                        'complete' it's the same FYI plus a hint that
                        the review wizard will open. */}
                    <div className="mt-2 p-2 bg-primary/5 rounded-lg text-xs text-primary font-medium">
                      {pax > 0
                        ? `${pax} ${pax === 1 ? "راكب مؤكد" : "ركاب مؤكدون"} ${isStart ? "سيتم إشعارهم" : "سيتم إشعارهم بانتهاء الرحلة"}`
                        : "لا يوجد ركاب مؤكدون"}
                    </div>
                    {isStart && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        📍 سيُطلب منك السماح بالوصول إلى الموقع لإنهاء الرحلة تلقائياً
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setConfirmDialog(null)}>
                      تراجع
                    </Button>
                    <Button
                      className={`flex-1 rounded-xl text-white ${
                        isStart ? "bg-yellow-600 hover:bg-yellow-700" : "bg-green-600 hover:bg-green-700"
                      }`}
                      onClick={() => {
                        const tripBookings = bookings?.filter(b => b.trip_id === confirmDialog.tripId) || [];
                        updateMutation.mutate({
                          id: confirmDialog.tripId,
                          data: { status: isStart ? "in_progress" : "completed" },
                          trip: trip,
                          bookings: tripBookings,
                        });
                        setConfirmDialog(null);
                      }}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending
                        ? "جاري..."
                        : isStart ? "نعم، ابدأ الرحلة" : "نعم، أنهِ الرحلة"}
                    </Button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

      {/* ─── Time-Change Modal ──────────────────────────────────────────
          Driver picks a new departure time. Server enforces same-date
          and ≤60-minute delta. Passengers get notifications with the
          new time + a deep-link to /my-trips?tab=confirmed where they
          can cancel via the existing booking-cancel flow if the new
          time doesn't suit them. */}
      {timeChangeDialog && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center px-4 bg-black/50"
          dir="rtl"
          onClick={(e) => { if (e.target === e.currentTarget) setTimeChangeDialog(null); }}
        >
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-2xl">
            {(() => {
              const trip = timeChangeDialog.trip;
              const pax = bookings?.filter(
                b => b.trip_id === trip.id && (b.status === "confirmed" || b.status === "pending")
              ).length || 0;
              // Compute delta in minutes for live feedback. Both
              // values are 'HH:MM' or 'HH:MM:SS' strings; parse the
              // first two segments as hours and minutes.
              const toMin = (t) => {
                if (!t) return 0;
                const [h, m] = t.split(":");
                return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
              };
              const delta = Math.abs(toMin(timeChangeDialog.newTime) - toMin(trip.time));
              const deltaSign = toMin(timeChangeDialog.newTime) > toMin(trip.time) ? "+" : "-";
              const tooLarge = delta > 60;
              const noChange = timeChangeDialog.newTime === trip.time || !timeChangeDialog.newTime;
              return (
                <>
                  <div className="text-center mb-4">
                    <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
                      <Clock className="w-6 h-6 text-blue-600" />
                    </div>
                    <h3 className="font-bold text-lg text-foreground">تعديل وقت الرحلة</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      اختر موعداً جديداً للانطلاق. سيتم إشعار جميع الركاب بالتغيير.
                    </p>
                    <div className="mt-3 p-2 bg-muted/40 rounded-lg text-xs text-muted-foreground">
                      {trip.from_city} ← {trip.to_city} · {trip.date}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-foreground">الموعد الحالي</label>
                      <span className="text-sm font-mono text-muted-foreground" dir="ltr">
                        {trip.time || "—"}
                      </span>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground block mb-1">الموعد الجديد</label>
                      <input
                        type="time"
                        value={timeChangeDialog.newTime}
                        onChange={(e) => setTimeChangeDialog(prev => ({ ...prev, newTime: e.target.value }))}
                        className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm font-mono"
                        dir="ltr"
                      />
                    </div>

                    {/* Live delta feedback. Three states:
                          - no change yet: show nothing
                          - within 60min: green hint with the delta
                          - over 60min: red error + cancel/repost hint */}
                    {!noChange && !tooLarge && (
                      <div className="p-2 bg-green-500/10 rounded-lg text-xs text-green-700 font-medium">
                        ✓ الفرق: {deltaSign}{delta} دقيقة
                      </div>
                    )}
                    {tooLarge && (
                      <div className="p-2 bg-destructive/10 rounded-lg text-xs text-destructive font-medium">
                        ⚠️ الفرق أكبر من 60 دقيقة. للتغييرات الكبيرة يجب إلغاء الرحلة وإعادة نشرها.
                      </div>
                    )}
                    {pax > 0 && !noChange && !tooLarge && (
                      <div className="p-2 bg-primary/5 rounded-lg text-xs text-primary font-medium">
                        🔔 سيتم إشعار {pax} {pax === 1 ? "راكب" : "ركاب"} وسيكون بإمكانهم إلغاء الحجز إذا لم يناسبهم الوقت الجديد
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 mt-4">
                    <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setTimeChangeDialog(null)}>
                      تراجع
                    </Button>
                    <Button
                      className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => {
                        changeTimeMutation.mutate({
                          tripId: trip.id,
                          newTime: timeChangeDialog.newTime,
                          oldTime: trip.time,
                          bookingsCount: pax,
                        });
                      }}
                      disabled={noChange || tooLarge || changeTimeMutation.isPending}
                    >
                      {changeTimeMutation.isPending ? "جاري..." : "تحديث وإشعار الركاب"}
                    </Button>
                  </div>
                </>
              );
            })()}
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