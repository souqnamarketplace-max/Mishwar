import { useSEO } from "@/hooks/useSEO";
import React from "react";
import HowItWorksComponent from "../components/home/HowItWorks";
import CTASection from "../components/home/CTASection";
import { Shield, Clock, CreditCard, Headphones, Heart, Users } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  { icon: Shield, title: "رحلة آمنة", desc: "السائقون الموثّقون يحملون شارة ✓ — يمكنك التحقق من هوية السائق قبل الحجز" },
  // Previously claimed "all transactions through the platform" — that's
  // false. Mishwaro does NOT process payments; passengers pay drivers
  // directly. Replaced with an accurate description of the model.
  { icon: CreditCard, title: "دفع مباشر", desc: "تدفع للسائق مباشرة بالطريقة المتفق عليها — نقداً، جوال باي، ريفلكت، أو تحويل بنكي" },
  { icon: Headphones, title: "دعم سريع", desc: "تواصل مع فريق الدعم في أي وقت من خلال صفحة المساعدة" },
  { icon: Users, title: "مجتمع فلسطيني", desc: "نخدم مجتمع المسافرين والسائقين في فلسطين" },
  { icon: Heart, title: "تقييمات شفافة", desc: "نظام تقييمات مزدوج بين السائقين والركاب لبناء الثقة" },
  // Previously claimed 24h cancellation for "electronic payment" — that
  // payment mode doesn't exist in the app. Simplified to the actual rule.
  { icon: Clock, title: "إلغاء مرن", desc: "يمكنك إلغاء حجزك من 'رحلاتي' قبل بدء الرحلة" },
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
  useSEO({
    title: "كيف يعمل مشوارو — مشاركة رحلات السيارة في فلسطين",
    description: "مشوارو أسهل طريقة للسفر بين مدن فلسطين بنص السعر. ابحث عن رحلة أو كن سائقاً واكسب من طريقك اليومي. 3 خطوات فقط: ابحث، احجز، سافر.",
  });

  return (
    <div>
      <HowItWorksComponent />

      {/* Features */}
      <section className="py-16 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-10">لماذا تختار مشوارو؟</h2>
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

      {/* Trip requests — new feature explaining both directions */}
      <section className="py-16 bg-muted/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-3">
            اطلب رحلتك أو ابحث عن ركاب
          </h2>
          <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
            مشوارو يربطك بطريقتين: السائق ينشر رحلته، أو الراكب يطلب رحلة ويختار السائقُ المناسبَ التواصلَ معه.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-card rounded-2xl border border-border p-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3 text-xl">🧍</div>
              <h3 className="font-bold text-foreground mb-2">للراكب: اطلب رحلتك</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                لا تجد سائقاً يناسب موعدك؟ انشر طلب رحلة من أين إلى أين، التاريخ والسعر المقترح. السائقون المشتركون سيرونه ويتواصلون معك.
              </p>
              <ul className="text-xs text-foreground/80 space-y-1.5">
                <li>• مجاناً، لا اشتراك مطلوب</li>
                <li>• حتى 3 طلبات نشطة في نفس الوقت</li>
                <li>• هاتفك لا يظهر — التواصل عبر رسائل التطبيق فقط</li>
              </ul>
            </div>
            <div className="bg-card rounded-2xl border border-border p-6">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-3 text-xl">🚗</div>
              <h3 className="font-bold text-foreground mb-2">للسائق: تصفّح طلبات الركاب</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                ميزة حصرية للسائقين المشتركين. تصفح طلبات الركاب على مساراتك، فلتر "بالقرب مني" 5–30 كم، وتواصل مباشرة مع من تختار.
              </p>
              <ul className="text-xs text-foreground/80 space-y-1.5">
                <li>• فلاتر: مدينة، تاريخ، سعر أقصى، مقاعد، قرب الموقع</li>
                <li>• ضمن اشتراك المنصة الشهري</li>
                <li>• لا حجز ولا التزام — مجرد تواصل</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Cancellation Policy — simplified to reflect the actual model.
          Previously this section described two cancellation windows
          (24h for "electronic payment", 2h for cash). The app has no
          electronic-payment processing — passengers pay drivers
          directly off-platform — so that distinction was misleading.
          The actual rule: cancel anytime before the trip starts via
          'My Trips'. The 2-hour-courtesy advisory is kept as a tip,
          not a system-enforced policy. */}
      <section className="py-16 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="bg-card rounded-2xl border border-border p-8">
            <h2 className="text-2xl font-bold text-foreground mb-6">سياسة الإلغاء</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  إلغاء قبل بدء الرحلة
                </h3>
                <p className="text-muted-foreground">
                  يمكنك إلغاء الحجز في أي وقت قبل بدء الرحلة من صفحة "رحلاتي". احتراماً للسائق وللركاب الآخرين، ننصح بالإلغاء قبل ساعتين على الأقل من موعد المغادرة كلما أمكن.
                </p>
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-2 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-accent" />
                  استرداد المبالغ
                </h3>
                <p className="text-muted-foreground">
                  الدفع يتم مباشرة بينك وبين السائق — لذا أي استرداد يكون باتفاق مباشر معه. مشوارو لا يحتفظ بأموال الرحلات ولا يدير المعاملات المالية.
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