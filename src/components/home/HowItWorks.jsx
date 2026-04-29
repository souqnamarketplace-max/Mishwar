import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, CheckCircle, Car, Users, DollarSign, MapPin, Clock, Star, ArrowLeft, Smartphone, Zap } from "lucide-react";
import { Link } from "react-router-dom";

// Real Palestinian story scenario
const SCENARIO = {
  passenger: {
    story: "أحمد من رام الله، بدو يروح نابلس كل أسبوع",
    steps: [
      {
        num: 1,
        icon: Search,
        title: "ابحث في ثوانٍ",
        desc: "أحمد فتح مِشوار، حط رام الله ← نابلس، وظهرت له 4 رحلات فوراً",
        phone: {
          top: "مِشوار",
          content: "رام الله ← نابلس",
          sub: "الجمعة • 08:00",
          results: ["أحمد خليل • ₪45 • 3 مقاعد ⭐4.9", "سامي أبو أحمد • ₪40 • 2 مقاعد ⭐4.7"],
          highlight: 0,
        },
        color: "from-blue-500 to-blue-600",
        saving: null,
      },
      {
        num: 2,
        icon: CheckCircle,
        title: "اختر واحجز بضغطة",
        desc: "شاف تقييم السائق وصور السيارة، واحجز مقعده خلال 30 ثانية",
        phone: {
          top: "تفاصيل الرحلة",
          content: "₪45 للمقعد",
          sub: "سائق موثق ⭐4.9 • 150+ رحلة",
          results: ["✅ مقعد محجوز!", "📱 تم إرسال تأكيد"],
          highlight: 0,
        },
        color: "from-primary to-primary/80",
        saving: "وفّر ₪75 مقارنة بالتاكسي",
      },
      {
        num: 3,
        icon: Car,
        title: "انطلق بأمان وارتياح",
        desc: "السائق وصل بالوقت المحدد، الرحلة خلال 55 دقيقة، ووصل أحمد نابلس بكل راحة",
        phone: {
          top: "رحلتك الآن",
          content: "🚗 السائق في الطريق!",
          sub: "يصل خلال 5 دقائق",
          results: ["رام الله → نابلس", "55 دقيقة • ₪45"],
          highlight: 0,
        },
        color: "from-accent to-accent/80",
        saving: null,
      },
    ],
  },
  driver: {
    story: "محمود سائق من نابلس، بروح رام الله كل يوم",
    steps: [
      {
        num: 1,
        icon: Car,
        title: "أنشر رحلتك في دقيقة",
        desc: "محمود أضاف رحلته من نابلس لرام الله الساعة 7 صبح — العملية أخذت 60 ثانية بالضبط",
        phone: {
          top: "رحلة جديدة",
          content: "نابلس → رام الله",
          sub: "07:00 • 4 مقاعد • ₪45",
          results: ["✅ تم نشر الرحلة!", "🔔 جاهز لاستقبال الركاب"],
          highlight: 0,
        },
        color: "from-blue-500 to-blue-600",
        saving: null,
      },
      {
        num: 2,
        icon: Users,
        title: "استقبل الركاب",
        desc: "خلال 20 دقيقة حجز 3 ركاب — محمود وافق على طلباتهم بضغطة واحدة",
        phone: {
          top: "حجوزات الرحلة",
          content: "3 ركاب حجزوا",
          sub: "سعاد • رامي • لينا",
          results: ["💰 إجمالي: ₪135", "🚗 الرحلة ممتلئة!"],
          highlight: 0,
        },
        color: "from-primary to-primary/80",
        saving: null,
      },
      {
        num: 3,
        icon: DollarSign,
        title: "اكسب من طريقك",
        desc: "محمود كان رايح على أي حال — الآن بيغطي تكاليف البنزين ويربح فوقها",
        phone: {
          top: "أرباح الأسبوع",
          content: "₪540",
          sub: "4 رحلات هذا الأسبوع",
          results: ["⛽ البنزين: مغطى بالكامل", "💵 ربح صافٍ: ₪380"],
          highlight: 0,
        },
        color: "from-accent to-accent/80",
        saving: "₪380 ربح إضافي هذا الأسبوع",
      },
    ],
  },
};

// Mini phone mockup component
function PhoneMockup({ data, color }) {
  return (
    <motion.div
      key={data.top}
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -10 }}
      transition={{ duration: 0.3 }}
      className="w-48 mx-auto"
    >
      {/* Phone shell */}
      <div className="bg-slate-900 rounded-[2rem] p-2 shadow-2xl">
        {/* Screen */}
        <div className="bg-white rounded-[1.5rem] overflow-hidden">
          {/* Status bar */}
          <div className="bg-slate-900 h-5 flex items-center justify-between px-5">
            <span className="text-white text-[8px] font-medium">9:41</span>
            <div className="flex gap-1">
              <div className="w-4 h-1.5 bg-white rounded-sm" />
              <div className="w-1.5 h-1.5 bg-white rounded-full" />
            </div>
          </div>

          {/* App header */}
          <div className={`bg-gradient-to-r ${color} px-3 py-2`}>
            <p className="text-white font-bold text-[10px]">م مِشوار</p>
            <p className="text-white/80 text-[8px]">{data.top}</p>
          </div>

          {/* Content */}
          <div className="p-2.5 bg-gray-50">
            <div className="bg-white rounded-xl p-2 mb-2 shadow-sm">
              <p className="font-black text-slate-900 text-[11px] leading-tight">{data.content}</p>
              <p className="text-slate-500 text-[9px] mt-0.5">{data.sub}</p>
            </div>
            {data.results.map((r, i) => (
              <div key={i} className={`rounded-lg px-2 py-1.5 mb-1.5 text-[9px] font-medium ${
                i === data.highlight
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-white text-slate-700 border border-gray-100"
              }`}>
                {r}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Home indicator */}
      <div className="flex justify-center mt-2">
        <div className="w-20 h-1 bg-slate-700 rounded-full" />
      </div>
    </motion.div>
  );
}

