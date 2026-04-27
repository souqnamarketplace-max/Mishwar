import React from "react";
import { motion } from "framer-motion";
import { Users, Car, MapPin, Star } from "lucide-react";

const stats = [
  { icon: Users, label: "مستخدم نشط", value: "8,746", color: "text-primary" },
  { icon: Car, label: "رحلة مكتملة", value: "2,853", color: "text-accent" },
  { icon: MapPin, label: "مدينة", value: "12+", color: "text-primary" },
  { icon: Star, label: "متوسط التقييم", value: "4.7/5", color: "text-yellow-500" },
];

export default function StatsBar() {
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