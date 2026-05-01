import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Star, Clock, Users, ArrowLeft, Zap, MapPin, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ── City colour palette ────────────────────────────────────────────────────────
const CITY_COLORS = {
  "رام الله": { from: "#2d6a4f", to: "#52b788" }, "نابلس": { from: "#1b4332", to: "#40916c" },
  "الخليل": { from: "#7b2d00", to: "#d4622a" },   "القدس": { from: "#744210", to: "#d97706" },
  "جنين": { from: "#1e3a5f", to: "#2d6fa6" },     "طولكرم": { from: "#3b1f6b", to: "#7c3aed" },
  "قلقيلية": { from: "#0f4c75", to: "#1b7abf" },  "أريحا": { from: "#1a3a1a", to: "#4a7c59" },
  "بيت لحم": { from: "#4a1942", to: "#9b3a8f" },  "بيتين": { from: "#1b4332", to: "#40916c" },
  "العوجا": { from: "#0f4c75", to: "#1b7abf" },   "عزون": { from: "#3b1f6b", to: "#7c3aed" },
  default: { from: "#1f4e3d", to: "#2d7a5f" },
};
const cityColor = (c) => CITY_COLORS[c?.trim()] || CITY_COLORS.default;

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const PS_MONTHS = ["كانون الثاني","شباط","آذار","نيسان","أيار","حزيران","تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول"];
    const d = new Date(dateStr + "T12:00:00");
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((new Date(d).setHours(0,0,0,0) - today) / 86400000);
    if (diff === 0) return "اليوم";
    if (diff === 1) return "غداً";
    if (diff === 2) return "بعد غد";
    const days = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
    if (diff > 2 && diff <= 6) return days[d.getDay()];
    return `${d.getDate()} ${PS_MONTHS[d.getMonth()]}`;
  } catch { return dateStr; }
});
    return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
  } catch { return dateStr; }
}

