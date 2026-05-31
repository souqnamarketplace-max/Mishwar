import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Search, Star, ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import CityAutocomplete from "@/components/shared/CityAutocomplete";
import DateInput from "@/components/shared/DateInput";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const FALLBACK_GRADIENT_SVG =
  "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 800" preserveAspectRatio="xMidYMid slice">` +
      `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">` +
        `<stop offset="0%" stop-color="#1a3d2a"/>` +
        `<stop offset="100%" stop-color="#c9a227"/>` +
      `</linearGradient></defs>` +
      `<rect width="1400" height="800" fill="url(#g)"/>` +
    `</svg>`
  );

const CITY_SLIDES = [{ city: "فلسطين", subtitle: "وصّل للمكان الصح", img: FALLBACK_GRADIENT_SVG }];

export default function HeroSection() {
  const navigate = useNavigate();
  const [slideIdx, setSlideIdx] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState("");

  const { data: heroSettings } = useQuery({
    queryKey: ["hero-settings-public"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("hero_city_slides, hero_badge_text")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error || !data?.[0]) return null;
      const row = data[0];
      let slides = null;
      if (row.hero_city_slides) {
        let parsed = null;
        try { parsed = typeof row.hero_city_slides === "string" ? JSON.parse(row.hero_city_slides) : row.hero_city_slides; } catch {}
        slides = Array.isArray(parsed) ? parsed.filter(s => s && typeof s === "object" && typeof s.img === "string" && s.active !== false) : null;
      }
      return { slides, badgeText: row.hero_badge_text || null };
    },
    staleTime: 30000,
  });

  const heroSlides = heroSettings?.slides;
  const badgeText = heroSettings?.badgeText;
  const slides = heroSlides?.length ? heroSlides : CITY_SLIDES;
  const slide = slides[slideIdx % slides.length] || CITY_SLIDES[0];

  const goTo = useCallback((idx, dir) => {
    setDirection(dir);
    setSlideIdx(idx);
  }, []);

  const next = useCallback(() => goTo((slideIdx + 1) % slides.length, 1), [slideIdx, slides.length, goTo]);
  const prev = useCallback(() => goTo((slideIdx - 1 + slides.length) % slides.length, -1), [slideIdx, slides.length, goTo]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(next, 5000);
    return () => clearInterval(t);
  }, [slides.length, next]);

  const swap = () => { setFrom(to); setTo(from); };
  const handleSearch = (e) => {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (date) params.set("date", date);
    navigate(`/search?${params.toString()}`);
  };
  const today = new Date().toISOString().split("T")[0];

  // Preload the next slide image so there's no grey flash on transition.
  // Runs whenever slideIdx changes — the browser fetches and caches the
  // next image before the transition fires, so it's ready instantly.
  useEffect(() => {
    if (slides.length <= 1) return;
    const nextIdx = (slideIdx + 1) % slides.length;
    const nextSlide = slides[nextIdx];
    if (!nextSlide?.img) return;
    // Mobile size preload
    const mobileUrl = typeof nextSlide.img === "string"
      ? nextSlide.img.replace("w=1400&h=800", "w=800&h=500")
      : nextSlide.img;
    const img = new window.Image();
    img.src = mobileUrl;
    // Desktop size preload
    const desktopImg = new window.Image();
    desktopImg.src = typeof nextSlide.img === "string" ? nextSlide.img : nextSlide.img;
  }, [slideIdx, slides]);

  // Slide transition variants — Ken Burns + fade
  const variants = {
    enter: (dir) => ({ opacity: 0, scale: 1.06, x: dir > 0 ? 30 : -30 }),
    center: { opacity: 1, scale: 1, x: 0 },
    exit: (dir) => ({ opacity: 0, scale: 0.97, x: dir > 0 ? -30 : 30 }),
  };

  const searchCard = (
    <form onSubmit={handleSearch} className="bg-white/95 backdrop-blur rounded-2xl shadow-2xl p-4 border border-white/20">
      <div className="space-y-2.5">
        <div className="relative bg-gray-50 rounded-xl border border-gray-100">
          <CityAutocomplete value={from} onChange={setFrom} placeholder="من أين تنطلق؟" iconColor="primary" />
        </div>
        <div className="flex justify-center -my-0.5 relative z-10">
          <button type="button" onClick={swap}
            className="w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:border-primary hover:shadow-md active:scale-90 transition-all duration-200"
            aria-label="تبديل الوجهة">
            <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
          </button>
        </div>
        <div className="relative bg-gray-50 rounded-xl border border-gray-100">
          <CityAutocomplete value={to} onChange={setTo} placeholder="إلى أين؟" iconColor="accent" />
        </div>
        <div className="relative bg-gray-50 rounded-xl border border-gray-100">
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} min={today} className="w-full h-11 px-3" />
        </div>
        <Button type="submit" disabled={!from && !to}
          className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-bold gap-2 text-sm disabled:opacity-40 active:scale-95 transition-all shadow-lg shadow-primary/25">
          <Search className="w-4 h-4" />
          ابحث عن رحلة
        </Button>
      </div>
    </form>
  );

  // Slide indicator — clean numbered pills, not dots
  const SlideIndicators = ({ className = "" }) => {
    if (slides.length <= 1) return null;
    return (
      <div className={`flex items-center gap-1 sm:gap-2 ${className}`} dir="ltr">
        {/* Prev button */}
        <button onClick={prev}
          className="w-5 h-5 sm:w-7 sm:h-7 rounded-full bg-white/15 hover:bg-white/30 border border-white/20 flex items-center justify-center transition-all backdrop-blur-sm"
          aria-label="السابق">
          <ChevronRight className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-white" />
        </button>

        {/* Progress bars */}
        <div className="flex items-center gap-1">
          {slides.map((_, i) => (
            <button key={i} onClick={() => goTo(i, i > slideIdx ? 1 : -1)}
              className={`relative h-0.5 rounded-full overflow-hidden transition-all duration-300 ${
                i === slideIdx
                  ? "w-[18px] sm:w-[28px]"
                  : "w-[8px] sm:w-[14px]"
              }`}
              aria-label={`الشريحة ${i + 1}`}>
              <div className="absolute inset-0 bg-white/30 rounded-full" />
              {i === slideIdx && (
                <motion.div
                  className="absolute inset-y-0 left-0 bg-accent rounded-full"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 5, ease: "linear" }}
                  key={slideIdx}
                />
              )}
            </button>
          ))}
        </div>

        {/* Next button */}
        <button onClick={next}
          className="w-5 h-5 sm:w-7 sm:h-7 rounded-full bg-white/15 hover:bg-white/30 border border-white/20 flex items-center justify-center transition-all backdrop-blur-sm"
          aria-label="التالي">
          <ChevronLeft className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-white" />
        </button>

        {/* Slide counter */}
        <span className="text-white/50 text-[9px] sm:text-[10px] font-mono mr-0.5 sm:mr-1">
          {String(slideIdx + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
        </span>
      </div>
    );
  };

  return (
    <>
      {/* ── MOBILE ── */}
      <section className="sm:hidden flex flex-col">
        <div className="relative h-52 overflow-hidden bg-primary/80">
          <AnimatePresence initial={false} custom={direction} mode="sync">
            <motion.img
              key={slideIdx}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
              src={typeof slide.img === "string" ? slide.img.replace("w=1400&h=800", "w=800&h=500") : ""}
              alt={slide.city || ""}
              fetchpriority="high"
              loading="eager"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          </AnimatePresence>

          {/* Gradient overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/20 to-transparent" />

          <div className="absolute inset-0 flex flex-col items-center justify-end pb-5 px-4">
            {badgeText && (
              <div className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm border border-white/20 rounded-full px-3 py-1 mb-2">
                <Star className="w-3 h-3 text-accent fill-accent" />
                <span className="text-white text-[11px] font-medium">{badgeText}</span>
              </div>
            )}
            <h1 className="text-xl font-black text-white text-center leading-tight mb-3">
              وصّل للمكان الصح <span className="text-accent">بنص السعر</span>
            </h1>
            <SlideIndicators />
          </div>
        </div>

        {/* Search card */}
        <div className="px-4 -mt-5 relative z-10 pb-3">
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
              onClick={() => navigate(`/search?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`)
              }
              className="px-3 py-1 rounded-full bg-muted border border-border text-xs text-foreground hover:bg-primary/10 hover:border-primary/30 transition-all">
              {r.from} ← {r.to}
            </button>
          ))}
        </div>
      </section>

      {/* ── DESKTOP ── */}
      <section className="hidden sm:block relative overflow-hidden" style={{ minHeight: "580px" }}>
        {/* Background slideshow with AnimatePresence */}
        <div className="absolute inset-0 bg-primary/80">
          <AnimatePresence initial={false} custom={direction} mode="sync">
            <motion.img
              key={slideIdx}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.75, ease: [0.25, 0.46, 0.45, 0.94] }}
              src={typeof slide.img === "string" ? slide.img.replace("w=1400&h=800", "w=1400&h=800") : ""}
              alt={slide.city || ""}
              fetchpriority="high"
              loading="eager"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          </AnimatePresence>

          {/* Rich gradient overlays */}
          <div className="absolute inset-0 bg-gradient-to-l from-black/90 via-black/50 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

          {/* Slide indicators — bottom left, clean */}
          <div className="absolute bottom-6 left-8">
            <SlideIndicators />
          </div>

          {/* City label — bottom right */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`city-${slideIdx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4 }}
              className="absolute bottom-6 right-8 text-right"
            >
              {slide.city && slide.city !== "فلسطين" && (
                <p className="text-white/40 text-xs tracking-widest uppercase font-mono">
                  {slide.city}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Content */}
        <div className="relative w-full max-w-7xl mx-auto px-6 sm:px-12 flex items-center" style={{ minHeight: "580px" }}>
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mr-auto ml-0 w-full max-w-md text-right py-14"
          >
            {badgeText && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="inline-flex items-center gap-2 bg-white/12 backdrop-blur-md border border-white/20 rounded-full px-4 py-1.5 mb-5"
              >
                <Star className="w-3.5 h-3.5 text-accent fill-accent" />
                <span className="text-white text-xs font-medium">{badgeText}</span>
              </motion.div>
            )}

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-4xl sm:text-5xl font-black text-white leading-[1.15] mb-3"
            >
              وصّل للمكان الصح
              <br />
              <span className="text-accent">بنص السعر</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-white/70 text-sm mb-6 leading-relaxed"
            >
              شارك رحلتك مع جاري الطريق — توفّر، تعرّف على ناس جديدة، وصل بأمان.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mb-4">
              {searchCard}
            </motion.div>

            {/* Quick routes */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
              className="flex flex-wrap gap-2 justify-end mb-6"
            >
              <span className="text-white/40 text-xs self-center">جرب:</span>
              {[
                { from: "رام الله", to: "نابلس" },
                { from: "الخليل", to: "بيت لحم" },
                { from: "نابلس", to: "جنين" },
              ].map((r) => (
                <button key={`${r.from}-${r.to}`}
                  onClick={() => navigate(`/search?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`)
                  }
                  className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15 text-xs text-white/80 hover:bg-white/20 hover:text-white hover:border-white/30 transition-all">
                  {r.from} ← {r.to}
                </button>
              ))}
            </motion.div>

            {/* Social proof */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center gap-3 justify-end"
            >
              <div className="text-right">
                <div className="flex items-center gap-0.5 justify-end mb-0.5">
                  {[1,2,3,4,5].map(s => <Star key={s} className="w-3 h-3 text-accent fill-accent" />)}
                </div>
                <span className="text-white/50 text-[11px]">تقييم ممتاز من المسافرين</span>
              </div>
              <div className="flex -space-x-2 rtl:space-x-reverse">
                {[
                  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&crop=face",
                  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=40&h=40&fit=crop&crop=face",
                  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=40&h=40&fit=crop&crop=face",
                  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=40&h=40&fit=crop&crop=face",
                ].map((src, i) => (
                  <img loading="lazy" key={i} src={src} alt="" className="w-8 h-8 rounded-full border-2 border-white/30 object-cover" />
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>
    </>
  );
}