export default function HowItWorks() {
  const [tab, setTab] = useState("passenger");
  const [activeStep, setActiveStep] = useState(0);
  const scenario = SCENARIO[tab];
  const steps = scenario.steps;

  // Auto-advance steps
  useEffect(() => {
    setActiveStep(0);
    const timer = setInterval(() => {
      setActiveStep(s => (s + 1) % steps.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [tab, steps.length]);

  const step = steps[activeStep];

  return (
    <section className="py-16 md:py-24 bg-background overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-bold px-4 py-1.5 rounded-full mb-4">
            <Zap className="w-3.5 h-3.5" />
            بسيط وسريع وفلسطيني
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-foreground mb-3 leading-tight">
            كيف يشتغل
            <span className="text-primary"> مِشوار؟</span>
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            سواء كنت مسافراً أو سائقاً — مِشوار يوصلك في 3 خطوات بسيطة
          </p>

          {/* Toggle */}
          <div className="flex justify-center gap-3 mt-8">
            {[
              { id: "passenger", label: "🎫 أريد أسافر", sub: "ابحث واحجز" },
              { id: "driver",    label: "🚗 أريد أوصّل", sub: "أنشر واكسب" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-300 text-right ${
                  tab === t.id
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25 scale-105"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <div>{t.label}</div>
                <div className={`text-xs mt-0.5 ${tab === t.id ? "text-primary-foreground/70" : "text-muted-foreground/70"}`}>{t.sub}</div>
              </button>
            ))}
          </div>

          {/* Story subtitle */}
          <AnimatePresence mode="wait">
            <motion.p
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-sm text-muted-foreground mt-4 italic"
            >
              "{scenario.story}"
            </motion.p>
          </AnimatePresence>
        </motion.div>

        {/* Main content: Desktop = side by side, Mobile = stacked */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Left: Steps */}
          <div className="space-y-4 order-2 lg:order-1">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === activeStep;
              return (
                <motion.button
                  key={s.title}
                  onClick={() => setActiveStep(i)}
                  className={`w-full text-right p-5 rounded-2xl border-2 transition-all duration-300 flex items-start gap-4 ${
                    isActive
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                      : "border-border bg-card hover:border-primary/30 hover:bg-muted/30"
                  }`}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  {/* Step number + icon */}
                  <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${s.color} text-white shadow-sm`}>
                    <Icon className="w-6 h-6" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-black ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                        الخطوة {s.num}
                      </span>
                      {s.saving && (
                        <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">
                          💰 {s.saving}
                        </span>
                      )}
                    </div>
                    <h3 className={`font-black text-lg leading-tight mb-1 ${isActive ? "text-foreground" : "text-foreground/80"}`}>
                      {s.title}
                    </h3>
                    <p className={`text-sm leading-relaxed ${isActive ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                      {s.desc}
                    </p>
                  </div>

                  {/* Active indicator */}
                  {isActive && (
                    <div className="shrink-0 w-2 h-2 rounded-full bg-primary mt-5" />
                  )}
                </motion.button>
              );
            })}

            {/* Progress bar */}
            <div className="flex gap-2 pt-2 justify-center">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveStep(i)}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i === activeStep ? "bg-primary w-8" : "bg-muted w-4"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Right: Animated phone */}
          <div className="order-1 lg:order-2 flex flex-col items-center gap-6">
            {/* Phone */}
            <AnimatePresence mode="wait">
              <PhoneMockup key={`${tab}-${activeStep}`} data={step.phone} color={step.color} />
            </AnimatePresence>

            {/* Context chips */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`chips-${tab}-${activeStep}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-wrap gap-2 justify-center max-w-xs"
              >
                {tab === "passenger" ? (
                  <>
                    <div className="flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-medium shadow-sm">
                      <MapPin className="w-3 h-3 text-primary" /> رام الله ← نابلس
                    </div>
                    <div className="flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-medium shadow-sm">
                      <Clock className="w-3 h-3 text-accent" /> 55 دقيقة
                    </div>
                    <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1.5 text-xs font-bold text-green-700 shadow-sm">
                      💰 وفّر ₪75 عن التاكسي
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-medium shadow-sm">
                      <Car className="w-3 h-3 text-primary" /> نابلس ← رام الله
                    </div>
                    <div className="flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-medium shadow-sm">
                      <Users className="w-3 h-3 text-accent" /> 3 ركاب
                    </div>
                    <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1.5 text-xs font-bold text-green-700 shadow-sm">
                      ⛽ البنزين مجاناً + ربح إضافي
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mt-14"
        >
          <p className="text-muted-foreground mb-5 text-sm">
            جرّب بنفسك — الحجز الأول مجاناً
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/search"
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-2xl font-bold text-base hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 active:scale-95">
              <Search className="w-5 h-5" />
              ابحث عن رحلة الآن
            </Link>
            <Link to="/create-trip"
              className="inline-flex items-center justify-center gap-2 bg-card border-2 border-border text-foreground px-8 py-3.5 rounded-2xl font-bold text-base hover:border-primary/30 hover:bg-muted/50 transition-all active:scale-95">
              <Car className="w-5 h-5" />
              أنشر رحلتك
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
