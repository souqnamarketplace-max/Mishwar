import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useGPSTripCompletion } from "@/lib/gpsTracking";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Navigation, MapPin, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import DriverReviewWizard from "@/components/reviews/DriverReviewWizard";

/**
 * GPSTripTracker — mounts when a trip is in_progress.
 * Shows a sticky GPS status card at the top of the driver's trip view.
 * Auto-completes trip via GPS or lets driver tap manual fallback.
 */
export default function GPSTripTracker({ trip, bookings, driverUser }) {
  const qc = useQueryClient();
  const [showReviewWizard, setShowReviewWizard] = useState(false);
  const [completing, setCompleting] = useState(false);

  const passengers = bookings.filter(
    b => b.trip_id === trip.id && b.status === "confirmed"
  );

  const completeTrip = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await base44.entities.Trip.update(trip.id, { status: "completed" });
      // Notify all passengers
      await Promise.all(passengers.map(b =>
        base44.entities.Notification.create({
          user_email: b.passenger_email,
          title: "اكتملت رحلتك! قيّم السائق ⭐",
          message: `وصلت رحلتك من ${trip.from_city} إلى ${trip.to_city}. شكراً لاستخدامك مِشوارو!`,
          type: "system", trip_id: trip.id, is_read: false,
        })
      ));
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("✅ اكتملت الرحلة! يمكنك الآن تقييم الركاب");
      setShowReviewWizard(true);
    } catch {
      toast.error("تعذر إنهاء الرحلة");
    } finally {
      setCompleting(false);
    }
  };

  const { status, distanceKm, minutesLeft, radius, requestLocation } =
    useGPSTripCompletion(trip, completeTrip, { bufferMinutes: 20 });

  const statusInfo = {
    idle: { color: "bg-blue-500/10 border-blue-200 text-blue-700", icon: <Navigation className="w-4 h-4" />, label: "تفعيل تتبع الموقع" },
    granted: { color: "bg-green-500/10 border-green-200 text-green-700", icon: <Navigation className="w-4 h-4 animate-pulse" />, label: "جاري تتبع موقعك..." },
    denied: { color: "bg-red-500/10 border-red-200 text-red-700", icon: <AlertTriangle className="w-4 h-4" />, label: "تعذر الوصول للموقع" },
    near: { color: "bg-yellow-500/10 border-yellow-200 text-yellow-700", icon: <MapPin className="w-4 h-4" />, label: `اقتربت من ${trip.to_city}` },
    countdown: { color: "bg-primary/10 border-primary/20 text-primary", icon: <Clock className="w-4 h-4" />, label: `إنهاء الرحلة خلال ${minutesLeft} دقيقة` },
    done: { color: "bg-green-500/10 border-green-200 text-green-700", icon: <MapPin className="w-4 h-4" />, label: "وصلت! جاري إنهاء الرحلة..." },
  };

  const info = statusInfo[status];

  return (
    <>
      {/* GPS Status Banner */}
      <div className={`rounded-2xl border p-4 mb-3 ${info.color}`} dir="rtl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            {info.icon}
            <div>
              <p className="text-sm font-medium">{info.label}</p>
              {status === "granted" && distanceKm !== null && (
                <p className="text-xs opacity-70">
                  {distanceKm.toFixed(1)} كم من {trip.to_city} (التلقائي عند {radius} كم)
                </p>
              )}
              {status === "countdown" && (
                <p className="text-xs opacity-70">
                  الرحلة ستُنهى تلقائياً بعد {minutesLeft} دقيقة من وصولك
                </p>
              )}
              {status === "denied" && (
                <p className="text-xs opacity-70">استخدم الإنهاء اليدوي أدناه</p>
              )}
            </div>
          </div>

          {/* Action button */}
          {status === "idle" && (
            <Button size="sm" onClick={requestLocation} className="rounded-xl text-xs shrink-0 bg-blue-600 hover:bg-blue-700 text-white">
              تفعيل GPS
            </Button>
          )}
          {status === "denied" && (
            <Button size="sm" onClick={requestLocation} variant="outline" className="rounded-xl text-xs shrink-0">
              إعادة المحاولة
            </Button>
          )}
        </div>

        {/* Manual fallback always visible */}
        {(status === "idle" || status === "denied" || status === "granted") && (
          <div className="mt-3 pt-3 border-t border-current/20">
            <button
              onClick={completeTrip}
              disabled={completing}
              className="w-full text-center text-xs opacity-70 hover:opacity-100 underline underline-offset-2 transition-opacity"
            >
              {completing ? "جاري الإنهاء..." : "إنهاء الرحلة يدوياً (في حال انتهت)"}
            </button>
          </div>
        )}
      </div>

      {/* Review Wizard */}
      {showReviewWizard && passengers.length > 0 && (
        <DriverReviewWizard
          trip={trip}
          passengers={passengers}
          driverUser={driverUser}
          onClose={() => setShowReviewWizard(false)}
        />
      )}
    </>
  );
}
