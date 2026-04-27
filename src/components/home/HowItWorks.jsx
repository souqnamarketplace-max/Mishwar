import React, { useState } from "react";
import { motion } from "framer-motion";
import { Search, MousePointer, CreditCard, MessageCircle, ThumbsUp, Car, Users, MapPin, Clock, Shield } from "lucide-react";

const passengerSteps = [
  { icon: Search, title: "ابحث عن رحلة", desc: "ابحث عن رحلات متجهة إلى وجهتك في التاريخ والوقت المناسب لك" },
  { icon: MousePointer, title: "اختر مقعدك", desc: "اطلع على تفاصيل الرحلة والسائق واختر المقعد المناسب لك" },
  { icon: CreditCard, title: "احجز وادفع بأمان", desc: "احجز مقعدك وادفع بسهولة وأمان داخل التطبيق" },
  { icon: MessageCircle, title: "تواصل واستعد", desc: "تواصل مع السائق واستعد للرحلة في الموعد المحدد" },
  { icon: ThumbsUp, title: "استمتع برحلتك", desc: "استمتع برحلة آمنة ومريحة وصل إلى وجهتك" },
];

const driverSteps = [
  { icon: Car, title: "أنشئ رحلة", desc: "أضف تفاصيل رحلتك (إلى أين، الوقت، السعر، والمقاعد المتاحة)" },
  { icon: Users, title: "استقبل طلبات الحجز", desc: "استقبل الحجوزات من المسافرين واقبل المناسب" },
  { icon: MessageCircle, title: "تواصل مع المسافرين", desc: "تواصل مع المسافرين في مكان وتوقيت الانطلاق" },
  { icon: MapPin, title: "ابدأ رحلتك", desc: "قم بتنفيذ الرحلة وأوصل المسافرين بأمان" },
  { icon: Shield, title: "احصل على تقييمك", desc: "بناء مجتمع ثقة من خلال التقييمات والمراجعات" },
];

export default function HowItWorks() {
  const [tab, setTab] = useState("passenger");
  const steps = tab === "passenger" ? passengerSteps : driverSteps;

  return (
    <section className="py-16 md:py-24 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">كيف تعمل سيرتنا ؟</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            شارك الرحلة، وفر المال، وساهم في تخفيف الازدحام وحماية البيئة
          </p>

          <div className="flex justify-center gap-3 mt-8">
            <button
              onClick={() => setTab("passenger")}
              className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                tab === "passenger"
                  ? "bg-primary text-primary-foreground shadow-lg"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <Users className="w-4 h-4" />
              للمسافرين
            </button>
            <button
              onClick={() => setTab("driver")}
              className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                tab === "driver"
                  ? "bg-primary text-primary-foreground shadow-lg"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <Car className="w-4 h-4" />
              للسائقين
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative bg-card rounded-2xl p-6 border border-border hover:shadow-lg hover:border-primary/20 transition-all group text-center"
            >
              <div className="absolute -top-3 right-4 w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                {i + 1}
              </div>
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20 transition-colors">
                <step.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-bold text-foreground mb-2">{step.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}