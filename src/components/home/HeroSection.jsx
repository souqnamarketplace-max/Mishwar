import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Search, MapPin, Star } from "lucide-react";
import { motion } from "framer-motion";

const CITIES = ["رام الله", "نابلس", "الخليل", "بيت لحم", "غزة", "جنين", "طولكرم", "قلقيلية"];

export default function HeroSection() {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const handleSearch = (e) => {
    e.preventDefault();
    navigate(`/search?from=${from}&to=${to}`);
  };

  return (
    <section className="relative overflow-hidden" style={{ minHeight: "500px" }}>
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src="https://media.base44.com/images/public/69eff402dbb517e4d7d3c1cf/5dc1160bb_generated_image.png"
          alt=""
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-l from-black/80 via-black/45 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      </div>

      {/* Content */}
      <div className="relative w-full max-w-7xl mx-auto px-6 sm:px-10 flex items-center" style={{ minHeight: "500px" }}>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55 }}
          className="mr-auto ml-0 w-full max-w-lg text-right py-14"
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/25 rounded-full px-4 py-1.5 mb-5">
            <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
            <span className="text-white text-xs font-medium">+10,000 مستخدم يثقون بنا يومياً</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight mb-3">
            وصّل للمكان الصح<br />
            <span className="text-accent">بنص السعر</span>
          </h1>

          <p className="text-white/75 text-base mb-7 leading-relaxed">
            شارك رحلتك مع جاري الطريق — توفّر، تعرّف على ناس جديدة، وصل بأمان.
          </p>

          {/* Search Bar */}
          <form onSubmit={handleSearch} className="mb-5">
            <div className="bg-white rounded-2xl shadow-2xl p-1.5 flex flex-col sm:flex-row gap-1">
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
              <Button
                type="submit"
                className="h-12 px-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-bold gap-2 shrink-0 text-sm"
              >
                <Search className="w-4 h-4" />
                ابحث عن رحلة
              </Button>
            </div>
          </form>

          {/* Quick routes */}
          <div className="flex flex-wrap gap-2 justify-end mb-7">
            {[
              { label: "رام الله ← نابلس", from: "رام الله", to: "نابلس" },
              { label: "الخليل ← بيت لحم", from: "الخليل", to: "بيت لحم" },
              { label: "غزة ← رام الله", from: "غزة", to: "رام الله" },
            ].map((r) => (
              <button
                key={r.label}
                onClick={() => navigate(`/search?from=${r.from}&to=${r.to}`)}
                className="px-3 py-1 rounded-full bg-white/10 backdrop-blur border border-white/25 text-xs text-white hover:bg-white/20 transition-all"
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Social proof avatars */}
          <div className="flex items-center gap-3 justify-end">
            <div className="text-right">
              <div className="flex items-center gap-1 justify-end">
                {[1,2,3,4,5].map(s => <Star key={s} className="w-3 h-3 text-yellow-400 fill-yellow-400" />)}
              </div>
              <span className="text-white/70 text-xs">تقييم ممتاز من آلاف المسافرين</span>
            </div>
            <div className="flex -space-x-2 rtl:space-x-reverse">
              {[
                "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=40&h=40&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=40&h=40&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=40&h=40&fit=crop&crop=face",
              ].map((src, i) => (
                <img key={i} src={src} alt="" className="w-9 h-9 rounded-full border-2 border-white object-cover" />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}