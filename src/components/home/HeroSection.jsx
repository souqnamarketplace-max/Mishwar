import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Search, Star, ArrowLeftRight } from "lucide-react";
import { motion } from "framer-motion";
import CityAutocomplete from "@/components/shared/CityAutocomplete";
import DateInput from "@/components/shared/DateInput";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Last-resort fallback used ONLY when the admin has not configured
// any hero_city_slides AND the DB query fails. In production the
// admin DOES populate hero_city_slides (verified live — the
// Palestinian-flag/sunset image you see on the home page comes from
// Supabase, not from this fallback). Previously this array contained
// six Unsplash URLs (Jerusalem/Bethlehem/Nablus/Jericho/Hebron/Gaza)
// which were orphaned the moment admin slides went live — they sat
// here being defensively kept but were never user-visible. They also
// added an external network dep (images.unsplash.com) that the page
// could fall back into on DB outages, an additional thing to break.
//
// Replaced with a single inline SVG data-URI fallback: a brand-color
// gradient rendered entirely from the bundled HTML, no network call.
// Forms a clean visual placeholder if anything goes catastrophically
// wrong with admin slides AND DB AND react-query.
//
// The data URI uses brand forest-green #1a3d2a → gold #c9a227 so the
// hero still looks like Mishwaro's identity even without a photo.
// Caption defaults to "فلسطين" / "وصّل للمكان الصح" as a safe
// universal label (no city-specific claim a passenger would notice
// is wrong).
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

const CITY_SLIDES = [
  {
    city: "فلسطين",
    subtitle: "وصّل للمكان الصح",
    img: FALLBACK_GRADIENT_SVG,
  },
];

