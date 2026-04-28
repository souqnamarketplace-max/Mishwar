import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, MapPin, Calendar, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

const CITIES = ["رام الله", "نابلس", "الخليل", "بيت لحم", "غزة", "جنين", "طولكرم", "قلقيلية"];

export default function HeroSection() {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState("");

  const handleSearch = (e) => {
    e.preventDefault();
    navigate(`/search?from=${from}&to=${to}&date=${date}`);
  };

  return (
    <section className="relative overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1600&fit=crop"
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-l from-primary/80 via-primary/60 to-primary/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-28">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 leading-tight drop-shadow-lg">
              كيف تحجز رحلة ؟
            </h1>
            <p className="text-lg text-white/90 max-w-xl mx-auto drop-shadow">
              خطوات بسيطة لتحجز مقعدك وتصل لوجهتك بأمان وراحة
            </p>
          </motion.div>
        </div>

        {/* Steps flow */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="flex flex-wrap justify-center items-center gap-2 mb-10"
        >
          {[
            { num: "١", label: "ابحث عن رحلة", icon: Search },
            { num: "٢", label: "اختر الرحلة", icon: MapPin },
            { num: "٣", label: "راجع التفاصيل", icon: Calendar },
            { num: "٤", label: "ادفع بأمان", icon: ArrowLeft },
            { num: "٥", label: "تم الحجز", icon: ArrowLeft },
          ].map((step, i) => (
            <React.Fragment key={step.num}>
              <div className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur border-2 border-white/40 flex items-center justify-center text-white font-bold text-lg shadow">
                  {step.num}
                </div>
                <span className="text-white/90 text-xs font-medium whitespace-nowrap">{step.label}</span>
              </div>
              {i < 4 && <div className="w-8 h-0.5 bg-white/40 mb-4 hidden sm:block" />}
            </React.Fragment>
          ))}
        </motion.div>

        {/* Search Box */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="max-w-4xl mx-auto"
        >
          <form onSubmit={handleSearch} className="bg-card/95 backdrop-blur-md rounded-2xl shadow-2xl border border-border p-4 md:p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="relative">
                <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                <select
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full h-12 pr-10 pl-4 rounded-xl bg-muted/50 border-0 text-sm focus:ring-2 focus:ring-primary/20 appearance-none"
                >
                  <option value="">من أين؟</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="relative">
                <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full h-12 pr-10 pl-4 rounded-xl bg-muted/50 border-0 text-sm focus:ring-2 focus:ring-primary/20 appearance-none"
                >
                  <option value="">إلى أين؟</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="relative">
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-12 pr-10 rounded-xl bg-muted/50 border-0"
                />
              </div>
              <Button type="submit" className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-base font-medium gap-2">
                <Search className="w-4 h-4" />
                ابحث عن رحلة
              </Button>
            </div>
          </form>

          {/* Quick Routes */}
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {["رام الله → نابلس", "الخليل → بيت لحم", "غزة → رام الله", "جنين → نابلس"].map((route) => (
              <button
                key={route}
                className="px-4 py-2 rounded-full bg-white/10 backdrop-blur border border-white/30 text-sm text-white hover:bg-white/20 transition-all"
              >
                {route}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}