import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, CheckCircle, Car, Users, DollarSign, MapPin, Clock, Star, Zap, Bell, Heart, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

// ── Real app screen mockups ──────────────────────────────────────────────────

function ScreenSearch() {
  return (
    <div className="bg-gray-50 flex-1 p-2 space-y-2 overflow-hidden">
      {/* Search card */}
      <div className="bg-white rounded-xl shadow-sm p-2.5">
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1.5 mb-1.5">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-[9px] text-gray-500 flex-1">رام الله</span>
        </div>
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1.5">
          <MapPin className="w-2 h-2 text-amber-500" />
          <span className="text-[9px] text-gray-500 flex-1">نابلس</span>
        </div>
      </div>
      {/* Trip cards */}
      {[
        { name: "أحمد خليل", price: "45", seats: 3, rating: "4.9", car: "كيا سيراتو" },
        { name: "سامي أبو أحمد", price: "40", seats: 2, rating: "4.7", car: "هيونداي إلنترا" },
      ].map((t, i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm p-2 border border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[8px] font-black text-primary">₪{t.price}</div>
            <div className="flex items-center gap-0.5">
              <Star className="w-2 h-2 text-yellow-400 fill-yellow-400" />
              <span className="text-[8px] text-gray-500">{t.rating}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[8px] text-gray-400">{t.car}</div>
            <div className="text-[8px] text-gray-400">{t.seats} مقاعد</div>
          </div>
          <div className="text-[8px] font-medium text-gray-700 mt-0.5">{t.name}</div>
        </div>
      ))}
    </div>
  );
}

function ScreenBooking() {
  return (
    <div className="bg-gray-50 flex-1 overflow-hidden">
      {/* Map area */}
      <div className="h-16 bg-gradient-to-b from-green-100 to-green-50 relative flex items-center justify-center">
        <div className="text-[8px] text-green-700 font-medium">رام الله ← نابلس</div>
        <div className="absolute bottom-1 right-2 w-3 h-3 rounded-full bg-primary border border-white shadow" />
        <div className="absolute bottom-1 left-2 w-3 h-3 rounded-full bg-red-500 border border-white shadow" />
      </div>
      {/* Booking dialog */}
      <div className="bg-white rounded-t-xl p-2.5 -mt-2 relative shadow-lg">
        <div className="text-[10px] font-black text-center mb-2">تأكيد الحجز</div>
        <div className="bg-gray-50 rounded-lg p-1.5 mb-2 flex items-center justify-between">
          <span className="text-[8px] text-gray-500">أحمد خليل</span>
          <div className="flex items-center gap-0.5">
            <Star className="w-2 h-2 text-yellow-400 fill-yellow-400" />
            <span className="text-[8px]">4.9</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 mb-2">
          {["نقداً 💵","ريفلكت 💳","جوال 📱"].map(m => (
            <div key={m} className={`text-[7px] text-center py-1 rounded-lg border ${m.includes("نقداً") ? "border-primary bg-primary/10 text-primary font-bold" : "border-gray-200 text-gray-400"}`}>{m}</div>
          ))}
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[8px] text-gray-500">المجموع</span>
          <span className="text-[10px] font-black text-primary">₪45</span>
        </div>
        <div className="bg-primary rounded-lg py-1.5 text-center">
          <span className="text-white text-[9px] font-bold">تأكيد الحجز — ₪45</span>
        </div>
      </div>
    </div>
  );
}

function ScreenConfirmed() {
  return (
    <div className="bg-gray-50 flex-1 flex flex-col items-center justify-center p-3 gap-2">
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle className="w-5 h-5 text-green-600" />
      </div>
      <div className="text-[10px] font-black text-center">تم الحجز بنجاح! 🎉</div>
      <div className="bg-white rounded-xl p-2 w-full shadow-sm border border-gray-100 space-y-1">
        <div className="flex justify-between">
          <span className="text-[8px] text-gray-400">الرحلة</span>
          <span className="text-[8px] font-medium">رام الله ← نابلس</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] text-gray-400">الوقت</span>
          <span className="text-[8px] font-medium">الجمعة 08:00</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] text-gray-400">السائق</span>
          <span className="text-[8px] font-medium">أحمد خليل ⭐4.9</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[8px] text-gray-400">السعر</span>
          <span className="text-[8px] font-black text-primary">₪45</span>
        </div>
      </div>
      <div className="bg-green-50 rounded-lg px-3 py-1.5 text-center">
        <span className="text-[8px] text-green-700 font-bold">وفّرت ₪75 عن التاكسي 💰</span>
      </div>
    </div>
  );
}

