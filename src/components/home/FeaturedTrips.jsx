import React, { useEffect } from "react";
import { isTripExpired } from "@/lib/tripScheduling";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Star, Clock, Users, ArrowLeft, Zap, MapPin, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// Palestinian city → gradient color map
const CITY_COLORS = {
  "رام الله":   { from: "#2d6a4f", to: "#52b788" },
  "نابلس":      { from: "#1b4332", to: "#40916c" },
  "الخليل":     { from: "#7b2d00", to: "#d4622a" },
  "القدس":      { from: "#744210", to: "#d97706" },
  "جنين":       { from: "#1e3a5f", to: "#2d6fa6" },
  "طولكرم":     { from: "#3b1f6b", to: "#7c3aed" },
  "قلقيلية":    { from: "#0f4c75", to: "#1b7abf" },
  "أريحا":      { from: "#1a3a1a", to: "#4a7c59" },
  "بيت لحم":    { from: "#4a1942", to: "#9b3a8f" },
  "بيتين":      { from: "#1b4332", to: "#40916c" },
  "العوجا":     { from: "#0f4c75", to: "#1b7abf" },
  "أريحا":      { from: "#006400", to: "#32cd32" },
  "عزون":       { from: "#3b1f6b", to: "#7c3aed" },
  default:      { from: "#1f4e3d", to: "#2d7a5f" },
};

function getCityColor(city) {
  return CITY_COLORS[city?.trim()] || CITY_COLORS.default;
}

function formatTripDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(d); target.setHours(0,0,0,0);
    const diffDays = Math.round((target - today) / 86400000);
    if (diffDays === 0) return "اليوم";
    if (diffDays === 1) return "غداً";
    if (diffDays === 2) return "بعد غد";
    if (diffDays > 0 && diffDays <= 7)
      return d.toLocaleDateString("ar-EG", { weekday: "long" });
    return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
  } catch { return dateStr; }
}

