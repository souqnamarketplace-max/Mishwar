import React, { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Users, Car, MapPin, Star } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";

// Animated number counter
function AnimatedNumber({ value, suffix = "", duration = 1.5 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const numericValue = parseInt(value.toString().replace(/\D/g, "")) || 0;

  useEffect(() => {
    if (!inView || numericValue === 0) return;
    let start = 0;
    const steps = 40;
    const increment = numericValue / steps;
    const interval = (duration * 1000) / steps;
    const timer = setInterval(() => {
      start += increment;
      if (start >= numericValue) {
        setDisplay(numericValue);
        clearInterval(timer);
      } else {
        setDisplay(Math.floor(start));
      }
    }, interval);
    return () => clearInterval(timer);
  }, [inView, numericValue, duration]);

  return (
    <span ref={ref}>
      {display.toLocaleString("ar")}{suffix}
    </span>
  );
}

export default function StatsBar() {
  const qc = useQueryClient();

  // app_settings gates the entire bar. Until an admin sets
  // public_stats_enabled=true, the section renders nothing — which is
  // the correct launch-day behaviour (no fake "10,000+ users" claim).
  const { data: settingsArr = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => api.entities.AppSettings.list(),
    staleTime: 5 * 60 * 1000,
  });
  const settings = settingsArr[0] || {};
  const statsEnabled = settings.public_stats_enabled === true;
  const minUsers = Number(settings.public_stats_min_users ?? 100);

  const { data: trips = [] } = useQuery({
    queryKey: ["stats-trips"],
    queryFn: () => api.entities.Trip.list("-created_date", 1000),
    enabled: statsEnabled,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["stats-users"],
    queryFn: () => api.entities.User.list(),
    enabled: statsEnabled,
  });
  const { data: reviews = [] } = useQuery({
    queryKey: ["stats-reviews"],
    queryFn: () => api.entities.Review.filter({ review_type: "passenger_rates_driver" }),
    enabled: statsEnabled,
  });

  useEffect(() => {
    if (!statsEnabled) return;
    const u1 = api.entities.Trip.subscribe(() => qc.invalidateQueries({ queryKey: ["stats-trips"] }));
    const u2 = api.entities.Review.subscribe(() => qc.invalidateQueries({ queryKey: ["stats-reviews"] }));
    return () => { u1(); u2(); };
  }, [qc, statsEnabled]);

  // Don't render anything when stats are disabled OR when the real
  // user count is below the threshold the admin set. Showing inflated
  // round numbers as "social proof" is not honest and risks app-store
  // rejection for misleading marketing.
  if (!statsEnabled) return null;
  if (users.length < minUsers) return null;

  const completedTrips = trips.filter(t => t.status === "completed").length;
  const cities = new Set([...trips.map(t => t.from_city), ...trips.map(t => t.to_city)].filter(Boolean)).size;
  // Filter out null / non-numeric ratings before averaging. A single
  // null in the dataset (e.g. a soft-deleted review whose rating was
  // nulled, or a partial INSERT that landed in the table without a
  // rating) would otherwise propagate through the reduce as NaN and
  // the home page would display 'NaN/5' as the average — visibly
  // broken on a marketing surface.
  const validRatings = reviews.filter(r => typeof r.rating === "number" && !isNaN(r.rating));
  const avgRating = validRatings.length
    ? (validRatings.reduce((s, r) => s + r.rating, 0) / validRatings.length).toFixed(1)
    : null;

  // Each tile only appears if its underlying data is real and meaningful.
  // Empty list of stats → bar renders nothing.
  const stats = [];
  if (users.length > 0) stats.push({
    icon: Users, label: "مسافر فلسطيني", value: users.length,
    color: "text-primary", bg: "bg-primary/10", emoji: "👥",
  });
  if (completedTrips > 0) stats.push({
    icon: Car, label: "رحلة مكتملة", value: completedTrips,
    color: "text-accent", bg: "bg-accent/10", emoji: "🚗",
  });
  if (cities > 0) stats.push({
    icon: MapPin, label: "مدينة وقرية", value: cities,
    color: "text-blue-600", bg: "bg-blue-500/10", emoji: "📍",
  });
  if (avgRating !== null) stats.push({
    icon: Star, label: "متوسط التقييم", value: 0, suffix: "/5",
    display: avgRating, color: "text-yellow-500", bg: "bg-yellow-400/10", emoji: "⭐",
  });

  if (stats.length === 0) return null;

  return (
    <section className="bg-card border-b border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, type: "spring", stiffness: 100 }}
              className="flex items-center gap-3 p-3 sm:p-4 rounded-2xl hover:bg-muted/40 transition-colors"
            >
              <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl ${stat.bg} flex items-center justify-center shrink-0 text-xl`}>
                {stat.emoji}
              </div>
              <div>
                <div className={`text-xl sm:text-2xl font-black ${stat.color} leading-none`}>
                  {stat.display ? stat.display : (
                    <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                  )}
                </div>
                <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{stat.label}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