// ── Compact featured card — vertical on ALL screen sizes ──────────────────────
function FeaturedCard({ trip, index }) {
  const isFemale = trip.driver_gender === "female";
  const fc = cityColor(trip.from_city);
  const tc = cityColor(trip.to_city);

  const bg = trip.car_image
    ? "transparent"
    : isFemale
    ? "linear-gradient(135deg,#fce7f3 0%,#fbcfe8 45%,#f9a8d4 100%)"
    : `linear-gradient(135deg,${fc.from} 0%,${tc.to} 100%)`;

  const shareTrip = (e) => {
    e.preventDefault(); e.stopPropagation();
    const url = `${window.location.origin}/trip/${trip.id}`;
    if (navigator.share) navigator.share({ title:"مِشوار", text:`رحلة من ${trip.from_city} إلى ${trip.to_city}`, url }).catch(()=>{});
    else navigator.clipboard.writeText(url).catch(()=>{});
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.07 }}
    >
      <Link to={`/trip/${trip.id}`}>
        <div className={`rounded-2xl overflow-hidden border transition-all hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] ${
          isFemale ? "border-rose-200 shadow-rose-100/50 shadow-sm" : "border-border hover:border-primary/20"
        }`}>

          {/* ── Route banner ── */}
          <div className="relative h-20 flex items-center justify-between px-4 overflow-hidden" style={{ background: bg }}>
            {trip.car_image && (
              <>
                <img src={trip.car_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                <div className={`absolute inset-0 ${isFemale ? "bg-rose-900/50" : "bg-black/55"}`} />
              </>
            )}

            {/* From city */}
            <div className="relative z-10">
              <p className={`text-[10px] font-medium mb-0.5 ${isFemale && !trip.car_image ? "text-rose-500" : "text-white/70"}`}>من</p>
              <p className={`text-base font-black leading-tight ${isFemale && !trip.car_image ? "text-rose-700" : "text-white"}`}>{trip.from_city}</p>
            </div>

            {/* Centre arrow / icon */}
            <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center ${
              isFemale && !trip.car_image ? "bg-rose-100" : "bg-white/15"
            }`}>
              {isFemale ? <span className="text-sm">🌸</span> : <ArrowLeft className="w-3.5 h-3.5 text-white" />}
            </div>

            {/* To city */}
            <div className="relative z-10 text-left">
              <p className={`text-[10px] font-medium mb-0.5 text-right ${isFemale && !trip.car_image ? "text-rose-500" : "text-white/70"}`}>إلى</p>
              <p className={`text-base font-black leading-tight ${isFemale && !trip.car_image ? "text-rose-700" : "text-white"}`}>{trip.to_city}</p>
            </div>

            {/* Date badge */}
            <div className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
              isFemale && !trip.car_image ? "bg-rose-200/80 text-rose-700" : "bg-black/30 text-white"
            }`}>{formatDate(trip.date)}</div>

            {/* Female / urgency badge */}
            {isFemale
              ? <div className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500 text-white">سائقة 🌸</div>
              : trip.available_seats <= 2 && trip.available_seats > 0
              ? <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-red-500/90 text-white text-[9px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                  <Zap className="w-2.5 h-2.5" />مقعد أخير!
                </div>
              : null
            }
          </div>

          {/* ── Card body ── */}
          <div className={`px-3 py-2.5 ${isFemale ? "bg-gradient-to-b from-rose-50/50 to-white dark:from-[#1c1218] dark:to-[#1c1218]" : "bg-card"}`}>
            <div className="flex items-center justify-between gap-2">

              {/* Driver */}
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-8 h-8 rounded-full overflow-hidden shrink-0 ${isFemale ? "ring-2 ring-rose-200" : "ring-1 ring-border"}`}>
                  {trip.driver_avatar
                    ? <img loading="lazy" src={trip.driver_avatar} alt="" className="w-full h-full object-cover" />
                    : <div className={`w-full h-full flex items-center justify-center text-xs font-bold ${isFemale ? "bg-rose-100 text-rose-600" : "bg-primary/10 text-primary"}`}>
                        {(trip.driver_name||"س")[0]}
                      </div>
                  }
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight truncate">
                    {trip.driver_name || "سائق"}
                    {isFemale && <span className="mr-1 text-[9px] text-rose-500">🌸</span>}
                  </p>
                  <div className="flex items-center gap-1">
                    <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400 shrink-0" />
                    <span className="text-[10px] text-muted-foreground">{trip.driver_rating || "4.8"}</span>
                  </div>
                </div>
              </div>

              {/* Right: time + seats + price */}
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="text-right hidden sm:block">
                  <div className="flex items-center gap-1 text-muted-foreground justify-end">
                    <span className="text-[10px]">{trip.time}</span>
                    <Clock className="w-2.5 h-2.5" />
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground justify-end">
                    <span className="text-[10px]">{trip.available_seats} مقاعد</span>
                    <Users className="w-2.5 h-2.5" />
                  </div>
                </div>

                {/* Time on mobile */}
                <span className="sm:hidden text-[10px] text-muted-foreground">{trip.time}</span>

                <div className={`text-center px-2.5 py-1.5 rounded-xl ${isFemale ? "bg-rose-100 text-rose-700" : "bg-primary/8 text-primary"}`}>
                  <p className="text-base font-black leading-none">₪{trip.price}</p>
                  <p className="text-[9px] opacity-70">للمقعد</p>
                </div>

                {/* Share */}
                <button onClick={shareTrip}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                    isFemale ? "text-rose-400 hover:bg-rose-50" : "text-muted-foreground hover:bg-muted"
                  }`}>
                  <Share2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────
export default function FeaturedTrips() {
  const qc = useQueryClient();
  const { data: trips = [] } = useQuery({
    queryKey: ["featured-trips"],
    queryFn: () => base44.entities.Trip.filter({ status: "confirmed" }, "-created_date", 4),
  });

  useEffect(() => {
    const unsub = base44.entities.Trip.subscribe((ev) => {
      if (ev.type === "create" || ev.type === "update")
        qc.invalidateQueries({ queryKey: ["featured-trips"] });
    });
    return () => unsub();
  }, [qc]);

  if (trips.length === 0) return null;

  return (
    <section className="py-8 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-accent/10 text-accent text-xs font-bold px-3 py-1 rounded-full mb-2">
              <Zap className="w-3 h-3" />متاحة الآن
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">رحلات قريبة منك</h2>
            <p className="text-muted-foreground text-sm mt-0.5">احجز مقعدك قبل أن تمتلئ الرحلة</p>
          </div>
          <Link to="/search">
            <Button variant="outline" className="rounded-xl gap-2 text-sm h-9">
              الكل <ArrowLeft className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        {/* ── VERTICAL list on mobile, 2-col grid on md, 3-col on lg ── */}
        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3">
          {trips.slice(0, 3).map((trip, i) => (
            <FeaturedCard key={trip.id} trip={trip} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