export default function HeroSection() {
  const navigate = useNavigate();
  const [slideIdx, setSlideIdx] = useState(0);

  // Load slides directly from Supabase (bypasses api created_by filter).
  //
  // app_settings has historically accumulated multiple rows (no UNIQUE constraint
  // on the table — it's effectively a singleton-by-convention, not by schema).
  // Without an explicit ORDER, Postgres can return any of them, so admins would
  // upload a new image and the home page would silently keep showing the old
  // one because the read landed on a stale row. Order by updated_at DESC so we
  // deterministically pick the most recently saved settings — matching the
  // admin page's read pattern.
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
        const raw = row.hero_city_slides;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        slides = Array.isArray(parsed) ? parsed.filter(s => s.active !== false) : null;
      }
      return { slides, badgeText: row.hero_badge_text || null };
    },
    staleTime: 30000,
  });

  const heroSlides = heroSettings?.slides;
  // Badge text is admin-editable. If unset, the badge does not render at
  // all (we used to hardcode "+10,000 مستخدم" — that was a false claim).
  const badgeText = heroSettings?.badgeText;

  const slides = heroSlides?.length ? heroSlides : CITY_SLIDES;

  const slide = slides[slideIdx % slides.length] || CITY_SLIDES[0];

  // Auto-advance every 4 seconds. Cycle length must come from the live
  // `slides` array, not the hardcoded CITY_SLIDES fallback — otherwise an
  // admin who uploads, say, 8 slides would only see indices 0-5 cycle through
  // (because CITY_SLIDES has 6) and slides 6, 7 would never display. Conversely
  // an admin who keeps only 3 active slides would see ghost indices 3-5 hit
  // the modulus fallback at runtime. Using slides.length keeps it correct.
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setSlideIdx(i => (i + 1) % slides.length), 4000);
    return () => clearInterval(t);
  }, [slides.length]);

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
          {/* DateInput renders an Arabic placeholder ("اختر التاريخ") and the
              picked date in Arabic-formatted Gregorian. The native picker is
              hidden behind it, so the literal yyyy-mm-dd text browsers leak
              before selection never appears. Previously this was a raw
              <input type="date">, which on iOS Safari and most Android
              browsers shows the placeholder format text — looks like a
              dev artifact on first impression. The padding is on DateInput
              itself rather than the wrapper so the entire pill (not just
              the text) is a click target for the picker. */}
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} min={today} className="w-full h-12 px-3" />
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
          {/* Slideshow - only load current + next image.
              Iterates `slides` (the live admin-uploaded list, falling back to
              CITY_SLIDES only when nothing loads), NOT CITY_SLIDES. The
              previous code rendered the hardcoded fallback unconditionally —
              the caption would update from `slide.city` but the actual <img>
              tags always showed Jerusalem/Bethlehem/Nablus from the bundled
              defaults, so admin uploads never surfaced on the home page. */}
          {slides.map((s, i) => {
            const isCurrent = i === slideIdx;
            const isNext = i === (slideIdx + 1) % slides.length;
            if (!isCurrent && !isNext) return null;
            // The current slide is the page's LCP element. Hint the
            // browser to prioritize it (fetchpriority=high) and disable
            // lazy loading. The next-up slide is opportunistic — let
            // the browser load it after critical work is done.
            return (
              <img key={(s.img || s.city) + i}
                src={s.img.replace('w=1400&h=800', 'w=800&h=500')}
                alt={s.city}
                fetchpriority={isCurrent ? "high" : "low"}
                loading={isCurrent ? "eager" : "lazy"}
                decoding="async"
                className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${isCurrent ? "opacity-100" : "opacity-0"}`} />
            );
          })}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/20" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            {badgeText && (
              <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/25 rounded-full px-3 py-1 mb-2">
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                <span className="text-white text-xs">{badgeText}</span>
              </div>
            )}
            <h1 className="text-2xl font-black text-white leading-tight">
              وصّل للمكان الصح <span className="text-accent">بنص السعر</span>
            </h1>
            {/* Dot indicators — count must match the rendered slideshow above.
                Hidden when there's only one slide because a single dot
                visually reads as a stray accent mark below the headline
                (audit kept reporting it as a misplaced "ب" character).
                The component is interactive — multiple dots are pagination,
                a single dot is just visual noise. */}
            {slides.length > 1 && (
              <div className="flex gap-1.5 mt-3">
                {slides.map((_, i) => (
                  <button key={i} onClick={() => setSlideIdx(i)}
                    className={`h-1.5 rounded-full transition-all ${i === slideIdx ? "w-4 bg-accent" : "w-1.5 bg-white/40"}`} />
                ))}
              </div>
            )}
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
          {/* Same fix as mobile: iterate the live `slides` array so admin uploads
              actually appear here. Without this the desktop hero stays stuck on
              the bundled defaults. */}
          {slides.map((s, i) => {
            const isCurrent = i === slideIdx;
            const isNext = i === (slideIdx + 1) % slides.length;
            if (!isCurrent && !isNext) return null;
            // Same LCP treatment as the mobile hero above
            return (
              <img key={(s.img || s.city) + i}
                src={s.img.replace('w=1400&h=800', 'w=1200&h=700')}
                alt={s.city}
                fetchpriority={isCurrent ? "high" : "low"}
                loading={isCurrent ? "eager" : "lazy"}
                decoding="async"
                className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${isCurrent ? "opacity-100" : "opacity-0"}`} />
            );
          })}
          <div className="absolute inset-0 bg-gradient-to-l from-black/85 via-black/55 to-black/15" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          {/* Slide dot indicators — single dot reads as visual noise, hide it.
              Same rationale as the mobile hero above. */}
          {slides.length > 1 && (
            <div className="absolute bottom-6 left-6 flex gap-1.5">
              {slides.map((_, i) => (
                <button key={i} onClick={() => setSlideIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${i === slideIdx ? "w-5 bg-accent" : "w-1.5 bg-white/40"}`} />
              ))}
            </div>
          )}
        </div>
        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-10 flex items-center" style={{ minHeight: "560px" }}>
          <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.55 }}
            className="mr-auto ml-0 w-full max-w-xl text-right py-12">
            {badgeText && (
              <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/25 rounded-full px-4 py-1.5 mb-5">
                <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                <span className="text-white text-xs font-medium">{badgeText}</span>
              </div>
            )}
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
