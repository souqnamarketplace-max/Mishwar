/**
 * BookingRequestPopup.jsx
 * Global floating card that appears for drivers when a new booking comes in.
 * Rendered inside MobileLayout so it's always visible app-wide.
 */
import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { logAudit } from "@/lib/adminAudit";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { User, MapPin, Users, CheckCircle, XCircle, ChevronRight, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function BookingRequestPopup({ user }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(new Set());
  const seenRef = useRef(new Set());

  const isDriver = user?.account_type === "driver" || user?.account_type === "both";

  // Fetch driver's trips
  const { data: myTrips = [] } = useQuery({
    queryKey: ["popup-trips", user?.email],
    queryFn: () => base44.entities.Trip.filter({ created_by: user.email }, "-created_date", 50),
    enabled: isDriver && !!user?.email,
    refetchInterval: false,
  });

  const tripIds = myTrips.map(t => t.id);

  // Fetch pending bookings on driver's trips
  const { data: allBookings = [] } = useQuery({
    queryKey: ["popup-bookings", user?.email],
    queryFn: () => base44.entities.Booking.filter({ status: "pending" }, "-created_date", 50),
    enabled: isDriver && tripIds.length > 0,
    refetchInterval: 15000, // poll every 15s as backup
  });

  // Filter to only this driver's trips
  const pendingBookings = allBookings.filter(b =>
    tripIds.includes(b.trip_id) && !dismissed.has(b.id)
  );

  // Subscribe to real-time booking updates
  useEffect(() => {
    if (!isDriver || !user?.email) return;
    const unsub = base44.entities.Booking.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["popup-bookings", user.email] });
    });
    return () => unsub();
  }, [isDriver, user?.email]);

  // Show toast when new booking arrives
  useEffect(() => {
    for (const b of pendingBookings) {
      if (!seenRef.current.has(b.id)) {
        seenRef.current.add(b.id);
        if (seenRef.current.size > 1) { // skip first load
          toast("🔔 طلب حجز جديد!", { description: `${b.passenger_name} يريد حجز مقعد في رحلتك` });
        }
      }
    }
  }, [pendingBookings.length]);

  const updateBooking = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Booking.update(id, { status }),
    onSuccess: async (_, { id, status }) => {
      qc.invalidateQueries({ queryKey: ["popup-bookings", user.email] });
      qc.invalidateQueries({ queryKey: ["driver-bookings", user.email] });
      setDismissed(prev => new Set([...prev, id]));

      const booking = allBookings.find(b => b.id === id);
      if (booking?.passenger_email) {
        try {
          if (status === "confirmed") {
            await base44.entities.Notification.create({
              user_email: booking.passenger_email,
              title: "تم قبول حجزك ✅",
              message: `تهانينا! تم قبول حجزك. المبلغ المستحق: ₪${booking.total_price}.`,
              type: "system", trip_id: booking.trip_id, is_read: false,
            });
            logAudit("driver_confirm_booking", "booking", id, { passenger_email: booking.passenger_email });
            toast.success("✅ تم قبول الحجز");
          } else {
            await base44.entities.Notification.create({
              user_email: booking.passenger_email,
              title: "تم رفض حجزك ❌",
              message: "نأسف، تم رفض طلب حجزك من قبل السائق.",
              type: "system", trip_id: booking.trip_id, is_read: false,
            });
            logAudit("driver_reject_booking", "booking", id, { passenger_email: booking.passenger_email });
            toast.error("❌ تم رفض الحجز");
          }
        } catch {}
      }
    },
    onError: () => toast.error("فشل التحديث، حاول مجدداً"),
  });

  if (!isDriver || pendingBookings.length === 0) return null;

  // Show the most recent pending booking
  const booking = pendingBookings[0];
  const trip = myTrips.find(t => t.id === booking.trip_id);

  return (
    <AnimatePresence>
      <motion.div
        key={booking.id}
        initial={{ y: -120, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -120, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="fixed top-16 left-3 right-3 z-50"
      >
        <div className="bg-card border-2 border-primary rounded-2xl shadow-2xl overflow-hidden">
          {/* Top bar */}
          <div className="bg-primary px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-primary-foreground text-xs font-bold">طلب حجز جديد 🔔</span>
              {pendingBookings.length > 1 && (
                <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-full">
                  +{pendingBookings.length - 1} أخرى
                </span>
              )}
            </div>
            <button
              onClick={() => setDismissed(prev => new Set([...prev, booking.id]))}
              className="text-white/70 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Passenger info */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0">
                {booking.passenger_name?.[0] || "؟"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-foreground">{booking.passenger_name || "راكب"}</p>
                <p className="text-xs text-muted-foreground truncate">{booking.passenger_email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-black text-primary">₪{booking.total_price}</p>
                <p className="text-[10px] text-muted-foreground">{booking.seats_booked} مقعد</p>
              </div>
            </div>

            {/* Trip info */}
            {trip && (
              <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2 mb-3">
                <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-xs font-medium">{trip.from_city}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-medium">{trip.to_city}</span>
                <span className="text-muted-foreground text-xs mr-auto">{trip.date} · {trip.time}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mb-2">
              <Button
                size="sm"
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 gap-1.5 font-bold"
                onClick={() => updateBooking.mutate({ id: booking.id, status: "confirmed" })}
                disabled={updateBooking.isPending}
              >
                <CheckCircle className="w-4 h-4" />
                قبول
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 border-destructive text-destructive hover:bg-destructive/10 rounded-xl h-10 gap-1.5 font-bold"
                onClick={() => updateBooking.mutate({ id: booking.id, status: "cancelled" })}
                disabled={updateBooking.isPending}
              >
                <XCircle className="w-4 h-4" />
                رفض
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-xl h-10 px-3 text-xs text-muted-foreground"
                onClick={() => {
                  setDismissed(prev => new Set([...prev, booking.id]));
                  navigate("/driver?tab=passengers");
                }}
              >
                <Users className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
