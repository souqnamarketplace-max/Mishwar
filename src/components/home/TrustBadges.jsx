import React from "react";
import { Shield, Users, RotateCcw, Headphones, Star } from "lucide-react";
import { motion } from "framer-motion";

const badges = [
  { icon: Shield, title: "دفع آمن 100%", desc: "بياناتك ومعاملاتك المالية محمية بتشفير كامل", color: "bg-blue-500/10 text-blue-600" },
  { icon: Users, title: "سائقون موثوقون", desc: "نتحقق من الهوية والوثائق والتقييمات قبل الانضمام", color: "bg-primary/10 text-primary" },
  { icon: RotateCcw, title: "إلغاء مجاني", desc: "ألغِ حجزك بسهولة قبل موعد الرحلة بساعتين", color: "bg-accent/10 text-accent" },
  { icon: Headphones, title: "دعم 24 ساعة", desc: "فريقنا متوفر دائماً للمساعدة في أي وقت", color: "bg-yellow-500/10 text-yellow-600" },
];

const testimonials = [
  { name: "سارة ع.", city: "رام الله", text: "وفرت أكثر من ₪200 الشهر الماضي! الخدمة رائعة والسائقون محترمون جداً.", rating: 5 },
  { name: "محمود ك.", city: "نابلس", text: "أسافر كل أسبوع ومع سيرتنا صار الأمر أسهل وأرخص بكثير.", rating: 5 },
  { name: "رنا م.", city: "الخليل", text: "تطبيق سهل وعملي، الحجز يأخذ دقيقة وتقييمات السائقين تبني الثقة.", rating: 5 },
];

export default function TrustBadges() {
  return (
    <section className="py-14 bg-muted/20 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Trust badges */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-14">
          {badges.map((b, i) => (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="flex flex-col items-center text-center p-5 rounded-2xl bg-card border border-border hover:shadow-md hover:border-primary/20 transition-all"
            >
              <div className={`w-12 h-12 rounded-2xl ${b.color} flex items-center justify-center mb-3`}>
                <b.icon className="w-6 h-6" />
              </div>
              <p className="font-bold text-sm text-foreground mb-1">{b.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{b.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-1">ماذا يقول مسافرونا؟</h2>
          <p className="text-muted-foreground text-sm">آلاف الرحلات الناجحة كل شهر</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-card rounded-2xl border border-border p-5 hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-1 mb-3">
                {[...Array(t.rating)].map((_, j) => (
                  <Star key={j} className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                ))}
              </div>
              <p className="text-sm text-foreground leading-relaxed mb-4">"{t.text}"</p>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                  {t.name[0]}
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.city}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}