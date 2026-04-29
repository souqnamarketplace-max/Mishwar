import { useSEO } from "@/hooks/useSEO";
import React from "react";
import HowItWorksComponent from "../components/home/HowItWorks";
import CTASection from "../components/home/CTASection";
import { Shield, Clock, CreditCard, Headphones, Heart, Users } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  { icon: Shield, title: "رحلة آمنة", desc: "جميع السائقين موثقين ونتحقق من بياناتهم لضمان تجربة آمنة لك" },
  { icon: CreditCard, title: "دفع آمن", desc: "جميع المعاملات عبر المنصة بطريقة آمنة ومحمية" },
  { icon: Headphones, title: "دعم على مدار الساعة", desc: "فريق دعم جاهز لمساعدتك في أي وقت" },
  { icon: Users, title: "مجتمع موثوق", desc: "آلاف المستخدمين يثقون بمِشوار كل يوم" },
  { icon: Heart, title: "تقييمات ومراجعات", desc: "بناء مجتمع ثقة من خلال سجلات موثقة ومحدثة" },
  { icon: Clock, title: "سياسة إلغاء مرنة", desc: "إلغاء مجاني للدفع الإلكتروني قبل 24 ساعة، والنقد قبل ساعتين" },
];

const tips = [
  "كن دقيقاً في الوقت",
  "تواصل بوضوح",
  "كن ودوداً ومحترماً",
  "اتبع القوانين",
  "قيّم رحلتك",
  "شارك تجربتك",
];

export default function HowItWorks() {
  useSEO({ title: "كيف يعمل مِشوار", description: "3 خطوات بسيطة لاستخدام مِشوار — ابحث، احجز، سافر" });

  return (
    <div>
      <HowItWorksComponent />

      {/* Features */}
      <section className="py-16 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-10">لماذا تختار مِشوار؟</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-card rounded-2xl border border-border p-6 hover:shadow-md transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Tips */}
      <section className="py-16 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-foreground text-center mb-8">نصائح لرحلة ناجحة</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {tips.map((tip, i) => (
              <div key={tip} className="bg-card rounded-xl border border-border p-4 text-center">
                <div className="w-8 h-8 rounded-full bg-accent/10 text-accent font-bold flex items-center justify-center mx-auto mb-2 text-sm">
                  {i + 1}
                </div>
                <p className="text-sm font-medium">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cancellation Policy */}
      <section className="py-16 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="bg-card rounded-2xl border border-border p-8">
            <h2 className="text-2xl font-bold text-foreground mb-6">سياسة الإلغاء</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  الحجوزات برسم الدفع الإلكتروني (بطاقة / تحويل)
                </h3>
                <p className="text-muted-foreground">
                  يمكن إلغاء الحجز مجاناً قبل 24 ساعة من موعد الرحلة. بعد هذا الوقت، قد تطبق رسوم إلغاء.
                </p>
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-accent" />
                  حجوزات الدفع النقدي
                </h3>
                <p className="text-muted-foreground">
                  يمكن إلغاء الحجز مجاناً قبل ساعتين من موعد الرحلة.
                </p>
              </div>
              <div className="p-4 bg-primary/5 rounded-xl border border-primary/20">
                <p className="text-sm text-primary font-medium">
                  💡 يتم إخطار السائق والراكب تلقائياً عند إلغاء أي حجز
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CTASection />
    </div>
  );
}