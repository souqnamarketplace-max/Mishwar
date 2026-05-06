import React, { useState, useEffect } from "react";
import { Shield, Users, RotateCcw, Headphones, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const badges = [
  { emoji: "🛡️", title: "سائقون موثوقون", desc: "نتحقق من الهوية والرخصة والتأمين قبل انضمام أي سائق", color: "bg-primary/8 border-primary/20" },
  { emoji: "💸", title: "إلغاء مجاني", desc: "ألغِ حجزك بكل سهولة حتى ساعتين قبل الرحلة", color: "bg-accent/8 border-accent/20" },
  { emoji: "💬", title: "تواصل مباشر", desc: "تواصل مع السائق مباشرة عبر نظام الرسائل الداخلي في أي وقت", color: "bg-green-500/8 border-green-500/20" },
  { emoji: "⚡", title: "حجز فوري", desc: "من البحث للتأكيد خلال أقل من دقيقتين", color: "bg-yellow-500/8 border-yellow-500/20" },
];

// Testimonials are now fetched from public.testimonials. The previous
// hardcoded array contained fabricated quotes with specific savings
// claims ("I saved ₪200 last month") — that was a misleading-marketing
// risk for App Store / Play Store review and dishonest to users.
// When the table is empty (initial state) the testimonials block hides
// entirely and only the trust badges render.

export default function TrustBadges() {
  const [activeTestimonial, setActiveTestimonial] = useState(0);

  const { data: rawTestimonials = [] } = useQuery({
    queryKey: ["testimonials-published"],
    queryFn: () => base44.entities.Testimonial.filter({ is_published: true }, "sort_order", 20),
    staleTime: 5 * 60 * 1000,
  });

  // Normalize DB rows to the shape the renderer expects.
  const testimonials = rawTestimonials.map(r => ({
    name:   r.display_name || "",
    city:   r.city || "",
    role:   r.role === "driver" ? "سائق" : r.role === "passenger" ? "راكب/ة" : "",
    avatar: r.avatar_letter || (r.display_name?.[0] || ""),
    text:   r.text || "",
    rating: Math.max(1, Math.min(5, Number(r.rating) || 5)),
    route:  r.route || "",
  }));

  // Auto-rotate only if there are 2+ testimonials
  useEffect(() => {
    if (testimonials.length < 2) return;
    const timer = setInterval(() => {
      setActiveTestimonial(i => (i + 1) % testimonials.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [testimonials.length]);

  const t = testimonials[activeTestimonial] || null;

  return (
    <section className="py-14 sm:py-20 bg-muted/20 border-t border-border overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">

        {/* Trust badges — 2x2 on mobile, 4x1 on desktop */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-16"
        >
          {badges.map((b, i) => (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, type: "spring", stiffness: 120 }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className={`flex flex-col items-center text-center p-5 rounded-2xl bg-card border ${b.color} hover:shadow-lg transition-all cursor-default`}
            >
              <span className="text-3xl mb-3">{b.emoji}</span>
              <p className="font-bold text-sm text-foreground mb-1">{b.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{b.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Testimonials section — only renders when admin has populated
            the testimonials table. Empty state = section hidden so we
            never show fake quotes. */}
        {t && (
          <>
            <div className="text-center mb-8">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <h2 className="text-2xl sm:text-3xl font-black text-foreground mb-2">
                  ماذا يقول مسافرونا؟ 🗣️
                </h2>
              </motion.div>
            </div>

            {/* Testimonial carousel */}
        <div className="max-w-2xl mx-auto">
          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTestimonial}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.35, ease: "easeInOut" }}
                className="bg-card rounded-3xl border border-border p-6 sm:p-8 shadow-lg"
              >
                {/* Stars */}
                <div className="flex items-center gap-1 mb-4">
                  {[...Array(t.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  ))}
                  <span className="text-xs text-muted-foreground mr-2">{t.route}</span>
                </div>

                {/* Quote */}
                <p className="text-base sm:text-lg text-foreground leading-relaxed mb-6 font-medium">
                  "{t.text}"
                </p>

                {/* Author */}
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center font-black text-primary text-lg">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="font-bold text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role} • {t.city}</p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-5">
              <button
                onClick={() => setActiveTestimonial(i => (i - 1 + testimonials.length) % testimonials.length)}
                className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              {/* Dots */}
              <div className="flex gap-2">
                {testimonials.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveTestimonial(i)}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      i === activeTestimonial ? "bg-primary w-6" : "bg-muted w-2"
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={() => setActiveTestimonial(i => (i + 1) % testimonials.length)}
                className="w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </section>
  );
}