// ── Compact route banner (replaces the photo) ──────────────────────────────
function RouteBanner({ trip }) {
  const fromColor = getCityColor(trip.from_city);
  const toColor   = getCityColor(trip.to_city);
  const isFemale  = trip.driver_gender === "female";

  return (
    <div
      className="relative h-24 overflow-hidden flex items-center justify-between px-4"
      style={{
        background: trip.car_image
          ? "transparent"
          : isFemale
          ? "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 40%, #f9a8d4 100%)"
          : `linear-gradient(135deg, ${fromColor.from} 0%, ${toColor.to} 100%)`,
      }}
    >
      {/* Car photo background */}
      {trip.car_image && (
        <>
          <img src={trip.car_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className={`absolute inset-0 ${isFemale ? "bg-rose-900/50" : "bg-black/50"}`} />
        </>
      )}
      {/* Subtle road texture lines */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(255,255,255,0.3) 40px, rgba(255,255,255,0.3) 42px)",
        }}
      />

      {/* FROM city */}
      <div className="relative z-10 text-right">
        <div className={`flex items-center gap-1 mb-0.5 ${isFemale ? 'text-rose-500' : 'text-white/70'}`}>
          <MapPin className="w-3 h-3" />
          <span className="text-[10px] font-medium">من</span>
        </div>
        <p className={`text-base font-black leading-tight ${isFemale ? 'text-rose-700' : 'text-white'}`}>
          {trip.from_city}
        </p>
      </div>

      {/* Road / arrow */}
      <div className="relative z-10 flex flex-col items-center gap-1">
        <div className={`flex items-center gap-1 ${isFemale ? 'text-rose-400' : 'text-white/60'}`}>
          <div className={`h-px w-8 ${isFemale ? 'bg-rose-300' : 'bg-white/40'}`} />
          <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
            isFemale ? 'bg-rose-100' : 'bg-white/20'
          }`}>
            {isFemale
              ? <span className="text-[10px]">🌸</span>
              : <ArrowLeft className="w-3 h-3 text-white" />
            }
          </div>
          <div className={`h-px w-8 ${isFemale ? 'bg-rose-300' : 'bg-white/40'}`} />
        </div>
        {/* Distance chip */}
        {trip.distance && (
          <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
            isFemale
              ? 'bg-rose-100 text-rose-600'
              : 'bg-white/20 text-white'
          }`}>
            {trip.distance}
          </span>
        )}
      </div>

      {/* TO city */}
      <div className="relative z-10 text-left">
        <div className={`flex items-center gap-1 mb-0.5 justify-end ${isFemale ? 'text-rose-500' : 'text-white/70'}`}>
          <span className="text-[10px] font-medium">إلى</span>
          <MapPin className="w-3 h-3" />
        </div>
        <p className={`text-base font-black leading-tight ${isFemale ? 'text-rose-700' : 'text-white'}`}>
          {trip.to_city}
        </p>
      </div>

      {/* Date badge */}
      <div className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
        isFemale
          ? 'bg-rose-200/80 text-rose-700'
          : 'bg-black/25 text-white'
      }`}>
        {formatTripDate(trip.date)}
      </div>

      {/* Female badge */}
      {isFemale && (
        <div className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500 text-white flex items-center gap-0.5">
          <span>سائقة</span>
          <span>🌸</span>
        </div>
      )}

      {/* Urgency */}
      {trip.available_seats <= 2 && trip.available_seats > 0 && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-red-500/90 text-white text-[9px] font-bold px-2 py-0.5 rounded-full animate-pulse">
          <Zap className="w-2.5 h-2.5" />
          مقعد أخير!
        </div>
      )}
    </div>
  );
}


export default function FeaturedTrips() {
  const qc = useQueryClient();
  const { data: liveTrips = [] } = useQuery({
    queryKey: ["featured-trips"],
    queryFn: () => base44.entities.Trip.filter({ status: "confirmed" }, "-created_date", 3),
  });

  useEffect(() => {
    const unsubscribe = base44.entities.Trip.subscribe((event) => {
      if (event.type === "create" || event.type === "update") {
        qc.invalidateQueries({ queryKey: ["featured-trips"] });
      }
    });
    return () => unsubscribe();
  }, [qc]);

  const trips = liveTrips.slice(0, 3);
  if (trips.length === 0) return null;

  return (
    <section className="py-10 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-accent/10 text-accent text-xs font-bold px-3 py-1 rounded-full mb-2">
              <Zap className="w-3 h-3" />
              متاحة الآن
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">رحلات قريبة منك</h2>
            <p className="text-muted-foreground text-sm mt-0.5">احجز مقعدك قبل أن تمتلئ الرحلة</p>
          </div>
          <Link to="/search">
            <Button variant="outline" className="rounded-xl gap-2 hidden sm:flex">
              عرض جميع الرحلات
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {/* Cards */}
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-visible md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
          {trips.map((trip, i) => {
            const isFemale = trip.driver_gender === "female";
            return (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="shrink-0 w-[78vw] sm:w-[55vw] md:w-auto snap-start"
              >
                <Link to={`/trip/${trip.id}`}>
                  <div className={`rounded-2xl overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                    isFemale
                      ? "border-2 border-rose-300 shadow-rose-100 shadow-sm"
                      : "border border-border hover:border-primary/20"
                  }`}>

                    {/* Route banner — replaces photo */}
                    <RouteBanner trip={trip} />

                    {/* Card body */}
                    <div className={`p-3 ${isFemale ? "bg-gradient-to-b from-rose-50/50 to-white dark:from-[#1c1218] dark:to-[#1c1218]" : "bg-card"}`}>
                      <div className="flex items-center justify-between">
                        {/* Driver */}
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isFemale
                              ? "bg-rose-100 text-rose-700 ring-2 ring-rose-200"
                              : "bg-primary/10 text-primary"
                          }`}>
                            {(trip.driver_name || "س")[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate leading-tight">
                              {trip.driver_name || "سائق"}
                              {isFemale && (
                                <span className="mr-1 text-[9px] text-rose-500 font-bold">🌸</span>
                              )}
                            </p>
                            <div className="flex items-center gap-1">
                              <Star className="w-2.5 h-2.5 text-yellow-500 fill-yellow-500" />
                              <span className="text-[10px] text-muted-foreground">{trip.driver_rating || "4.8"}</span>
                            </div>
                          </div>
                        </div>

                        {/* Meta: time + seats + price */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className="flex items-center gap-1 text-muted-foreground justify-end">
                              <span className="text-[10px]">{trip.time}</span>
                              <Clock className="w-2.5 h-2.5" />
                            </div>
                            <div className="flex items-center gap-1 text-muted-foreground justify-end">
                              <span className="text-[10px]">{trip.available_seats} مقاعد</span>
                              <Users className="w-2.5 h-2.5" />
                            </div>
                          </div>
                          <div className={`text-center px-2.5 py-1.5 rounded-xl ${
                            isFemale
                              ? "bg-rose-100 text-rose-700"
                              : "bg-primary/8 text-primary"
                          }`}>
                            <p className="text-lg font-black leading-none">₪{trip.price}</p>
                            <p className="text-[9px] opacity-70">للمقعد</p>
                          </div>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); const url=`${window.location.origin}/trip/${trip.id}`; if(navigator.share)navigator.share({title:"مِشوار",text:`رحلة من ${trip.from_city} إلى ${trip.to_city}`,url}).catch(()=>{}); else navigator.clipboard.writeText(url).catch(()=>{}); }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                          ><Share2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>

        <div className="flex justify-center mt-5 sm:hidden">
          <Link to="/search">
            <Button variant="outline" className="rounded-xl gap-2">
              عرض جميع الرحلات
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
