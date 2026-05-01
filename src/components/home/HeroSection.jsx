import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Search, Star, Calendar, ArrowLeftRight } from "lucide-react";
import { motion } from "framer-motion";
import CityAutocomplete from "@/components/shared/CityAutocomplete";

export default function HeroSection() {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState("");

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const handleSearch = (e) => {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (date) params.set("date", date);
    navigate(`/search?${params.toString()}`);
  };

  const today = new Date().toISOString().split("T")[0];

  const searchCard = (
    <form onSubmit={handleSearch} className="bg-white rounded-2xl shadow-2xl p-3">
      <div className="space-y-2">
        <div className="relative bg-muted/30 rounded-xl">
          <CityAutocomplete value={from} onChange={setFrom} placeholder="من أين تنطلق؟" iconColor="primary" />
        </div>
        <div className="flex justify-center -my-1 relative z-10">
          <button type="button" onClick={swap}
            className="w-9 h-9 rounded-full bg-white border-2 border-border shadow-md flex items-center justify-center hover:rotate-180 hover:border-primary transition-all duration-300"
            aria-label="تبديل الوجهة">
            <ArrowLeftRight className="w-4 h-4 text-primary" />
          </button>
        </div>
        <div className="relative bg-muted/30 rounded-xl">
          <CityAutocomplete value={to} onChange={setTo} placeholder="إلى أين؟" iconColor="accent" />
        </div>
        <div className="relative bg-muted/30 rounded-xl">
          <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)}
            className="w-full h-12 pr-10 pl-3 rounded-xl bg-transparent border-0 text-sm text-foreground focus:outline-none cursor-pointer" />
        </div>
        <Button type="submit" disabled={!from && !to}
          className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-bold gap-2 text-sm disabled:opacity-50 active:scale-95 transition-all">
          <Search className="w-4 h-4" />
          ابحث عن رحلة
        </Button>
      </div>
    </form>
  );

  return (
    <>
      {/* ── MOBILE LAYOUT ── */}
      <section className="sm:hidden flex flex-col">
        {/* Compact hero banner */}
        <div className="relative h-48 overflow-hidden">
          <img loading="lazy"
            src="https://images.unsplash.com/photo-1580834341580-8c17a3a630ca?w=1400&h=800&fit=crop&q=80"
            alt="" className="w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/25 rounded-full px-3 py-1 mb-2">
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
              <span className="text-white text-xs">+10,000 مستخدم يثقون بنا 🇵🇸</span>
            </div>
            <h1 className="text-2xl font-black text-white leading-tight">
              وصّل للمكان الصح <span className="text-accent">بنص السعر</span>
            </h1>
          </div>
        </div>

        {/* Search card — full width, front & center */}
        <div className="px-4 -mt-6 relative z-10 pb-4">
          {searchCard}
        </div>

        {/* Quick routes */}
        <div className="flex flex-wrap gap-2 justify-center px-4 pb-4">
          <span className="text-muted-foreground text-xs self-center">جرب:</span>
          {[
            { from: "رام الله", to: "نابلس" },
            { from: "الخليل", to: "بيت لحم" },
            { from: "نابلس", to: "جنين" },
          ].map((r) => (
            <button key={`${r.from}-${r.to}`}
              onClick={() => navigate(`/search?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`)}
              className="px-3 py-1 rounded-full bg-muted border border-border text-xs text-foreground hover:bg-primary/10 transition-all">
              {r.from} ← {r.to}
            </button>
          ))}
        </div>
      </section>

      {/* ── DESKTOP LAYOUT ── */}
      <section className="hidden sm:block relative overflow-hidden" style={{ minHeight: "560px" }}>
        <div className="absolute inset-0">
          <img loading="lazy"
            src="https://images.unsplash.com/photo-1580834341580-8c17a3a630ca?w=1400&h=800&fit=crop&q=80"
            alt="" className="w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-l from-black/85 via-black/55 to-black/15" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        </div>
        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-10 flex items-center" style={{ minHeight: "560px" }}>
          <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.55 }}
            className="mr-auto ml-0 w-full max-w-xl text-right py-12">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/25 rounded-full px-4 py-1.5 mb-5">
              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
              <span className="text-white text-xs font-medium">+10,000 مستخدم يثقون بنا يومياً 🇵🇸</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight mb-3">
              وصّل للمكان الصح<br />
              <span className="text-accent">بنص السعر</span>
            </h1>
            <p className="text-white/80 text-base mb-7 leading-relaxed">
              شارك رحلتك مع جاري الطريق — توفّر، تعرّف على ناس جديدة، وصل بأمان.
            </p>
            <div className="mb-5">{searchCard}</div>
            <div className="flex flex-wrap gap-2 justify-end mb-7">
              <span className="text-white/60 text-xs ml-1 self-center">جرب:</span>
              {[
                { from: "رام الله", to: "نابلس" },
                { from: "الخليل", to: "بيت لحم" },
                { from: "نابلس", to: "جنين" },
              ].map((r) => (
                <button key={`${r.from}-${r.to}`}
                  onClick={() => navigate(`/search?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`)}
                  className="px-3 py-1 rounded-full bg-white/10 backdrop-blur border border-white/25 text-xs text-white hover:bg-white/20 transition-all">
                  {r.from} ← {r.to}
                </button>
              ))}
            </div>
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
                  <img loading="lazy" key={i} src={src} alt="" className="w-9 h-9 rounded-full border-2 border-white object-cover" />
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </>
  );
}
