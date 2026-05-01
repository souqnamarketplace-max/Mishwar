import { toast } from "sonner";
import { logAudit } from "@/lib/adminAudit";
import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import {
  Car, MapPin, Clock, Star, Users, ArrowLeft, Download,
  Search, CheckCircle, AlertCircle, XCircle, Navigation
} from "lucide-react";
import ReviewForm from "../components/reviews/ReviewForm";

const tabs = [
  { id: "all", label: "الكل", icon: Car },
  { id: "confirmed", label: "القادمة", icon: Clock },
  { id: "in_progress", label: "يتم تنفيذها", icon: Navigation },
  { id: "completed", label: "المكتملة", icon: CheckCircle },
  { id: "cancelled", label: "الملغاة", icon: XCircle },
];

const statusConfig = {
  confirmed: { label: "مؤكدة", color: "bg-accent/10 text-accent border-accent/20" },
  in_progress: { label: "مباشر", color: "bg-primary/10 text-primary border-primary/20" },
  completed: { label: "مكتملة", color: "bg-muted text-muted-foreground border-border" },
  cancelled: { label: "ملغاة", color: "bg-destructive/10 text-destructive border-destructive/20" },
};

export default function MyTrips() {
  useSEO({ title: "رحلاتي", description: "شاهد رحلاتك السابقة والقادمة" });

  const [confirmCancel, setConfirmCancel] = useState({ open: false, bookingId: null });
  const [activeTab, setActiveTab] = useState("all");
  const [reviewingTrip, setReviewingTrip] = useState(null);
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
    mutationFn: async (bookingId) => {
      const { error } = await supabase.rpc("cancel_booking", { booking_id_param: bookingId });
      if (error) throw error;
      return { success: true };
    },
    onSuccess: async (_, bookingId) => {
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      qc.invalidateQueries({ queryKey: ["all-trips-lookup"] });
      logAudit("booking_cancelled_by_passenger", "booking", bookingId, { passenger_email: user?.email });
      toast.success("تم إلغاء الحجز بنجاح");
      // Notify driver that the booking was cancelled
      try {
        const booking = passengerBookings?.find(b => b.id === bookingId);
        const trip = allTrips?.find(t => t.id === booking?.trip_id);
        if (trip?.driver_email && user?.email) {
          await base44.entities.Notification.create({
            user_email: trip.driver_email,
            title: "تم إلغاء حجز على رحلتك",
            message: `${user.full_name || user.email} ألغى حجزه في رحلتك من ${trip.from_city} إلى ${trip.to_city}`,
            type: "booking_cancelled",
            trip_id: trip.id,
            link: "/my-trips?tab=driver",
            is_read: false,
          });
        }
      } catch (e) { console.warn("[Notif] booking_cancelled:", e?.message); }
    },
    onError: (err) => toast.error(err.message || "فشل إلغاء الحجز"),
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

  // Merge: driver trips + trips the user booked as passenger (deduplicated)
  const bookedTripIds = new Set(passengerBookings.map(b => b.trip_id));
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

  const filtered = activeTab === "all" ? trips : trips.filter((t) => t.status === activeTab);
  const { data: myReviews = [] } = useQuery({
    queryKey: ["my-reviews", user?.email],
    queryFn: () => base44.entities.Review.filter({ reviewer_email: user?.email, review_type: "passenger_rates_driver" }),
    enabled: !!user?.email,
  });
  const reviewedTripIds = new Set(myReviews.map((r) => r.trip_id));

  const grouped = {
    confirmed: filtered.filter((t) => t.status === "confirmed"),
    in_progress: filtered.filter((t) => t.status === "in_progress"),
    completed: filtered.filter((t) => t.status === "completed"),
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
        <div className="text-center py-20">
          <Car className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات</h3>
          <p className="text-muted-foreground text-sm mb-4">ابدأ بحجز رحلة أو أنشئ رحلة جديدة</p>
          <div className="flex justify-center gap-3">
            <Link to="/search"><Button className="rounded-xl">ابحث عن رحلة</Button></Link>
            <Link to="/create-trip"><Button variant="outline" className="rounded-xl">أنشر رحلة</Button></Link>
          </div>
        </div>
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

                      {/* Cancel booking button for pending/confirmed trips booked as passenger */}
                      {(status === "confirmed" || status === "pending") && bookedTripIds.has(trip.id) && (
                        <div className="mt-2 px-1">
                          <button
                            onClick={() => {
                              const booking = passengerBookings.find(b => b.trip_id === trip.id);
                              if (booking) {
                                setConfirmCancel({ open: true, bookingId: booking.id });
                              }
                            }}
                            disabled={cancelBookingMutation.isPending}
                            className="text-sm text-destructive hover:underline flex items-center gap-1"
                          >
                            ✕ إلغاء الحجز
                          </button>
                        </div>
                      )}

                      {/* Review Button for completed trips */}
                      {status === "completed" && !reviewedTripIds.has(trip.id) && (
                        <div className="mt-3 mx-4">
                          {reviewingTrip === trip.id ? (
                            <ReviewForm
                              trip={trip}
                              reviewerUser={user}
                              targetEmail={trip.driver_email || trip.created_by}
                              targetName={trip.driver_name || "السائق"}
                              onClose={() => setReviewingTrip(null)}
                            />
                          ) : (
                            <button
                              onClick={() => setReviewingTrip(trip.id)}
                              className="w-full flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 hover:bg-yellow-100 transition-colors"
                            >
                              <div className="flex gap-0.5">
                                {[1,2,3,4,5].map(s => <Star key={s} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />)}
                              </div>
                              <span className="text-sm font-bold text-yellow-800">قيّم السائق {trip.driver_name || ""}</span>
                              <span className="text-xs text-yellow-600 mr-auto">اضغط هنا ←</span>
                            </button>
                          )}
                        </div>
                      )}
                      {status === "completed" && reviewedTripIds.has(trip.id) && (
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
    {confirmCancel.open && (
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmCancel({ open: false, bookingId: null })}>
        <div onClick={e => e.stopPropagation()} className="bg-card rounded-2xl p-6 max-w-sm w-full shadow-2xl" dir="rtl">
          <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">إلغاء الحجز؟</h3>
          <p className="text-sm text-muted-foreground mb-6">هل أنت متأكد من إلغاء هذا الحجز؟ لا يمكن التراجع عن هذا الإجراء.</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmCancel({ open: false, bookingId: null })} className="flex-1 px-4 py-2.5 bg-muted text-foreground rounded-xl font-medium text-sm">
              تراجع
            </button>
            <button onClick={() => { cancelBookingMutation.mutate(confirmCancel.bookingId); setConfirmCancel({ open: false, bookingId: null }); }} className="flex-1 px-4 py-2.5 bg-destructive text-destructive-foreground rounded-xl font-bold text-sm" disabled={cancelBookingMutation.isPending}>
              نعم، ألغِ الحجز
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}