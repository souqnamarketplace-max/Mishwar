import React from "react";
import { logAudit } from "@/lib/adminAudit";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { notifyUser } from "@/lib/notifyUser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, MapPin, ArrowLeft, CheckCircle, XCircle, MessageCircle, CheckCheck, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { DollarSign } from "lucide-react";
import { useConfirm } from "@/hooks/useConfirm";

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
      await api.entities.Booking.update(id, { status });
    },
    onMutate: async ({ id, status }) => {
      // Optimistic on BOTH the global bookings key AND the per-driver
      // bookings key — same pattern as the DriverTripsList fix in
      // component batch 1. Driver dashboard reads ['driver-bookings',
      // email, tripIds]; previously only ['bookings'] got the
      // optimistic update so the driver saw a ~200ms freeze on every
      // accept/reject tap.
      await Promise.all([
        qc.cancelQueries({ queryKey: ["bookings"] }),
        qc.cancelQueries({ queryKey: ["driver-bookings"] }),
      ]);
      const prevBookings       = qc.getQueryData(["bookings"]);
      const prevDriverBookings = qc.getQueryData(["driver-bookings"]);
      // Capture the booking's pre-mutation status so onSuccess can
      // pick the right notification template and audit action. The
      // optimistic setQueryData below stamps the NEW status onto
      // every cache slice, so by the time onSuccess runs we can't
      // recover the previous state from the cache alone. Check both
      // ["bookings"] (admin-style) and ["driver-bookings"] (driver
      // dashboard) — whichever one was loaded first wins, and it
      // doesn't matter which because they're snapshots of the same
      // row.
      const previousStatus =
        prevBookings?.find(b => b.id === id)?.status ||
        prevDriverBookings?.find(b => b.id === id)?.status ||
        null;
      const apply = (old) => old?.map(b => b.id === id ? { ...b, status } : b) || [];
      qc.setQueryData(["bookings"], apply);
      qc.setQueryData(["driver-bookings"], apply);
      return { prevBookings, prevDriverBookings, previousStatus };
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData(["bookings"], ctx?.prevBookings);
      qc.setQueryData(["driver-bookings"], ctx?.prevDriverBookings);
      toast.error(friendlyError(err, "فشل تحديث الحجز"));
    },
    onSuccess: async (_, { id, status }, ctx) => {
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
              // Tap on the bell badge → user lands on their upcoming
              // confirmed trips (the 'my booked trips' tab).
              link: "/my-trips?tab=confirmed",
            });
            logAudit("driver_confirm_booking", "booking", id, { passenger_email: booking.passenger_email });
            toast.success("تم قبول الحجز وإخطار الراكب ✅");
          } else if (status === "cancelled") {
            // Branch on the booking's pre-cancel status. Today the UI
            // gates the رفض button to booking.status === "pending"
            // (line ~270 of this file), so the confirmed branch below
            // doesn't fire in practice — but a future change that
            // exposes a "remove confirmed passenger" surface would
            // otherwise silently send "your booking was rejected" to
            // a passenger whose booking was previously accepted, and
            // file the action under driver_reject_booking. Defending
            // against that here costs ~10 lines and makes the audit
            // log materially more useful: admins can now tell apart
            // a driver who rejects requests pre-confirm from one who
            // bails on confirmed passengers (very different patterns
            // for strike review).
            const wasConfirmed = ctx?.previousStatus === "confirmed";
            if (wasConfirmed) {
              await notifyUser({
                user_email: booking.passenger_email,
                title: "السائق ألغى حجزك",
                message: "نأسف، قام السائق بإلغاء حجزك المؤكد. ابحث عن رحلة بديلة على نفس المسار.",
                type: "system",
                trip_id: booking.trip_id,
                // Cancelled-by-driver lands them in the cancelled tab
                // where the reason 'driver_cancel' renders 'ألغاه السائق'.
                link: "/my-trips?tab=cancelled",
              });
              logAudit("driver_cancel_confirmed_booking", "booking", id, {
                passenger_email: booking.passenger_email,
                previous_status: "confirmed",
              });
              toast.info("تم إلغاء الحجز وإخطار الراكب");
            } else {
              await notifyUser({
                user_email: booking.passenger_email,
                title: "تم رفض حجزك ❌",
                message: "عذراً، قام السائق برفض حجزك. يمكنك البحث عن رحلة أخرى.",
                type: "system",
                trip_id: booking.trip_id,
                // Rejection — passenger goes to cancelled tab, sees the
                // 'رفض السائق طلبك' reason rendered by MyTrips.
                link: "/my-trips?tab=cancelled",
              });
              logAudit("driver_reject_booking", "booking", id, {
                passenger_email: booking.passenger_email,
                previous_status: ctx?.previousStatus || "pending",
              });
              toast.info("تم رفض الحجز وإخطار الراكب");
            }
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

  // ─── Bulk approve — confirm all pending bookings for current trip ────
  //
  // Scale-audit P1 #5: a driver who gets 5-10 booking requests in an
  // hour shouldn't have to tap 'قبول' on each one individually. This
  // mutation walks the pending bookings sequentially (NOT in parallel
  // — see below) and calls the same underlying Booking.update path
  // that the single-row 'قبول' button uses.
  //
  // WHY SEQUENTIAL not Promise.all:
  //   - Each confirm fires a notifyUser() push to the passenger. Bursting
  //     5 pushes in <100ms can trigger FCM/APNS rate limiting and silently
  //     drop some of them.
  //   - Audit log entries land with predictable timestamps in the order
  //     the admin saw them in the UI, instead of a confusing interleave.
  //   - If one approval fails (e.g. trip ran out of seats during the
  //     bulk operation), the others still go through, and we can show
  //     a precise 'X confirmed, 1 failed' message.
  //
  // WHY direct Booking.update not bulk SQL:
  //   - Booking.update goes through PostgREST which applies the
  //     same RLS as the single-row path. Bypassing it via a server-side
  //     RPC would need a new SECURITY DEFINER function with manual
  //     auth checks — more surface area, no real win at 5-10 rows.
  //   - 5-10 sequential HTTP round-trips on a wifi connection is ~500ms
  //     total — felt as a single 'loading' state to the driver.
  //
  // useConfirm gates the action because batch-confirming is harder to
  // undo than batch-cancelling (no atomic 'un-confirm all' button —
  // driver would have to cancel each individually).
  const bulkApprove = useMutation({
    mutationFn: async ({ bookings: pendingBookings }) => {
      let confirmed = 0;
      const failures = [];
      // Sequential walk — see WHY block above for rationale.
      for (const booking of pendingBookings) {
        try {
          await api.entities.Booking.update(booking.id, { status: "confirmed" });
          confirmed++;
          // Best-effort notification — failures here shouldn't block
          // the next booking. Wrapped separately so a notify error
          // doesn't roll back the booking confirm.
          if (booking.passenger_email) {
            try {
              await notifyUser({
                user_email: booking.passenger_email,
                title: "تم قبول حجزك ✅",
                message: `تهانينا! تم قبول حجزك. المبلغ المستحق: ₪${booking.total_price}. تحقق من تفاصيل الدفع في صفحة تأكيد الحجز.`,
                type: "system",
                trip_id: booking.trip_id,
                link: "/my-trips?tab=confirmed",
              });
              logAudit("driver_confirm_booking", "booking", booking.id, {
                passenger_email: booking.passenger_email,
                bulk: true,  // flag for activity-log readers to know
                             // this confirm was part of a bulk operation
              });
            } catch (notifyErr) {
              // Non-fatal — log to console but keep going. The booking
              // IS confirmed; the passenger just didn't get pinged this
              // second (they'll see it on next /my-trips refresh).
              // eslint-disable-next-line no-console
              console.warn("Bulk confirm: notify failed for", booking.id, notifyErr);
            }
          }
        } catch (err) {
          failures.push({ id: booking.id, name: booking.passenger_name || "راكب", error: err });
        }
      }
      return { confirmed, failures, total: pendingBookings.length };
    },
    onSuccess: ({ confirmed, failures, total }) => {
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      if (failures.length === 0) {
        toast.success(`تم قبول ${confirmed} حجز بنجاح ✅`);
      } else if (confirmed === 0) {
        toast.error(`فشل قبول كل الحجوزات (${total})`);
      } else {
        // Partial-success path — surface both numbers so the driver
        // knows exactly what landed and what didn't. The failed
        // bookings stay in 'pending' status so the driver can retry
        // each one individually.
        toast.warning(`تم قبول ${confirmed} من ${total}. فشل ${failures.length} (يمكنك إعادة المحاولة فردياً)`);
      }
    },
    onError: (err) => {
      toast.error(friendlyError(err, "فشلت العملية الجماعية"));
    },
  });

  // useConfirm dialog for the bulk-approve confirmation prompt. Local
  // to this component since DriverPassengers doesn't share confirms
  // with siblings. The dialog renders at the JSX root so it overlays
  // the trip selector + passenger list regardless of which one had focus.
  const { confirm: confirmBulk, dialog: bulkConfirmDialog } = useConfirm();
  // Driver marks a booking paid after receiving money.
  // Uses admin_mark_booking_payment RPC (migration 111) which verifies the
  // caller is the trip's driver, writes driver_amount at the correct
  // commission rate, and records payment_confirmed_by = driver's email.
  const markPaid = useMutation({
    mutationFn: async ({ id, paid }) => {
      const { data, error } = await supabase.rpc("admin_mark_booking_payment", {
        p_booking_id: id,
        p_paid: paid,
        p_reference: null,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    // Optimistic — mark-paid fires once per passenger at trip end
    // (typically 2-4 quick taps in a row). Without optimistic each
    // tap would freeze the UI for ~200ms during invalidate→refetch.
    // Same dual-queryKey pattern as updateBooking above.
    onMutate: async ({ id, paid }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["bookings"] }),
        qc.cancelQueries({ queryKey: ["driver-bookings"] }),
      ]);
      const prevBookings       = qc.getQueryData(["bookings"]);
      const prevDriverBookings = qc.getQueryData(["driver-bookings"]);
      const apply = (old) => old?.map(b =>
        b.id === id
          ? { ...b, payment_status: paid ? "paid" : "pending", paid_at: paid ? new Date().toISOString() : null }
          : b
      ) || [];
      qc.setQueryData(["bookings"], apply);
      qc.setQueryData(["driver-bookings"], apply);
      return { prevBookings, prevDriverBookings };
    },
    onSuccess: (_, { paid }) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["driver-bookings"] });
      qc.invalidateQueries({ queryKey: ["payments-summary"] });
      toast.success(paid ? "تم تسجيل الدفع ✓" : "تم التراجع عن تسجيل الدفع");
    },
    onError: (err, vars, ctx) => {
      qc.setQueryData(["bookings"], ctx?.prevBookings);
      qc.setQueryData(["driver-bookings"], ctx?.prevDriverBookings);
      toast.error(friendlyError(err, "فشل تحديث الحجز — حاول مجدداً"));
    },
  });

  // Realtime: booking list updates when any booking changes
  React.useEffect(() => {
    const u = api.entities.Booking.subscribe(() => {
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

              {/* Arrival notification — driver taps when at pickup point */}
              {activeBookings.length > 0 && (
                <button
                  className="mr-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-300/40 text-green-700 text-xs font-bold hover:bg-green-500/20 active:scale-95 transition-all"
                  onClick={async () => {
                    const confirmed = activeBookings.filter(b => b.status === "confirmed");
                    if (confirmed.length === 0) return;
                    await Promise.allSettled(confirmed.map(b =>
                      notifyUser({
                        user_email:   b.passenger_email,
                        title:        "🚗 السائق وصل!",
                        message:      `سائقك وصل إلى ${selectedTrip.from_city}. اخرج الآن لتجد السيارة في الموعد!`,
                        type:         "system",
                        trip_id:      selectedTrip.id,
                        link:         `/trip/${selectedTrip.id}`,
                      })
                    ));
                    toast.success(`تم إشعار ${confirmed.length} راكب بوصولك ✅`);
                  }}
                >
                  📍 أنا وصلت — أشعر الركاب
                </button>
              )}
            </div>

            {/* Bulk-approve strip — appears only when 2+ pending bookings
                exist for the current trip. One pending booking doesn't
                merit a bulk affordance; the single-row 'قبول' is faster.
                Threshold is intentionally 2 (not 3+) because even 2
                bookings benefit from one-tap workflows on mobile where
                tapping individual buttons across separate cards is
                slower than the bulk action.

                The button is disabled while the mutation runs to
                prevent double-firing (which would attempt to confirm
                already-confirmed bookings and surface errors). */}
            {(() => {
              const pendingForTrip = tripBookings.filter(b => b.status === "pending");
              if (pendingForTrip.length < 2) return null;
              return (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCheck className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                    <span className="font-medium text-foreground">
                      لديك {pendingForTrip.length} حجوزات معلّقة
                    </span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      — اقبلها جميعاً بضغطة واحدة
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={async () => {
                      // Show passenger names in the confirm so the
                      // driver knows EXACTLY who they're approving.
                      // Most useful at 2-4 pending; with 10+ the list
                      // gets long but still scannable.
                      const names = pendingForTrip
                        .map(b => b.passenger_name || b.passenger_email || "راكب")
                        .join("، ");
                      const ok = await confirmBulk({
                        title: `قبول ${pendingForTrip.length} حجوزات`,
                        message: `سيتم قبول حجوزات: ${names}. سيصل الركاب إشعار بالقبول. لا يمكن التراجع تلقائياً — ستحتاج لإلغاء كل حجز فردياً للتراجع.`,
                        confirmLabel: `قبول الـ ${pendingForTrip.length}`,
                      });
                      if (ok) bulkApprove.mutate({ bookings: pendingForTrip });
                    }}
                    disabled={bulkApprove.isPending}
                    className="rounded-xl gap-1.5 bg-primary text-primary-foreground"
                  >
                    {bulkApprove.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {bulkApprove.isPending ? "جاري القبول..." : `قبول الجميع (${pendingForTrip.length})`}
                  </Button>
                </div>
              );
            })()}

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
      {/* useConfirm dialog for bulk-approve. Renders nothing until
          confirm() is awaited. Placed at the outer grid level so it
          overlays both the trip-selector column and the passenger
          column. */}
      {bulkConfirmDialog}
    </div>
  );
}