import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Star, Clock, Users, ArrowLeft, MapPin, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function TripCard({ trip }) {
  const [liveTrip, setLiveTrip] = useState(trip);

  useEffect(() => {
    if (!trip?.id) return;
    const unsub = base44.entities.Trip.subscribe((payload) => {
      if (payload?.new?.id === trip.id) setLiveTrip(payload.new);
    });
    return unsub;
  }, [trip?.id]);

  const t = liveTrip || trip;
  const seatsLeft = t.available_seats || 0;
  const urgentSeats = seatsLeft > 0 && seatsLeft <= 2;
  const noSeats = seatsLeft === 0;

  return (
    <Link to={`/trip/${t.id}`} className="block active:scale-[0.98] transition-transform">
      <div className={`bg-card rounded-2xl border overflow-hidden shadow-sm active:shadow-md transition-all ${
        noSeats ? "opacity-60 border-border" : urgentSeats ? "border-yellow-400/50" : "border-border hover:border-primary/20"
      }`}>
        {/* Top: Route + Price (most important info first) */}
        <div className="flex items-start justify-between p-4 pb-3">
          <div className="flex-1 min-w-0">
            {/* Route */}
            <div className="flex items-center gap-1.5 font-bold text-foreground text-base mb-1">
              <span className="truncate">{t.from_city}</span>
              <ArrowLeft className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate">{t.to_city}</span>
            </div>
            {/* Date + Time */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{t.date}</span>
              <span className="text-border">•</span>
              <span className="font-medium text-foreground">{t.time}</span>
              {t.distance && (
                <>
                  <span className="text-border">•</span>
                  <span>{t.distance}</span>
                </>
              )}
            </div>
          </div>

          {/* Price — always top right, big and clear */}
          <div className="text-right shrink-0 mr-3">
            <div className="text-2xl font-black text-primary">₪{t.price}</div>
            <div className="text-[10px] text-muted-foreground">للمقعد</div>
          </div>
        </div>

        {/* Middle divider */}
        <div className="mx-4 border-t border-border/60" />

        {/* Bottom: Driver + Seats */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Driver avatar */}
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0 overflow-hidden">
            {t.driver_avatar
              ? <img loading="lazy" src={t.driver_avatar} alt="" className="w-full h-full object-cover" />
              : (t.driver_name?.[0] || "س")
            }
          </div>

          {/* Driver info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{t.driver_name || "سائق"}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 shrink-0" />
              <span className="text-xs text-muted-foreground">{t.driver_rating || "4.5"}</span>
              {t.driver_gender && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {t.driver_gender === "male" ? "👨" : "👩"}
                </span>
              )}
              {t.car_model && (
                <span className="text-xs text-muted-foreground truncate">{t.car_model}</span>
              )}
            </div>
          </div>

          {/* Seats indicator */}
          <div className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold ${
            noSeats
              ? "bg-destructive/10 text-destructive"
              : urgentSeats
              ? "bg-yellow-500/15 text-yellow-700"
              : "bg-primary/8 text-primary"
          }`}>
            {noSeats
              ? <><AlertCircle className="w-3 h-3" /> مكتملة</>
              : <><Users className="w-3 h-3" /> {seatsLeft} مقعد</>
            }
          </div>
        </div>

        {/* Checkpoint warning bar */}
        {t.has_checkpoint && (
          <div className="bg-orange-500/10 border-t border-orange-500/20 px-4 py-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-orange-600 shrink-0" />
            <span className="text-xs text-orange-700">المسار يمر بحاجز عسكري</span>
          </div>
        )}
      </div>
    </Link>
  );
}
