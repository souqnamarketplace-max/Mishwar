import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Users, Heart, Shield, Star, MapPin, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import EmptyState from "@/components/shared/EmptyState";

export default function Community() {
  useSEO({ title: "المجتمع", description: "مجتمع مِشوار من المسافرين والسائقين" });

  // Real DB queries — top drivers, popular routes, stats
  const { data: drivers = [] } = useQuery({
    queryKey: ["community-top-drivers"],
    queryFn: async () => {
      const list = await base44.entities.User.filter(
        { account_type: "both" },
        "-total_rating",
        20
      );
      // Also include drivers
      const drivers2 = await base44.entities.User.filter(
        { account_type: "driver" },
        "-total_rating",
        20
      );
      return [...list, ...drivers2]
        .filter(u => u.total_reviews > 0)
        .sort((a, b) => (b.total_rating || 0) - (a.total_rating || 0))
        .slice(0, 6);
    },
  });

  const { data: trips = [] } = useQuery({
    queryKey: ["community-trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 200),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["community-users-count"],
    queryFn: () => base44.entities.User.list("-created_date", 1000),
  });

  // Compute popular routes from real trips
  const routeCounts = {};
  trips.forEach(t => {
    const key = `${t.from_city}→${t.to_city}`;
    routeCounts[key] = (routeCounts[key] || 0) + 1;
  });
  const popularRoutes = Object.entries(routeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([key, count]) => {
      const [from, to] = key.split("→");
      return { from, to, count };
    });

  // Compute community stats from real data
  const completedTrips = trips.filter(t => t.status === "completed").length;
  const allRatings = drivers.flatMap(d => d.total_rating ? [d.total_rating] : []);
  const avgRating = allRatings.length
    ? (allRatings.reduce((s, r) => s + r, 0) / allRatings.length).toFixed(1)
    : "—";
  const cities = new Set();
  trips.forEach(t => { if (t.from_city) cities.add(t.from_city); if (t.to_city) cities.add(t.to_city); });

  const communityStats = [
    { value: users.length.toLocaleString("ar"), label: "مستخدم" },
    { value: completedTrips.toLocaleString("ar"), label: "رحلة مكتملة" },
    { value: avgRating, label: "متوسط التقييم" },
    { value: cities.size.toLocaleString("ar"), label: "مدينة" },
  ];

  // Map drivers to display shape
  const topDrivers = drivers.map(d => ({
    name: d.full_name || d.email?.split("@")[0] || "سائق",
    email: d.email,
    rating: d.total_rating || 0,
    trips: d.total_reviews || 0,  // approximate; in reality we'd count completed trips
    city: d.city || "—",
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Users className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">مجتمع مِشوار</h1>
        <p className="text-muted-foreground">كل رحلة توصلك لأحبايك وتدعم مجتمعك</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        {communityStats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="bg-card rounded-2xl border border-border p-6 text-center"
          >
            <p className="text-3xl font-bold text-primary">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Top Drivers */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-foreground mb-6">سائقون مميزون</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {topDrivers.map((driver, i) => (
            <motion.div
              key={driver.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4 hover:shadow-md transition-all"
            >
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0">
                {driver.name[0]}
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-foreground">{driver.name}</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  <span>{driver.rating}</span>
                  <span>•</span>
                  <span>{driver.trips} رحلة</span>
                  <span>•</span>
                  <MapPin className="w-3 h-3" />
                  <span>{driver.city}</span>
                </div>
              </div>
              <Shield className="w-5 h-5 text-accent" />
            </motion.div>
          ))}
        </div>
      </div>

      {/* Popular Routes */}
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-6">المسارات الأكثر شعبية</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {popularRoutes.map((route) => (
            <div key={route.from + route.to} className="bg-card rounded-2xl border border-border p-5 flex items-center justify-between hover:shadow-md transition-all">
              <div className="flex items-center gap-3 font-bold text-foreground">
                <MapPin className="w-5 h-5 text-primary" />
                <span>{route.from}</span>
                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                <span>{route.to}</span>
              </div>
              <span className="text-sm text-muted-foreground">{route.count} رحلة</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}