function ScreenCreateTrip() {
  return (
    <div className="bg-gray-50 flex-1 p-2 space-y-2">
      <div className="text-[9px] font-black text-center mb-1">نشر رحلة جديدة</div>
      {[
        { label: "من", val: "نابلس", icon: "🟢" },
        { label: "إلى", val: "رام الله", icon: "🔴" },
        { label: "التاريخ", val: "الجمعة 07:00", icon: "📅" },
        { label: "السعر", val: "₪45 للمقعد", icon: "💰" },
        { label: "المقاعد", val: "4 مقاعد", icon: "👥" },
      ].map(f => (
        <div key={f.label} className="bg-white rounded-lg px-2 py-1.5 flex items-center gap-1.5 shadow-sm">
          <span className="text-[9px]">{f.icon}</span>
          <div className="flex-1">
            <div className="text-[7px] text-gray-400">{f.label}</div>
            <div className="text-[8px] font-medium">{f.val}</div>
          </div>
        </div>
      ))}
      <div className="bg-primary rounded-lg py-1.5 text-center mt-1">
        <span className="text-white text-[9px] font-bold">نشر الرحلة ✓</span>
      </div>
    </div>
  );
}

function ScreenPassengers() {
  return (
    <div className="bg-gray-50 flex-1 p-2 space-y-2">
      <div className="text-[9px] font-black text-center">طلبات الحجز 🔔</div>
      {[
        { name: "سعاد محمود", from: "نابلس", status: "pending" },
        { name: "رامي سالم", from: "نابلس", status: "confirmed" },
        { name: "لينا أحمد", from: "بيتونيا", status: "confirmed" },
      ].map((p, i) => (
        <div key={i} className="bg-white rounded-xl p-2 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[8px] font-bold">{p.name}</div>
            <div className={`text-[7px] px-1.5 py-0.5 rounded-full font-bold ${p.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
              {p.status === "confirmed" ? "مقبول" : "معلق"}
            </div>
          </div>
          {p.status === "pending" && (
            <div className="flex gap-1 mt-1">
              <div className="flex-1 bg-primary rounded py-0.5 text-center text-[7px] text-white font-bold">قبول</div>
              <div className="flex-1 bg-red-50 border border-red-200 rounded py-0.5 text-center text-[7px] text-red-600 font-bold">رفض</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ScreenEarnings() {
  return (
    <div className="bg-gray-50 flex-1 p-2">
      <div className="text-[9px] font-black text-center mb-2">أرباح الأسبوع 💰</div>
      <div className="bg-primary rounded-xl p-3 text-center mb-2">
        <div className="text-white text-[9px] mb-0.5">إجمالي الأرباح</div>
        <div className="text-white text-xl font-black">₪540</div>
        <div className="text-white/70 text-[8px]">4 رحلات هذا الأسبوع</div>
      </div>
      <div className="space-y-1">
        {[
          { label: "تكلفة البنزين", val: "₪160", color: "text-red-500" },
          { label: "الربح الصافي", val: "₪380", color: "text-green-600" },
          { label: "متوسط/رحلة", val: "₪135", color: "text-primary" },
        ].map(r => (
          <div key={r.label} className="bg-white rounded-lg px-2 py-1.5 flex justify-between shadow-sm">
            <span className="text-[8px] text-gray-500">{r.label}</span>
            <span className={`text-[8px] font-black ${r.color}`}>{r.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Phone wrapper
function PhoneFrame({ children, headerTitle, headerColor = "bg-primary" }) {
  return (
    <motion.div
      key={headerTitle}
      initial={{ opacity: 0, scale: 0.93, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.93, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-44 mx-auto select-none"
    >
      <div className="bg-gray-900 rounded-[2.2rem] p-[5px] shadow-2xl ring-1 ring-white/10">
        <div className="bg-white rounded-[1.8rem] overflow-hidden flex flex-col" style={{ height: 300 }}>
          {/* Status bar */}
          <div className="bg-gray-900 h-5 flex items-center justify-between px-4 shrink-0">
            <span className="text-white text-[8px]">9:41</span>
            <div className="flex gap-1 items-center">
              <div className="w-4 h-1 bg-white rounded-sm opacity-80" />
              <div className="w-1.5 h-1.5 bg-white rounded-full opacity-80" />
            </div>
          </div>
          {/* App header */}
          <div className={`${headerColor} px-3 py-1.5 flex items-center gap-2 shrink-0`}>
            <img src="/logo.png" alt="" className="w-5 h-5 rounded-md object-cover" />
            <div>
              <p className="text-white font-black text-[9px] leading-none">مشوارو</p>
              <p className="text-white/70 text-[7px]">{headerTitle}</p>
            </div>
          </div>
          {/* Screen content */}
          {children}
        </div>
      </div>
      <div className="flex justify-center mt-2">
        <div className="w-16 h-1 bg-gray-700 rounded-full" />
      </div>
    </motion.div>
  );
}

// Scenarios config
const SCENARIOS = {
  passenger: {
    story: "أحمد من رام الله، بدو يروح نابلس كل أسبوع",
    steps: [
      {
        num: 1, title: "ابحث في ثوانٍ",
        desc: "أحمد فتح مشوارو، حط رام الله ← نابلس، وظهرت له 4 رحلات متاحة فوراً مع تقييمات السائقين والأسعار",
        screen: <ScreenSearch />, headerTitle: "نتائج البحث",
        color: "from-blue-500 to-blue-600", icon: Search, saving: null,
      },
      {
        num: 2, title: "اختر واحجز بضغطة",
        desc: "شاف تقييم السائق وصور السيارة، اختار طريقة الدفع وأكّد حجزه خلال 30 ثانية",
        screen: <ScreenBooking />, headerTitle: "تفاصيل الرحلة",
        color: "from-primary to-primary/80", icon: CheckCircle, saving: "وفّر ₪75 عن التاكسي",
      },
      {
        num: 3, title: "انطلق بأمان وارتياح",
        desc: "السائق وصل بالوقت المحدد، الرحلة خلال 55 دقيقة — ووصل أحمد نابلس بكل راحة",
        screen: <ScreenConfirmed />, headerTitle: "تأكيد الحجز",
        color: "from-green-600 to-green-500", icon: CheckCircle, saving: null,
      },
    ],
  },
  driver: {
    story: "محمود سائق من نابلس، بروح رام الله كل يوم",
    steps: [
      {
        num: 1, title: "أنشر رحلتك في دقيقة",
        desc: "محمود أضاف رحلته من نابلس لرام الله الساعة 7 صبح — العملية أخذت 60 ثانية بالضبط",
        screen: <ScreenCreateTrip />, headerTitle: "نشر رحلة",
        color: "from-blue-500 to-blue-600", icon: Car, saving: null,
      },
      {
        num: 2, title: "استقبل الركاب",
        desc: "خلال 20 دقيقة حجز 3 ركاب — محمود وافق على طلباتهم بضغطة واحدة من شاشته",
        screen: <ScreenPassengers />, headerTitle: "إدارة الحجوزات",
        color: "from-primary to-primary/80", icon: Users, saving: null,
      },
      {
        num: 3, title: "اكسب من طريقك",
        desc: "محمود كان رايح على أي حال — الآن بيغطي تكاليف البنزين ويربح ₪380 فوقها أسبوعياً",
        screen: <ScreenEarnings />, headerTitle: "لوحة الأرباح",
        color: "from-amber-500 to-amber-600", icon: DollarSign, saving: "₪380 ربح إضافي أسبوعياً",
      },
    ],
  },
};

export default function HowItWorks() {
  const [tab, setTab] = useState("passenger");
  const [activeStep, setActiveStep] = useState(0);
  const scenario = SCENARIOS[tab];
  const steps = scenario.steps;
  const step = steps[activeStep];

  useEffect(() => {
    setActiveStep(0);
    const timer = setInterval(() => setActiveStep(s => (s + 1) % steps.length), 3500);
    return () => clearInterval(timer);
  }, [tab, steps.length]);

  return (
    <section className="py-16 md:py-24 bg-background overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-bold px-4 py-1.5 rounded-full mb-4">
            <Zap className="w-3.5 h-3.5" /> بسيط وسريع وفلسطيني
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-foreground mb-3 leading-tight">
            كيف يشتغل <span className="text-primary">مشوارو؟</span>
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            سواء كنت مسافراً أو سائقاً — مشوارو يوصلك في 3 خطوات بسيطة
          </p>
          {/* Toggle */}
          <div className="flex justify-center gap-3 mt-8">
            {[
              { id: "passenger", label: "🎫 أريد أسافر", sub: "ابحث واحجز" },
              { id: "driver",    label: "🚗 أريد أوصّل", sub: "أنشر واكسب" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-5 py-3 rounded-2xl text-sm font-bold transition-all duration-300 text-right ${
                  tab === t.id
                    ? "bg-primary text-primary-foreground shadow-lg scale-105"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}>
                <div>{t.label}</div>
                <div className={`text-xs mt-0.5 ${tab === t.id ? "text-primary-foreground/70" : "text-muted-foreground/70"}`}>{t.sub}</div>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.p key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="text-sm text-muted-foreground mt-4 italic">
              "{scenario.story}"
            </motion.p>
          </AnimatePresence>
        </motion.div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Steps */}
          <div className="space-y-4 order-2 lg:order-1">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === activeStep;
              return (
                <motion.button key={s.title} onClick={() => setActiveStep(i)}
                  className={`w-full text-right p-5 rounded-2xl border-2 transition-all duration-300 flex items-start gap-4 ${
                    isActive ? "border-primary bg-primary/5 shadow-lg" : "border-border bg-card hover:border-primary/30"
                  }`}
                  whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
                  <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${s.color} text-white shadow-sm`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs font-black ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                        الخطوة {s.num}
                      </span>
                      {s.saving && (
                        <span className="text-xs bg-accent/15 text-accent px-2 py-0.5 rounded-full font-bold">
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
                  {isActive && <div className="shrink-0 w-2 h-2 rounded-full bg-primary mt-5" />}
                </motion.button>
              );
            })}
            {/* Progress dots */}
            <div className="flex gap-2 pt-2 justify-center">
              {steps.map((_, i) => (
                <button key={i} onClick={() => setActiveStep(i)}
                  className={`h-1.5 rounded-full transition-all duration-500 ${i === activeStep ? "bg-primary w-8" : "bg-muted w-4"}`} />
              ))}
            </div>
          </div>

          {/* Phone mockup */}
          <div className="order-1 lg:order-2 flex flex-col items-center gap-4">
            <AnimatePresence mode="wait">
              <PhoneFrame key={`${tab}-${activeStep}`} headerTitle={step.headerTitle}>
                {step.screen}
              </PhoneFrame>
            </AnimatePresence>
            {/* Context chips */}
            <AnimatePresence mode="wait">
              <motion.div key={`chips-${tab}-${activeStep}`}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-wrap gap-2 justify-center max-w-xs">
                {tab === "passenger" ? (
                  <>
                    <div className="flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-medium shadow-sm">
                      <MapPin className="w-3 h-3 text-primary" /> رام الله ← نابلس
                    </div>
                    <div className="flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-medium shadow-sm">
                      <Clock className="w-3 h-3 text-accent" /> 55 دقيقة
                    </div>
                    <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1.5 text-xs font-bold text-green-700">
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
                    <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1.5 text-xs font-bold text-green-700">
                      ⛽ البنزين مجاناً + ربح إضافي
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* CTA */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="text-center mt-14">
          <p className="text-muted-foreground mb-5 text-sm">جرّب بنفسك — الحجز الأول مجاناً</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/search"
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-2xl font-bold text-base hover:bg-primary/90 transition-all shadow-lg active:scale-95">
              <Search className="w-5 h-5" /> ابحث عن رحلة الآن
            </Link>
            <Link to="/create-trip"
              className="inline-flex items-center justify-center gap-2 bg-card border-2 border-border text-foreground px-8 py-3.5 rounded-2xl font-bold text-base hover:border-primary/30 hover:bg-muted/50 transition-all active:scale-95">
              <Car className="w-5 h-5" /> أنشر رحلتك
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
