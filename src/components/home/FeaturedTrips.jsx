import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Star, Clock, MapPin, Users, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

const sampleTrips = [
  {
    id: "1",
    from: "رام الله",
    to: "نابلس",
    date: "السبت 25 مايو",
    time: "08:30 صباحاً",
    price: 50,
    driver: "أحمد أبو الخير",
    rating: 4.8,
    seats: 3,
    car: "كيا سبورتاج 2020",
    image: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=200&fit=crop"
  },
  {
    id: "2",
    from: "نابلس",
    to: "رام الله",
    date: "الأحد 26 مايو",
    time: "10:00 صباحاً",
    price: 40,
    driver: "محمد درويش",
    rating: 4.6,
    seats: 2,
    car: "تويوتا كورولا 2019",
    image: "https://images.unsplash.com/photo-1467803738586-46b7eb7b16a1?w=400&h=200&fit=crop"
  },
  {
    id: "3",
    from: "الخليل",
    to: "بيت لحم",
    date: "الثلاثاء 28 مايو",
    time: "10:00 صباحاً",
    price: 35,
    driver: "سامي أبو أحمد",
    rating: 4.7,
    seats: 4,
    car: "هيونداي توسان 2018",
    image: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=200&fit=crop"
  },
];

export default function FeaturedTrips() {
  return (
    <section className="py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">رحلات قادمة</h2>
            <p className="text-muted-foreground text-sm mt-1">أحدث الرحلات المتاحة للحجز</p>
          </div>
          <Link to="/search">
            <Button variant="outline" className="rounded-xl gap-2">
              عرض الكل
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {sampleTrips.map((trip, i) => (
            <motion.div
              key={trip.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <Link to={`/trip/${trip.id}`}>
                <div className="bg-card rounded-2xl border border-border overflow-hidden hover:shadow-lg hover:border-primary/20 transition-all group">
                  <div className="relative h-40 overflow-hidden">
                    <img src={trip.image} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute top-3 right-3 bg-card/90 backdrop-blur-sm rounded-lg px-2 py-1 text-xs font-medium text-primary">
                      {trip.date}
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2 text-foreground font-bold text-lg mb-2">
                      <span>{trip.from}</span>
                      <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                      <span>{trip.to}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {trip.time}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {trip.seats} مقاعد
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {trip.driver[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{trip.driver}</p>
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                            <span className="text-xs text-muted-foreground">{trip.rating}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-left">
                        <span className="text-xl font-bold text-primary">₪{trip.price}</span>
                        <p className="text-[10px] text-muted-foreground">للمقعد</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}