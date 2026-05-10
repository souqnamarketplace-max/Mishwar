import React from "react";
import { logAudit } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { notifyUser } from "@/lib/notifyUser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, MapPin, ArrowLeft, Phone, Star, CheckCircle, XCircle, MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { DollarSign } from "lucide-react";

const statusConfig = {
  pending: { label: "معلق", className: "bg-yellow-500/10 text-yellow-600" },
  confirmed: { label: "مؤكد", className: "bg-primary/10 text-primary" },
  cancelled: { label: "ملغى", className: "bg-destructive/10 text-destructive" },
  completed: { label: "مكتمل", className: "bg-green-500/10 text-green-600" },
};

export default function DriverPassengers({ trips, bookings, selectedTripId, onSelectTrip }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const updateBooking = useMutation({
    mutationFn: async ({ id, status }) => {
      // Cancel path goes through the cancel_booking RPC (migration 018)
      // so seat refund, authorization, and strike enforcement happen
      // atomically server-side. The previous code did:
      //   1. Booking.update({status:'cancelled'}) — direct table write
      //   2. If old status was 'pending', read trip from cache and
      //      Trip.update with restoredSeats
      // Two real bugs in that flow:
      //   (a) Cancelling a CONFIRMED booking didn't restore seats at
      //       all. The check `booking.status === 'pending'` on line 31
      //       skipped seat restoration for the (much more common)
      //       confirmed-then-cancel path. Trip's available_seats stays
      //       understated for the rest of the trip's life.
      //   (b) The two writes weren't atomic — a network failure
      //       between them left the booking cancelled but seats not
      //       refunded. No retry path.
      //   (c) Reading current trip seats from react-query cache then
      //       writing back the increment is a classic lost-update
      //       race: two drivers (or driver + admin) cancelling
      //       concurrent bookings on the same trip would both read
      //       the same seat count, both add +1, write back the same
      //       new value — losing one cancellation's refund.
      // The RPC fixes all three: PostgreSQL transaction wraps the
      // status update + seat refund (with bounds checks via
      // LEAST/GREATEST), and refunds for both pending AND confirmed.
      // Approve/confirm path still uses Booking.update — that flow
      // doesn't change seat counts.
      if (status === "cancelled") {
        const { error } = await supabase.rpc("cancel_booking", {
          booking_id_param: id,
          reason_param: "driver_cancel",
        });
        if (error) throw error;
        return;
      }
      await base44.entities.Booking.update(id, { status });
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["bookings"] });
      const prev = qc.getQueryData(["bookings"]);
      qc.setQueryData(["bookings"], old => 
        old?.map(b => b.id === id ? { ...b, status } : b) || []
      );
      return prev;
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData(["bookings"], ctx);
      toast.error(friendlyError(err, "فشل تحديث الحجز"));
    },
    onSuccess: async (_, { id, status }) => {
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      // Notify the passenger about the booking status change
      try {
        const allBookings = qc.getQueryData(["driver-bookings"]) ||
                            qc.getQueryData(["bookings"]) || [];
        const booking = allBookings.find(b => b.id === id);
        if (booking?.passenger_email) {
          if (status === "confirmed") {
            await notifyUser({
              user_email: booking.passenger_email,
              title: "تم قبول حجزك ✅",
              message: `تهانينا! تم قبول حجزك. المبلغ المستحق: ₪${booking.total_price}. تحقق من تفاصيل الدفع في صفحة تأكيد الحجز.`,
              type: "system",
              trip_id: booking.trip_id,
            });
            logAudit("driver_confirm_booking", "booking", id, { passenger_email: booking.passenger_email });
            toast.success("تم قبول الحجز وإخطار الراكب ✅");
          } else if (status === "cancelled") {
            await notifyUser({
              user_email: booking.passenger_email,
              title: "تم رفض حجزك ❌",
              message: "عذراً، قام السائق برفض حجزك. يمكنك البحث عن رحلة أخرى.",
              type: "system",
              trip_id: booking.trip_id,
            });
            logAudit("driver_reject_booking", "booking", id, { passenger_email: booking.passenger_email });
            toast.info("تم رفض الحجز وإخطار الراكب");
          } else {
            toast.success("تم تحديث الحجز");
          }
        } else {
          toast.success("تم تحديث الحجز");
        }
      } catch (e) {
        console.warn("[DriverPassengers] notification failed:", e?.message);
        toast.success("تم تحديث الحجز");
      }
    },
  });

  // Driver marks a confirmed booking as paid (cash received in person).
  // Until this session, payment_status was a dead column that never moved
  // off "pending". This is the missing write path on the driver side —
  // the matching admin-side write lives in DashboardPayments.
  const markPaid = useMutation({
    mutationFn: async ({ id, paid }) => {
      await base44.entities.Booking.update(id, {
        payment_status: paid ? "paid" : "pending",
        paid_at: paid ? new Date().toISOString() : null,
      });
    },
    onSuccess: (_, { paid }) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      qc.invalidateQueries({ queryKey: ["payments-summary"] });
      toast.success(paid ? "تم تسجيل الدفع ✓" : "تم التراجع عن تسجيل الدفع");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل تحديث الحجز — حاول مجدداً")),
  });

  // Realtime: booking list updates when any booking changes
  React.useEffect(() => {
    const u = base44.entities.Booking.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    });
    return () => u();
  }, []);

  const selectedTrip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const tripBookings = bookings.filter((b) => b.trip_id === selectedTrip?.id);
  const activeBookings = tripBookings.filter((b) => b.status !== "cancelled");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Trip Selector */}
      <div className="lg:col-span-1">
        <h3 className="font-bold text-sm text-muted-foreground mb-3">اختر رحلة</h3>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {trips.map((trip) => {
            const pax = bookings.filter((b) => b.trip_id === trip.id && b.status !== "cancelled").length;
            const isSelected = trip.id === selectedTrip?.id;
            return (
              <button
                key={trip.id}
                onClick={() => onSelectTrip(trip.id)}
                className={`w-full text-right p-3 rounded-xl border transition-all ${
                  isSelected ? "bg-primary/5 border-primary/30" : "bg-card border-border hover:border-primary/20"
                }`}
              >
                <div className="flex items-center gap-1 font-medium text-sm text-foreground">
                  <span>{trip.from_city}</span>
                  <ArrowLeft className="w-3 h-3 text-muted-foreground" />
                  <span>{trip.to_city}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted-foreground">{trip.date} • {trip.time}</p>
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{pax} راكب</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Passengers List */}
      <div className="lg:col-span-2">
        {selectedTrip ? (
          <>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-foreground">
                {selectedTrip.from_city} ← {selectedTrip.to_city}
              </h3>
              <Badge className="bg-primary/10 text-primary text-xs">{activeBookings.length} راكب</Badge>
            </div>

            {tripBookings.length === 0 ? (
              <div className="bg-card rounded-2xl border border-border p-10 text-center">
                <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">لا يوجد ركاب محجوزون لهذه الرحلة</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tripBookings.map((booking) => {
                  const cfg = statusConfig[booking.status] || statusConfig.pending;
                  return (
                    <div key={booking.id} className="bg-card rounded-2xl border border-border p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-lg">
                            {(booking.passenger_name || "ر")[0]}
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">{booking.passenger_name || "راكب"}</h4>
                            <p className="text-xs text-muted-foreground">{booking.passenger_email || ""}</p>
                          </div>
                        </div>
                        <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                        <span>{booking.seats_booked || 1} مقعد</span>
                        <span className="font-bold text-primary">₪{booking.total_price || 0}</span>
                        <span>{booking.payment_method || "نقداً"}</span>
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        {/* Always-available chat button — driver can initiate conversation */}
                        {booking.passenger_email && booking.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg text-xs gap-1"
                            onClick={() => {
                              const params = new URLSearchParams({
                                to: booking.passenger_email,
                                name: booking.passenger_name || booking.passenger_email.split("@")[0],
                                trip: booking.trip_id || selectedTrip?.id || "",
                              });
                              navigate(`/messages?${params.toString()}`);
                            }}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            محادثة
                          </Button>
                        )}
                        {booking.status === "confirmed" && (
                          booking.payment_status === "paid" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg text-xs gap-1 text-green-600 border-green-500/30 bg-green-500/5"
                              disabled={markPaid.isPending}
                              onClick={() => markPaid.mutate({ id: booking.id, paid: false })}
                              title="تم استلام الدفع — اضغط للتراجع"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                              مدفوع
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="rounded-lg text-xs gap-1 bg-green-600 text-white hover:bg-green-700"
                              disabled={markPaid.isPending}
                              onClick={() => markPaid.mutate({ id: booking.id, paid: true })}
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                              تأكيد استلام الدفع
                            </Button>
                          )
                        )}
                        {booking.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              className="rounded-lg text-xs gap-1 bg-primary text-primary-foreground"
                              onClick={() => updateBooking.mutate({ id: booking.id, status: "confirmed" })}
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              قبول
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg text-xs gap-1 text-destructive border-destructive/20"
                              onClick={() => updateBooking.mutate({ id: booking.id, status: "cancelled" })}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              رفض
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="bg-card rounded-2xl border border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">اختر رحلة لعرض الركاب</p>
          </div>
        )}
      </div>
    </div>
  );
}