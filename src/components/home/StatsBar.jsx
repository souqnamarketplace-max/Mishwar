import React from "react";
import { motion } from "framer-motion";
import { Users, Car, MapPin, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function StatsBar() {
  const { data: trips = [] } = useQuery({
    queryKey: ["stats-trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 1000),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["stats-users"],
    queryFn: () => base44.entities.User.list(),
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ["stats-reviews"],
    queryFn: () => base44.entities.Review.filter({ review_type: "passenger_rates_driver" }),
  });

  const completedTrips = trips.filter((t) => t.status === "completed").length;
  const cities = new Set(trips.map((t) => t.from_city).concat(trips.map((t) => t.to_city))).size;
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : "—";

  const stats = [
    { icon: Users, label: "مستخدم نشط", value: users.length ? users.length.toLocaleString("ar") : "—", color: "text-primary" },
    { icon: Car, label: "رحلة مكتملة", value: completedTrips ? completedTrips.toLocaleString("ar") : "—", color: "text-accent" },
    { icon: MapPin, label: "مدينة", value: cities ? `${cities}+` : "—", color: "text-primary" },
    { icon: Star, label: "متوسط التقييم", value: avgRating !== "—" ? `${avgRating}/5` : "—", color: "text-yellow-500" },
  ];

  return (
    <section className="bg-primary/5 border-y border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color}`} />
              <div className="text-2xl md:text-3xl font-bold text-foreground">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}