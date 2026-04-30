import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Star, Clock, Users, ArrowLeft, MapPin, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";


// Format PostgreSQL DATE (YYYY-MM-DD) to friendly Arabic
function formatTripDate(dateStr) {
  if (!dateStr) return "";
  if (/[\u0600-\u06FF]/.test(dateStr) || dateStr.includes("/")) return dateStr;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target - today) / 86400000);
    if (diffDays === 0) return "اليوم";
    if (diffDays === 1) return "غداً";
    if (diffDays === -1) return "أمس";
    if (diffDays > 1 && diffDays <= 7) return d.toLocaleDateString("ar-EG", { weekday: "long" });
    return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}


// ── Female driver card — elegant rose/floral theme ────────────────────────────
function FemaleTripCard({ t, noSeats, urgentSeats }) {
  return (
    <div className={`relative rounded-2xl overflow-hidden shadow-sm transition-all ${
      noSeats ? "opacity-60" : "hover:shadow-md hover:-translate-y-0.5"
    }`}>

      {/* Rose gradient border effect */}
      <div className={`absolute inset-0 rounded-2xl ${
        noSeats
          ? "bg-border"
          : "bg-gradient-to-br from-rose-300 via-pink-200 to-fuchsia-300"
      }`} />

      {/* Inner card */}
      <div className="relative m-[1.5px] rounded-[14px] bg-white dark:bg-[#1c1218] overflow-hidden">

        {/* Decorative floral header strip */}
        {!noSeats && (
          <div className="h-1 w-full bg-gradient-to-r from-rose-400 via-pink-300 to-fuchsia-400" />
        )}

        {/* Floating rose petals decoration — top right */}
        <div className="absolute top-2 left-2 text-[10px] opacity-30 select-none pointer-events-none leading-none">
          🌸🌷🌸
        </div>

        {/* Top: Route + Price */}
        <div className="flex items-start justify-between p-4 pb-3 pt-3">
          <div className="flex-1 min-w-0">

            {/* Female driver badge */}
            <div className="flex items-center gap-1.5 mb-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-gradient-to-r from-rose-500 to-pink-500 text-white px-2.5 py-0.5 rounded-full shadow-sm shadow-rose-200">
                <span>👩</span>
                <span>سائقة</span>
              </span>
              {t.driver_rating > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-rose-700 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-full border border-rose-200/60">
                  <Star className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
                  {Number(t.driver_rating).toFixed(1)}
                </span>
              )}
            </div>

            {/* Route */}
            <div className="flex items-center gap-1.5 font-bold text-foreground text-base mb-1">
              <span className="truncate">{t.from_city}</span>
              <ArrowLeft className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="truncate">{t.to_city}</span>
            </div>

            {/* Via cities */}
            {Array.isArray(t.stops) && t.stops.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-rose-400/80 mb-1 flex-wrap">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{t.stops.map(s => s.city).filter(Boolean).join(" • ")}</span>
              </div>
            )}

            {/* Date + Time */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="w-3.5 h-3.5 shrink-0 text-pink-400" />
              <span>{formatTripDate(t.date)}</span>
              <span className="text-pink-200">•</span>
              <span className="font-medium text-foreground">{t.time}</span>
              {t.distance && (
                <>
                  <span className="text-pink-200">•</span>
                  <span>{t.distance}</span>
                </>
              )}
            </div>
          </div>

          {/* Price */}
          <div className="text-right shrink-0 mr-3">
            <div className="text-2xl font-black bg-gradient-to-br from-rose-500 to-fuchsia-600 bg-clip-text text-transparent">
              ₪{t.price}
            </div>
            <div className="text-[10px] text-muted-foreground">للمقعد</div>
          </div>
        </div>

        {/* Divider with rose tint */}
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-rose-200/60 to-transparent" />

        {/* Bottom: Driver + Seats */}
        <div className="flex items-center gap-3 px-4 py-3">

          {/* Driver avatar with rose ring */}
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-200 to-pink-300 flex items-center justify-center text-sm font-bold text-rose-700 overflow-hidden ring-2 ring-rose-200 dark:ring-rose-800">
              {t.driver_avatar
                ? <img loading="lazy" src={t.driver_avatar} alt="" className="w-full h-full object-cover" />
                : (t.driver_name?.[0] || "س")
              }
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 text-[10px] leading-none">🌸</span>
          </div>

          {/* Driver info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{t.driver_name || "سائقة"}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {t.driver_rating === 0 && (
                <span className="text-xs bg-rose-50 text-rose-600 dark:bg-rose-950/40 px-1.5 py-0.5 rounded-full border border-rose-200/50">
                  سائقة جديدة ✨
                </span>
              )}
              {t.car_model && (
                <span className="text-xs text-muted-foreground truncate">{t.car_model}</span>
              )}
            </div>
          </div>

          {/* Seats */}
          <div className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold ${
            noSeats
              ? "bg-destructive/10 text-destructive"
              : urgentSeats
              ? "bg-amber-500/10 text-amber-700 border border-amber-200/60"
              : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 border border-rose-200/50"
          }`}>
            {noSeats
              ? <><AlertCircle className="w-3 h-3" /> مكتملة</>
              : <><Users className="w-3 h-3" /> {t.available_seats} مقعد</>
            }
          </div>
        </div>

        {/* Women-only preference badge */}
        {t.driver_gender === "female" && (
          <div className="bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/30 border-t border-rose-100/60 dark:border-rose-900/40 px-4 py-2 flex items-center justify-between">
            <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5">
              🌷 رحلة بقيادة امرأة — آمنة ومريحة
            </span>
          </div>
        )}

        {/* Checkpoint warning */}
        {t.has_checkpoint && (
          <div className="bg-orange-500/10 border-t border-orange-500/20 px-4 py-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-orange-600 shrink-0" />
            <span className="text-xs text-orange-700">المسار يمر بحاجز عسكري</span>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Standard male/neutral card ────────────────────────────────────────────────
function StandardTripCard({ t, noSeats, urgentSeats }) {
  return (
    <div className={`bg-card rounded-2xl border overflow-hidden shadow-sm active:shadow-md transition-all ${
      noSeats ? "opacity-60 border-border" : urgentSeats ? "border-yellow-400/50" : "border-border hover:border-primary/20"
    }`}>
      {/* Top: Route + Price */}
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 font-bold text-foreground text-base mb-1">
            <span className="truncate">{t.from_city}</span>
            <ArrowLeft className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate">{t.to_city}</span>
          </div>
          {Array.isArray(t.stops) && t.stops.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1 flex-wrap">
              <span className="font-medium">عبر:</span>
              <span className="truncate">{t.stops.map(s => s.city).filter(Boolean).join(" • ")}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>{formatTripDate(t.date)}</span>
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
        <div className="text-right shrink-0 mr-3">
          <div className="text-2xl font-black text-primary">₪{t.price}</div>
          <div className="text-[10px] text-muted-foreground">للمقعد</div>
        </div>
      </div>

      <div className="mx-4 border-t border-border/60" />

      {/* Bottom: Driver + Seats */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0 overflow-hidden">
          {t.driver_avatar
            ? <img loading="lazy" src={t.driver_avatar} alt="" className="w-full h-full object-cover" />
            : (t.driver_name?.[0] || "س")
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{t.driver_name || "سائق"}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {t.driver_rating > 0 ? (
              <>
                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 shrink-0" />
                <span className="text-xs text-muted-foreground">{Number(t.driver_rating).toFixed(1)}</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground bg-accent/10 text-accent px-1.5 py-0.5 rounded-full">سائق جديد</span>
            )}
            {t.driver_gender === "male" && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">👨</span>
            )}
            {t.car_model && (
              <span className="text-xs text-muted-foreground truncate">{t.car_model}</span>
            )}
          </div>
        </div>
        <div className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold ${
          noSeats
            ? "bg-destructive/10 text-destructive"
            : urgentSeats
            ? "bg-yellow-500/15 text-yellow-700"
            : "bg-primary/8 text-primary"
        }`}>
          {noSeats
            ? <><AlertCircle className="w-3 h-3" /> مكتملة</>
            : <><Users className="w-3 h-3" /> {t.available_seats} مقعد</>
          }
        </div>
      </div>

      {t.has_checkpoint && (
        <div className="bg-orange-500/10 border-t border-orange-500/20 px-4 py-2 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-orange-600 shrink-0" />
          <span className="text-xs text-orange-700">المسار يمر بحاجز عسكري</span>
        </div>
      )}
    </div>
  );
}


// ── Main TripCard — routes to the right variant ───────────────────────────────
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
  const isFemale = t.driver_gender === "female";

  return (
    <Link to={`/trip/${t.id}`} className="block active:scale-[0.98] transition-transform">
      {isFemale
        ? <FemaleTripCard t={t} noSeats={noSeats} urgentSeats={urgentSeats} />
        : <StandardTripCard t={t} noSeats={noSeats} urgentSeats={urgentSeats} />
      }
    </Link>
  );
}
