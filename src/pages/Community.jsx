import React from "react";
import { Users, Heart, Shield, Star, MapPin, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

const communityStats = [
  { value: "8,746+", label: "مستخدم نشط" },
  { value: "2,853", label: "رحلة مكتملة" },
  { value: "4.7/5", label: "متوسط التقييم" },
  { value: "12+", label: "مدينة فلسطينية" },
];

const topDrivers = [
  { name: "أحمد أبو الخير", rating: 4.8, trips: 170, city: "رام الله" },
  { name: "محمد درويش", rating: 4.6, trips: 89, city: "نابلس" },
  { name: "سامي أبو أحمد", rating: 4.7, trips: 801, city: "الخليل" },
  { name: "يوسف حمدان", rating: 4.5, trips: 210, city: "بيت لحم" },
  { name: "عمر خالد", rating: 4.9, trips: 350, city: "جنين" },
  { name: "إبراهيم ناصر", rating: 4.4, trips: 120, city: "غزة" },
];

const popularRoutes = [
  { from: "رام الله", to: "نابلس", count: 450 },
  { from: "الخليل", to: "بيت لحم", count: 320 },
  { from: "جنين", to: "نابلس", count: 280 },
  { from: "غزة", to: "رام الله", count: 180 },
];

export default function Community() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Users className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">مجتمع سيرتنا</h1>
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