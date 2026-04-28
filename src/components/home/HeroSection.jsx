import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, MapPin, Calendar } from "lucide-react";
import { motion } from "framer-motion";

const CITIES = ["رام الله", "نابلس", "الخليل", "بيت لحم", "غزة", "جنين", "طولكرم", "قلقيلية"];

const steps = [
  { num: "١", label: "ابحث عن رحلة" },
  { num: "٢", label: "اختر الرحلة" },
  { num: "٣", label: "راجع التفاصيل" },
  { num: "٤", label: "ادفع بأمان" },
  { num: "٥", label: "تم الحجز" },
];

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
    <section className="relative overflow-hidden min-h-[520px] flex items-center">
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&fit=crop&q=80"
          alt=""
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-primary/70" />
      </div>

      <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-24">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
            كيف تحجز رحلة ؟
          </h1>
          <p className="text-white/85 text-base md:text-lg">
            خطوات بسيطة لتحجز مقعدك وتصل لوجهتك بأمان وراحة
          </p>
        </motion.div>

        {/* Steps */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="flex justify-center items-center gap-0 mb-10 flex-wrap"
        >
          {steps.map((step, i) => (
            <React.Fragment key={step.num}>
              <div className="flex flex-col items-center gap-2 px-2">
                <div className="w-11 h-11 rounded-full border-2 border-white/60 bg-white/15 backdrop-blur-sm flex items-center justify-center text-white font-bold text-base">
                  {step.num}
                </div>
                <span className="text-white text-xs font-medium text-center whitespace-nowrap">{step.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className="w-10 sm:w-14 h-px bg-white/40 mb-5 hidden sm:block" />
              )}
            </React.Fragment>
          ))}
        </motion.div>

        {/* Search Box */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="max-w-3xl mx-auto"
        >
          <form onSubmit={handleSearch}>
            <div className="bg-white rounded-2xl shadow-2xl p-1.5 flex flex-col sm:flex-row gap-1">
              {/* From */}
              <div className="relative flex-1">
                <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" />
                <select
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full h-12 pr-10 pl-3 bg-transparent border-0 text-sm text-foreground focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="">من أين؟</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="w-px bg-border hidden sm:block self-stretch my-2" />

              {/* To */}
              <div className="relative flex-1">
                <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent pointer-events-none" />
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full h-12 pr-10 pl-3 bg-transparent border-0 text-sm text-foreground focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="">إلى أين؟</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="w-px bg-border hidden sm:block self-stretch my-2" />

              {/* Date */}
              <div className="relative flex-1">
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-12 pr-10 pl-3 bg-transparent border-0 text-sm text-foreground focus:outline-none"
                />
              </div>

              {/* Search Button */}
              <Button
                type="submit"
                className="h-12 px-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium gap-2 shrink-0"
              >
                <Search className="w-4 h-4" />
                ابحث عن رحلة
              </Button>
            </div>
          </form>

          {/* Quick Routes */}
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {["رام الله ← نابلس", "الخليل ← بيت لحم", "غزة ← رام الله", "جنين ← نابلس"].map((route) => (
              <button
                key={route}
                className="px-4 py-1.5 rounded-full bg-white/15 backdrop-blur border border-white/30 text-sm text-white hover:bg-white/25 transition-all"
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