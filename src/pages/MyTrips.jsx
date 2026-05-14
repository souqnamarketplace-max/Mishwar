import { toast } from "sonner";
import { logAudit } from "@/lib/adminAudit";
import { useSEO } from "@/hooks/useSEO";
import { friendlyError } from "@/lib/errors";
import React, { useState, useEffect, useRef } from "react";
import ModalPortal from "@/components/shared/ModalPortal";
import { base44 } from "@/api/base44Client";
import { isTripExpired, isTripCompleted } from "@/lib/tripScheduling";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { notifyUser } from "@/lib/notifyUser";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Car, MapPin, Clock, Star, Users, ArrowLeft, Download,
  Search, CheckCircle, AlertCircle, XCircle, Navigation
} from "lucide-react";
import PassengerReviewWizard from "../components/reviews/PassengerReviewWizard";
import { MessageCircle } from "lucide-react";

const tabs = [
  { id: "all", label: "الكل", icon: Car },
  { id: "confirmed", label: "القادمة", icon: Clock },
  { id: "in_progress", label: "يتم تنفيذها", icon: Navigation },
  { id: "completed", label: "المكتملة", icon: CheckCircle },
  { id: "cancelled", label: "الملغاة", icon: XCircle },
];

const statusConfig = {
  pending:   { label: "بانتظار موافقة السائق", color: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" },
  cancelled: { label: "ملغية",                  color: "bg-red-100 text-red-700 hover:bg-red-100" },
  confirmed: { label: "مؤكدة", color: "bg-accent/10 text-accent border-accent/20" },
  in_progress: { label: "مباشر", color: "bg-primary/10 text-primary border-primary/20" },
  completed: { label: "مكتملة", color: "bg-muted text-muted-foreground border-border" },
  cancelled: { label: "ملغاة", color: "bg-destructive/10 text-destructive border-destructive/20" },
};

export default function MyTrips() {
  useSEO({ title: "رحلاتي", description: "شاهد رحلاتك السابقة والقادمة" });

  const [confirmCancel, setConfirmCancel] = useState({ open: false, bookingId: null, reason: "" });
  const [activeTab, setActiveTab] = useState("all");
  const [wizardTrip, setWizardTrip] = useState(null); // trip object for PassengerReviewWizard
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const highlightTripId = searchParams.get("trip");
  const highlightRef = useRef(null);

  // Auto-scroll to highlighted trip after data loads
  useEffect(() => {
    if (highlightTripId && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 600);
    }
  }, [highlightTripId]);

  // Cancel booking mutation (for passenger bookings)
  const cancelBookingMutation = useMutation({
    mutationFn: async (input) => {
      // Accept either the legacy bookingId-only signature or { bookingId, reason }
      // so the UI can pass an optional human-readable cancellation reason that
      // gets persisted alongside the status flip. Old callers that pass just an
      // id keep working — reason just stays null in that case.
      const bookingId = typeof input === "string" ? input : input?.bookingId;
      const reason = typeof input === "string" ? null : (input?.reason || null);
      // Route through the cancel_booking RPC (migration 018) so seat
      // refund, authorization, and late-cancellation strikes happen
      // atomically server-side. The previous implementation did a
      // direct supabase.from("bookings").update({status:'cancelled'})
      // and the comment claimed "Seat restoration is handled by the
      // bookings_restore_seats DB trigger" — but NO such trigger has
      // ever shipped (verified: zero hits in migrations/ and the
      // public schema file). So this surface was the third site
      // leaking seats: passengers cancelling from /my-trips left
      // their trip's available_seats stuck at the lower count, and
      // the strike system never ran for late cancellations from
      // here either. Now matches the pattern used in
      // base44Client.cancelBooking and DriverPassengers.
      const { error: rpcErr } = await supabase.rpc("cancel_booking", {
        booking_id_param: bookingId,
        reason_param: reason || "passenger_self_cancel",
      });
      if (rpcErr) throw rpcErr;
      return { success: true };
    },
    onSuccess: async (_, input) => {
      const bookingId = typeof input === "string" ? input : input?.bookingId;
      // Caches that the cancel must invalidate, by where the user is
      // likely to go next after seeing "تم إلغاء الحجز بنجاح":
      //
      //   ["my-passenger-bookings"] — this page's own list, so the row
      //     drops into the "Cancelled" tab immediately.
      //   ["my-booking"] — TripDetails reads this PER (trip, email)
      //     pair to decide between "Book this trip" and the
      //     "waiting for driver approval" pill. Invalidated by
      //     prefix so every variant (any trip id) refetches; the
      //     user may navigate to a different trip than the one
      //     they just left. WITHOUT this, react-query's default
      //     staleTime kept the cancelled booking visible as
      //     "pending approval" for ~1 minute, blocking re-booking —
      //     exactly the bug souqnamarketplace@gmail.com hit when
      //     trying to re-book Ramallah → Nablus right after
      //     cancelling.
      //   ["trip", *] and ["trips"] / ["all-trips-lookup"] — the
      //     server-side cancel_booking RPC refunds the seat
      //     atomically, so available_seats changed; the trip detail
      //     and any trip-list view (search, my-trips driver tab)
      //     would otherwise show the old (lower) seat count until
      //     their own staleTime expired.
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      qc.invalidateQueries({ queryKey: ["my-booking"] });
      qc.invalidateQueries({ queryKey: ["trip"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["all-trips-lookup"] });
      logAudit("booking_cancelled_by_passenger", "booking", bookingId, { passenger_email: user?.email });
      toast.success("تم إلغاء الحجز بنجاح");
      // Notify driver that the booking was cancelled. Routes through
      // notifyUser → create_notification RPC (migration 027) so the
      // cross-user insert clears the migration 002 RLS check via Rule D
      // (caller and target share a booking on a trip). Previously this
      // hit notifications_insert directly and the RLS rejection was
      // silently swallowed by the catch block — drivers never actually
      // got the bell ping when a passenger self-cancelled.
      try {
        const booking = passengerBookings?.find(b => b.id === bookingId);
        const trip = allTrips?.find(t => t.id === booking?.trip_id);
        if (trip?.driver_email && user?.email) {
          await notifyUser({
            user_email: trip.driver_email,
            title: "تم إلغاء حجز على رحلتك",
            message: `${user.full_name || user.email} ألغى حجزه في رحلتك من ${trip.from_city} إلى ${trip.to_city}`,
            type: "system",
            trip_id: trip.id,
            link: "/my-trips?tab=driver",
          });
        }
      } catch (e) { console.warn("[Notif] booking_cancelled:", e?.message); }
    },
    onError: (err) => toast.error(friendlyError(err, "فشل إلغاء الحجز")),
  });

  const { user } = useAuth();

  // Role detection — passengers don't have driver trips, drivers may not have bookings
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";

  // Role detection done above — driverTrips ONLY queried for drivers
  const { data: driverTrips = [], isLoading: driverTripsLoading } = useQuery({
    queryKey: ["my-driver-trips", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Trip.filter({ driver_email: user.email }, "-created_date", 50)
      : [],
    enabled: !!user?.email && isDriver,  // Don't run for passengers — saves a hung query
  });

  // For passengers, isLoading is governed by passenger booking + allTrips queries
  const isLoading = isDriver ? driverTripsLoading : false;

  // Bookings this user made AS PASSENGER
  const { data: passengerBookings = [] } = useQuery({
    queryKey: ["my-passenger-bookings", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Booking.filter({ passenger_email: user.email }, "-created_date", 50)
      : [],
    enabled: !!user?.email,
  });

  // All trips (to look up booked trips)
  const { data: allTrips = [] } = useQuery({
    queryKey: ["all-trips-lookup"],
    queryFn: () => base44.entities.Trip.list("-created_date", 200),
  });

  // Filter out cancelled bookings entirely — once a passenger cancels, the trip
  // should disappear from "رحلاتي" immediately. If they re-book, a new (active)
  // booking row exists and the trip reappears.
  const activePassengerBookings = (passengerBookings || []).filter(b => b.status !== "cancelled");
  // Merge: driver trips + trips the user has an ACTIVE booking on (deduplicated)
  const bookedTripIds = new Set(activePassengerBookings.map(b => b.trip_id));
  // Map of trip_id → passenger's booking status. Use the NEWEST active booking per trip
  // so re-bookings after cancellation correctly show the new pending/confirmed status.
  const bookingStatusByTripId = new Map();
  for (const b of activePassengerBookings) {
    // passengerBookings is already sorted -created_date, so first hit per trip is newest
    if (!bookingStatusByTripId.has(b.trip_id)) {
      bookingStatusByTripId.set(b.trip_id, b.status);
    }
  }
  const bookedTrips = allTrips.filter(t => bookedTripIds.has(t.id));
  const trips = [...driverTrips, ...bookedTrips.filter(t => !driverTrips.find(dt => dt.id === t.id))];

  // Real-time subscription for trip & review updates
  useEffect(() => {
    const unsubTrips = base44.entities.Trip.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    });
    const unsubReviews = base44.entities.Review.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["my-reviews"] });
    });
    // KEY FIX: when driver confirms/cancels a booking, passenger sees it instantly
    const unsubBookings = base44.entities.Booking.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      qc.invalidateQueries({ queryKey: ["all-trips-lookup"] });
      qc.invalidateQueries({ queryKey: ["my-driver-trips"] });
    });
    return () => { unsubTrips(); unsubReviews(); unsubBookings(); };
  }, [qc]);

  // For passenger trips, the BOOKING status takes precedence over trip status.
  // For driver trips (no booking on user's behalf), fall back to the trip status.
  const effectiveStatus = (t) => bookingStatusByTripId.get(t.id) || t.status;
  const filtered = activeTab === "all" ? trips : trips.filter((t) => effectiveStatus(t) === activeTab);
  const { data: myReviews = [] } = useQuery({
    queryKey: ["my-reviews", user?.email],
    queryFn: () => base44.entities.Review.filter({ reviewer_email: user?.email, review_type: "passenger_rates_driver" }),
    enabled: !!user?.email,
  });
  const reviewedTripIds = new Set(myReviews.map((r) => r.trip_id));

  const grouped = {
    pending: filtered.filter((t) => effectiveStatus(t) === "pending"),
    confirmed: filtered.filter((t) => effectiveStatus(t) === "confirmed"),
    in_progress: filtered.filter((t) => effectiveStatus(t) === "in_progress"),
    completed: filtered.filter((t) => effectiveStatus(t) === "completed"),
    cancelled: filtered.filter((t) => effectiveStatus(t) === "cancelled"),
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Car className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">رحلاتي</h1>
        <p className="text-muted-foreground text-sm mt-1">جميع رحلاتك الحالية والسابقة في مكان واحد</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-card border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-2xl border p-6 animate-pulse">
              <div className="h-5 bg-muted rounded w-48 mb-3" />
              <div className="h-4 bg-muted rounded w-32" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        // Distinguish "you have NO trips at all" from "you have trips but
        // none match the current tab filter". The previous copy
        // ("لا توجد رحلات / ابدأ بنشر رحلة") was misleading for the
        // second case — drivers with active confirmed trips would see
        // a "no trips, start posting!" state when they tapped "completed"
        // before they had any completed ones. Same UX pattern shipped
        // for /passenger-requests in commit 780db6d.
        trips.length > 0 ? (
          <div className="text-center py-16">
            <Car className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="font-bold text-foreground mb-1">لا توجد رحلات في هذا التبويب</h3>
            <p className="text-xs text-muted-foreground">
              لديك رحلات في تبويبات أخرى — جرّب &ldquo;الكل&rdquo; لرؤيتها جميعاً.
            </p>
          </div>
        ) : (
        <div className="text-center py-20">
          <Car className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {isDriver
              ? "ابدأ بنشر رحلة أو ابحث عن رحلة كراكب"
              : "ابحث عن رحلة، أو اطلب من السائقين أن يأخذوك إلى وجهتك"}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/search"><Button className="rounded-xl">ابحث عن رحلة</Button></Link>
            {isDriver ? (
              <Link to="/create-trip"><Button variant="outline" className="rounded-xl">أنشر رحلة</Button></Link>
            ) : (
              <Link to="/request-trip"><Button variant="outline" className="rounded-xl">اطلب رحلة</Button></Link>
            )}
          </div>
          {/* Always surface "طلباتي" so users can find existing requests
              even if they have no trips. */}
          <Link to="/my-requests" className="inline-block text-xs text-muted-foreground hover:text-primary mt-4 underline">
            عرض طلبات الرحلات الخاصة بي ←
          </Link>
        </div>
        )
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([status, statusTrips]) => {
            if (statusTrips.length === 0) return null;
            const config = statusConfig[status];
            return (
              <div key={status}>
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  {config?.label || status}
                  <span className="text-sm font-normal text-muted-foreground">({statusTrips.length})</span>
                </h3>
                <div className="space-y-3">
                  {statusTrips.map((trip) => (
                    <div
                      key={trip.id}
                      ref={trip.id === highlightTripId ? highlightRef : null}
                      className={`rounded-2xl transition-all duration-700 ${
                        trip.id === highlightTripId
                          ? "ring-2 ring-primary ring-offset-2 shadow-lg shadow-primary/20"
                          : ""
                      }`}
                    >
                      <Link to={`/trip/${trip.id}`}>
                        <div className="bg-card rounded-2xl border border-border p-4 hover:shadow-md transition-all">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            <div className="text-center bg-muted/50 rounded-xl px-4 py-3 shrink-0">
                              <p className="text-xs text-muted-foreground">{trip.date?.split(" ")[0] || "السبت"}</p>
                              <p className="text-2xl font-bold text-foreground">{trip.date?.split(" ")[1] || "25"}</p>
                              <p className="text-xs text-muted-foreground">{trip.time || "08:30"}</p>
                            </div>
                            {/* Car thumbnail — only renders when the trip has a
                                car_image. Reinforces visual identity of the
                                vehicle and matches what TripCard / TripDetails
                                already show, so users see consistent imagery. */}
                            {trip.car_image && (
                              <div className="w-20 h-14 rounded-xl overflow-hidden bg-muted shrink-0 ring-1 ring-border/40">
                                <img
                                  loading="lazy"
                                  decoding="async"
                                  src={trip.car_image}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 font-bold text-foreground mb-1 flex-wrap">
                                <MapPin className="w-4 h-4 text-primary" />
                                <span>{trip.from_city}</span>
                                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                                <span>{trip.to_city}</span>
                                {driverTrips.find(dt => dt.id === trip.id) ? (
                                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">🚗 أنت السائق</span>
                                ) : (
                                  <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">🎫 أنت راكب</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Users className="w-3.5 h-3.5" />
                                  {trip.available_seats} مقاعد
                                </span>
                                <span className="flex items-center gap-1">
                                  <Star className="w-3.5 h-3.5 text-yellow-500" />
                                  {trip.driver_rating || "4.5"}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge className={config?.color}>{config?.label}</Badge>
                              <span className="text-xl font-bold text-primary">₪{trip.price}</span>
                            </div>
                          </div>
                        </div>
                      </Link>

                      
                      {status === "confirmed" && trip.driver_phone && (
                        <div className="mt-2 px-1">
                          
                        </div>
                      )}

                      {/* Cancel + Message driver buttons for confirmed/in_progress passenger trips */}
                      {(status === "confirmed" || status === "in_progress" || status === "pending") && bookedTripIds.has(trip.id) && (
                        <div className="mt-2 px-1 flex items-center justify-between gap-3">
                          {/* Message driver */}
                          <Link
                            to={`/messages?to=${encodeURIComponent(trip.driver_email || trip.created_by)}&name=${encodeURIComponent(trip.driver_name || "السائق")}`}
                            className="flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
                            onClick={e => e.stopPropagation()}
                          >
                            <MessageCircle className="w-4 h-4" />
                            راسل السائق
                          </Link>

                          {/* Cancel booking */}
                          {(status === "confirmed" || status === "pending") && (
                            <button
                              onClick={() => {
                                const booking = passengerBookings.find(b => b.trip_id === trip.id);
                                if (booking) setConfirmCancel({
                                  open: true,
                                  bookingId: booking.id,
                                  tripDateTime: trip.date && trip.time
                                    ? `${trip.date}T${trip.time}:00`
                                    : (trip.date ? `${trip.date}T00:00:00` : null),
                                });
                              }}
                              disabled={cancelBookingMutation.isPending}
                              className="text-sm text-destructive hover:underline flex items-center gap-1"
                            >
                              ✕ إلغاء الحجز
                            </button>
                          )}
                        </div>
                      )}

                      {/* Review button — appears as soon as the trip's
                          actual time window has elapsed (start + 30 min),
                          for any booking the user actually made on that
                          trip and hasn't already reviewed. Earlier we
                          required `status === "completed"`, but that
                          status only flips when the driver explicitly
                          taps "complete" in their dashboard — so most
                          real trips never became reviewable. Cancelled
                          bookings are explicitly excluded. */}
                      {bookedTripIds.has(trip.id)
                        && !reviewedTripIds.has(trip.id)
                        && isTripCompleted(trip)
                        && status !== "cancelled"
                        && status !== "cancelled_by_driver" && (
                        <div className="mt-3 mx-4">
                          <button
                            onClick={() => setWizardTrip(trip)}
                            className="w-full flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 hover:bg-yellow-100 transition-colors active:scale-[0.99]"
                          >
                            <div className="flex gap-0.5">
                              {[1,2,3,4,5].map(s => <Star key={s} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />)}
                            </div>
                            <span className="text-sm font-bold text-yellow-800">قيّم السائق {trip.driver_name || ""}</span>
                            <span className="text-xs text-yellow-600 mr-auto">اضغط هنا ←</span>
                          </button>
                        </div>
                      )}
                      {bookedTripIds.has(trip.id) && reviewedTripIds.has(trip.id) && isTripCompleted(trip) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 px-5 mt-2 pb-1">
                          <CheckCircle className="w-3 h-3 text-accent" />
                          شكراً — تم تقييم هذه الرحلة ✅
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    {/* Passenger review wizard portal */}
    {wizardTrip && (
      <PassengerReviewWizard
        trip={wizardTrip}
        driverEmail={wizardTrip.driver_email || wizardTrip.created_by}
        driverName={wizardTrip.driver_name || "السائق"}
        passengerUser={user}
        onClose={() => setWizardTrip(null)}
      />
    )}

    {confirmCancel.open && (
      <ModalPortal>
      {/* Portal to document.body — without this, the fixed-position
          overlay would inherit its containing block from the closest
          ancestor with a CSS transform set. On mobile, AppLayout wraps
          every page in <PageTransition> (framer-motion's motion.div
          applies transforms during route transitions), which hijacks
          `position: fixed` and anchors it to the page instead of the
          viewport. Result: on scrolled pages the modal renders below
          the fold. ModalPortal escapes the transformed parent by
          mounting the overlay directly under <body>. */}
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmCancel({ open: false, bookingId: null, reason: "" })}>
        <div onClick={e => e.stopPropagation()} className="bg-card rounded-2xl p-6 max-w-sm w-full shadow-2xl" dir="rtl">
          <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">إلغاء الحجز؟</h3>
          <p className="text-sm text-muted-foreground mb-3">هل أنت متأكد من إلغاء هذا الحجز؟ لا يمكن التراجع عن هذا الإجراء.</p>

          {/* Late-cancellation warning — shown when the trip is < 2h
              away. The DB will count this as a "strike" via migration
              018; we surface that to the user upfront so they can make
              an informed choice. 3 strikes in 30 days blocks new
              bookings until the rolling window passes. */}
          {(() => {
            if (!confirmCancel.tripDateTime) return null;
            const hoursUntil = (new Date(confirmCancel.tripDateTime).getTime() - Date.now()) / 3600000;
            if (hoursUntil <= 0 || hoursUntil >= 2) return null;
            return (
              <div className="mb-3 rounded-xl bg-destructive/5 border border-destructive/30 p-3">
                <p className="text-xs font-bold text-destructive mb-1 flex items-center gap-1.5">
                  ⚠️ تحذير: إلغاء متأخر
                </p>
                <p className="text-[11px] text-destructive/90 leading-relaxed">
                  هذا الإلغاء قبل أقل من ساعتين من موعد الرحلة وسيُسجَّل كنقطة سلبية في حسابك. تراكم 3 نقاط خلال 30 يوماً يؤدي إلى تعليق إمكانية الحجز مؤقتاً.
                </p>
              </div>
            );
          })()}

          {/* Optional reason — collected so admins can analyse cancel
              patterns later. Six common buckets cover most cases; an
              "other" option falls through to free text. */}
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">سبب الإلغاء (اختياري)</label>
          <select
            value={confirmCancel.reason}
            onChange={(e) => setConfirmCancel(c => ({ ...c, reason: e.target.value }))}
            className="w-full mb-4 px-3 py-2.5 rounded-xl bg-muted/50 border border-border text-sm outline-none"
          >
            <option value="">— اختر سبباً —</option>
            <option value="changed_plans">تغيرت خططي</option>
            <option value="found_alternative">وجدت وسيلة نقل أخرى</option>
            <option value="trip_time_no_longer_works">وقت الرحلة لم يعد مناسباً</option>
            <option value="driver_unresponsive">السائق لم يرد</option>
            <option value="price_too_high">السعر مرتفع</option>
            <option value="emergency">حالة طارئة</option>
            <option value="other">سبب آخر</option>
          </select>

          <div className="flex gap-3">
            <button onClick={() => setConfirmCancel({ open: false, bookingId: null, reason: "" })} className="flex-1 px-4 py-2.5 bg-muted text-foreground rounded-xl font-medium text-sm">
              تراجع
            </button>
            <button
              onClick={() => {
                cancelBookingMutation.mutate({ bookingId: confirmCancel.bookingId, reason: confirmCancel.reason || null });
                setConfirmCancel({ open: false, bookingId: null, reason: "" });
              }}
              className="flex-1 px-4 py-2.5 bg-destructive text-destructive-foreground rounded-xl font-bold text-sm"
              disabled={cancelBookingMutation.isPending}
            >
              نعم، ألغِ الحجز
            </button>
          </div>
        </div>
      </div>
      </ModalPortal>
    )}
    </div>
  );
}