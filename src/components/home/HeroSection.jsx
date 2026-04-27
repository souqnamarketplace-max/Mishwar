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
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-bl from-primary/5 via-background to-accent/5" />
      <div className="absolute top-0 left-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-accent/5 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-24">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
              🇵🇸 منصة فلسطينية لمشاركة الرحلات
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4 leading-tight">
              شارك الطريق،<br />
              <span className="text-primary">وفّر المال</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              احجز مقعدك بسهولة أو شارك مقاعدك الفارغة. ساهم في تخفيف الازدحام وحماية البيئة.
            </p>
          </motion.div>
        </div>

        {/* Search Box */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-4xl mx-auto"
        >
          <form onSubmit={handleSearch} className="bg-card rounded-2xl shadow-xl border border-border p-4 md:p-6">
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
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {["رام الله → نابلس", "الخليل → بيت لحم", "غزة → رام الله", "جنين → نابلس"].map((route) => (
              <button
                key={route}
                className="px-4 py-2 rounded-full bg-card border border-border text-sm text-muted-foreground hover:border-primary/30 hover:text-primary transition-all"
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