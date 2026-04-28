import React, { useState } from "react";
import { motion } from "framer-motion";
import { Search, MousePointer, Shield, Car, Users, DollarSign } from "lucide-react";

const passengerSteps = [
  { icon: Search, title: "ابحث في ثوانٍ", desc: "أدخل وجهتك وتاريخ السفر — سيرتنا تجد لك أفضل رحلة بأقل سعر", color: "bg-blue-500/10 text-blue-600" },
  { icon: MousePointer, title: "اختر واحجز", desc: "شاهد تفاصيل السائق وتقييماته، واحجز مقعدك بضغطة واحدة", color: "bg-primary/10 text-primary" },
  { icon: Shield, title: "سافر بأمان", desc: "سائق موثق، رحلة مؤمنة، ووصول مريح — كل مرة وبكل رحلة", color: "bg-accent/10 text-accent" },
];

const driverSteps = [
  { icon: Car, title: "أنشر رحلتك", desc: "حدد الوجهة والوقت والسعر — يستغرق الأمر أقل من دقيقة", color: "bg-blue-500/10 text-blue-600" },
  { icon: Users, title: "استقبل الركاب", desc: "يحجز المسافرون مباشرة — أنت توافق وتنطلق", color: "bg-primary/10 text-primary" },
  { icon: DollarSign, title: "اكسب من طريقك", desc: "غطِّ تكاليف البنزين واكسب أموالاً إضافية من رحلاتك اليومية", color: "bg-accent/10 text-accent" },
];

export default function HowItWorks() {
  const [tab, setTab] = useState("passenger");
  const steps = tab === "passenger" ? passengerSteps : driverSteps;

  return (
    <section className="py-16 md:py-20 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="inline-block bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full mb-3">
            بسيط وسريع
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">كيف تستخدم سيرتنا؟</h2>
          <p className="text-muted-foreground max-w-md mx-auto text-sm">
            ثلاث خطوات فقط تفصلك عن رحلتك القادمة
          </p>

          <div className="flex justify-center gap-2 mt-6">
            {[
              { id: "passenger", label: "أريد أسافر", icon: Users },
              { id: "driver", label: "أريد أوصّل", icon: Car },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                  tab === t.id
                    ? "bg-primary text-primary-foreground shadow-lg scale-105"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-14 left-1/4 right-1/4 h-px bg-border z-0" />

          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
              className="relative bg-card rounded-2xl p-7 border border-border hover:shadow-xl hover:border-primary/20 transition-all group text-center z-10"
            >
              <div className="absolute -top-4 right-1/2 translate-x-1/2 w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-black flex items-center justify-center shadow-lg">
                {i + 1}
              </div>
              <div className={`w-14 h-14 rounded-2xl ${step.color} flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform`}>
                <step.icon className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-foreground text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}