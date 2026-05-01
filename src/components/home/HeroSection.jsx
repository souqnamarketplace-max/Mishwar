import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Search, Star, Calendar, ArrowLeftRight } from "lucide-react";
import { motion } from "framer-motion";
import CityAutocomplete from "@/components/shared/CityAutocomplete";

// Palestinian cities slideshow — real Unsplash photos
const CITY_SLIDES = [
  {
    city: "القدس",
    subtitle: "المدينة المقدسة",
    img: "https://images.unsplash.com/photo-1552423314-cf29ab68ad73?w=1400&h=800&fit=crop&q=80",
  },
  {
    city: "بيت لحم",
    subtitle: "مهد المسيح",
    img: "https://images.unsplash.com/photo-1549900932-5f7a1f04e17f?w=1400&h=800&fit=crop&q=80",
  },
  {
    city: "نابلس",
    subtitle: "جبل النار",
    img: "https://images.unsplash.com/photo-1578895101408-1a36b834405b?w=1400&h=800&fit=crop&q=80",
  },
  {
    city: "أريحا",
    subtitle: "أقدم مدينة في العالم",
    img: "https://images.unsplash.com/photo-1518684079-3c830dcef090?w=1400&h=800&fit=crop&q=80",
  },
  {
    city: "الخليل",
    subtitle: "مدينة الآباء",
    img: "https://images.unsplash.com/photo-1580834341580-8c17a3a630ca?w=1400&h=800&fit=crop&q=80",
  },
  {
    city: "غزة",
    subtitle: "عروس البحر",
    img: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1400&h=800&fit=crop&q=80",
  },
];

export default function HeroSection() {
  const navigate = useNavigate();
  const [slideIdx, setSlideIdx] = useState(0);

  // Load slides from admin settings (fallback to hardcoded)
  const { data: slideSetting } = useQuery({
    queryKey: ["hero-slides"],
    queryFn: async () => {
      const results = await base44.entities.AppSettings.filter({ key: "hero_city_slides" }, "-created_at", 1);
      return results?.[0] || null;
    },
    staleTime: 60000,
  });

  const slides = (() => {
    try {
      const parsed = JSON.parse(slideSetting?.value || "null");
      if (parsed?.length) return parsed.filter(s => s.active !== false);
    } catch {}
    return CITY_SLIDES;
  })();

  const slide = slides[slideIdx % slides.length] || CITY_SLIDES[0];

  // Auto-advance every 4 seconds
  useEffect(() => {
    const t = setInterval(() => setSlideIdx(i => (i + 1) % CITY_SLIDES.length), 4000);
    return () => clearInterval(t);
  }, []);

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
          {/* Slideshow - only load current + next image */}
          {CITY_SLIDES.map((s, i) => {
            const isCurrent = i === slideIdx;
            const isNext = i === (slideIdx + 1) % CITY_SLIDES.length;
            if (!isCurrent && !isNext) return null;
            return (
              <img key={s.city}
                src={s.img.replace('w=1400&h=800', 'w=800&h=500')}
                alt={s.city}
                className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${isCurrent ? "opacity-100" : "opacity-0"}`} />
            );
          })}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/20" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/25 rounded-full px-3 py-1 mb-2">
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
              <span className="text-white text-xs">+10,000 مستخدم يثقون بنا 🇵🇸</span>
            </div>
            <h1 className="text-2xl font-black text-white leading-tight">
              وصّل للمكان الصح <span className="text-accent">بنص السعر</span>
            </h1>
            {/* City label */}
            <div className="mt-2 flex items-center gap-1.5 bg-black/30 backdrop-blur-sm rounded-full px-3 py-1">
              <span className="text-white/90 text-xs font-bold">{slide.city}</span>
              <span className="text-white/50 text-[10px]">— {slide.subtitle}</span>
            </div>
            {/* Dot indicators */}
            <div className="flex gap-1.5 mt-2">
              {CITY_SLIDES.map((_, i) => (
                <button key={i} onClick={() => setSlideIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${i === slideIdx ? "w-4 bg-accent" : "w-1.5 bg-white/40"}`} />
              ))}
            </div>
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
          {CITY_SLIDES.map((s, i) => {
            const isCurrent = i === slideIdx;
            const isNext = i === (slideIdx + 1) % CITY_SLIDES.length;
            if (!isCurrent && !isNext) return null;
            return (
              <img key={s.city}
                src={s.img.replace('w=1400&h=800', 'w=1200&h=700')}
                alt={s.city}
                className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${isCurrent ? "opacity-100" : "opacity-0"}`} />
            );
          })}
          <div className="absolute inset-0 bg-gradient-to-l from-black/85 via-black/55 to-black/15" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          {/* City label bottom-left */}
          <div className="absolute bottom-6 left-6 flex flex-col gap-1">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-full px-4 py-1.5">
              <span className="text-white font-black text-sm">{slide.city}</span>
              <span className="text-white/60 text-xs">{slide.subtitle}</span>
            </div>
            <div className="flex gap-1.5 mr-2">
              {CITY_SLIDES.map((_, i) => (
                <button key={i} onClick={() => setSlideIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${i === slideIdx ? "w-5 bg-accent" : "w-1.5 bg-white/40"}`} />
              ))}
            </div>
          </div>
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
