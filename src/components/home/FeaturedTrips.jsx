import React, { useEffect } from "react";
import { isTripExpired } from "@/lib/tripScheduling";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Star, Clock, MapPin, Users, ArrowLeft, Zap, TrendingDown } from "lucide-react";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function FeaturedTrips() {
  const qc = useQueryClient();
  const { data: liveTrips = [] } = useQuery({
    queryKey: ["featured-trips"],
    queryFn: () => base44.entities.Trip.filter({ status: "confirmed" }, "-created_date", 3),
  });

  // Real-time subscription for new trips
  useEffect(() => {
    const unsubscribe = base44.entities.Trip.subscribe((event) => {
      if (event.type === "create" || event.type === "update") {
        qc.invalidateQueries({ queryKey: ["featured-trips"] });
      }
    });
    return () => unsubscribe();
  }, [qc]);

  const trips = liveTrips.slice(0, 3).map(t => ({
    ...t,
    urgent: t.available_seats <= 2,
  }));

  // If no real trips available, render nothing (don't show fake fallback data)
  if (trips.length === 0) return null;

  return (
    <section className="py-14 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="inline-flex items-center gap-1.5 bg-accent/10 text-accent text-xs font-bold px-3 py-1 rounded-full mb-2">
              <Zap className="w-3 h-3" />
              متاحة الآن
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">رحلات قريبة منك</h2>
            <p className="text-muted-foreground text-sm mt-1">احجز مقعدك قبل أن تمتلئ الرحلة</p>
          </div>
          <Link to="/search">
            <Button variant="outline" className="rounded-xl gap-2 hidden sm:flex">
              عرض جميع الرحلات
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-visible md:pb-0 -mx-4 px-4 md:mx-0 md:px-0">
          {trips.map((trip, i) => (
            <motion.div
              key={trip.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="shrink-0 w-[85vw] sm:w-[70vw] md:w-auto snap-start"
            >
              <Link to={`/trip/${trip.id}`}>
                <div className="bg-card rounded-2xl border border-border overflow-hidden hover:shadow-xl hover:border-primary/30 transition-all group cursor-pointer">
                  <div className="relative h-40 overflow-hidden">
                    <img loading="lazy"
                      src={trip.image || "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=200&fit=crop"}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    {/* Urgency badge */}
                    {(trip.urgent || trip.available_seats <= 2) && (
                      <div className="absolute top-3 left-3 bg-destructive text-destructive-foreground text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 animate-pulse">
                        <Zap className="w-3 h-3" />
                        مقعد أخير!
                      </div>
                    )}
                    <div className="absolute top-3 right-3 bg-card/90 backdrop-blur-sm rounded-lg px-2 py-1 text-xs font-bold text-foreground">
                      {trip.date || "قريباً"}
                    </div>
                  </div>

                  <div className="p-4">
                    {/* Route */}
                    <div className="flex items-center gap-2 text-foreground font-bold text-lg mb-2">
                      <span>{trip.from_city}</span>
                      <ArrowLeft className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span>{trip.to_city}</span>
                    </div>

                    <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {trip.time}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {trip.available_seats} مقاعد
                      </span>
                    </div>

                    {/* Savings pill */}
                    {trip.savings && (
                      <div className="flex items-center gap-1 text-xs text-accent font-medium bg-accent/10 rounded-lg px-2.5 py-1 w-fit mb-3">
                        <TrendingDown className="w-3 h-3" />
                        وفّر حتى ₪{trip.savings} مقارنة بالتاكسي
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {(trip.driver_name || "س")[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium leading-tight">{trip.driver_name}</p>
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                            <span className="text-xs text-muted-foreground">{trip.driver_rating || "4.8"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-left">
                        <span className="text-2xl font-black text-primary">₪{trip.price}</span>
                        <p className="text-[10px] text-muted-foreground">للمقعد فقط</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="flex justify-center mt-6 sm:hidden">
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