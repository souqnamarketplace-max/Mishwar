import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Star, Clock, Users, ArrowLeft, Heart, MapPin, Car } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function TripCard({ trip, compact = false }) {
  const [liveTrip, setLiveTrip] = useState(trip);

  useEffect(() => {
    if (!trip?.id) return;
    
    const unsubscribe = base44.entities.Trip.subscribe((event) => {
      if (event.id === trip.id && (event.type === 'update' || event.type === 'create')) {
        setLiveTrip(event.data);
      }
    });

    return unsubscribe;
  }, [trip?.id]);

  const displayTrip = liveTrip || trip;

  return (
    <Link to={`/trip/${displayTrip.id}`}>
      <div className="bg-card rounded-2xl border border-border p-4 hover:shadow-lg hover:border-primary/20 transition-all group">
        {/* Route */}
        <div className="flex items-center gap-2 font-bold text-foreground mb-2">
          <MapPin className="w-4 h-4 text-primary shrink-0" />
          <span>{displayTrip.from_city}</span>
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          <span>{displayTrip.to_city}</span>
          {displayTrip.status === "confirmed" && (
            <span className="mr-auto text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">مؤكدة</span>
          )}
        </div>

        {/* Time and Date */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {displayTrip.date} • {displayTrip.time}
          </span>
          <span className={`flex items-center gap-1 px-2 py-1 rounded-lg ${displayTrip.available_seats <= 2 ? 'bg-yellow-500/10 text-yellow-700' : 'text-muted-foreground'}`}>
            <Users className="w-3.5 h-3.5" />
            {displayTrip.available_seats || 0} مقاعد متاحة
          </span>
        </div>

        {/* Driver + Price */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {displayTrip.driver_name?.[0] || "؟"}
            </div>
            <div>
            <p className="text-sm font-medium text-foreground">{displayTrip.driver_name || "سائق"}</p>
            <div className="flex items-center gap-1 flex-wrap">
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              <span className="text-xs text-muted-foreground">{displayTrip.driver_rating || "4.5"}</span>
              {displayTrip.driver_gender && (
                <>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">
                    {displayTrip.driver_gender === "male" ? "👨 رجل" : "👩 امرأة"}
                  </span>
                </>
              )}
              {displayTrip.car_model && (
                <>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Car className="w-3 h-3" />
                    {displayTrip.car_model}
                  </span>
                </>
              )}
            </div>
            </div>
          </div>
          <div className="text-left">
            <span className="text-xl font-bold text-primary">₪{displayTrip.price}</span>
            <p className="text-[10px] text-muted-foreground">للمقعد</p>
          </div>
        </div>
      </div>
    </Link>
  );
}