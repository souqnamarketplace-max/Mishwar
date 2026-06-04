import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { Link } from "react-router-dom";
import { Shield, CheckCircle, Phone, Star, Lock, UserCheck, ArrowLeft } from "lucide-react";

const features = [
  {
    icon: UserCheck,
    title: "التحقق من الهوية",
    desc: "جميع السائقين يمرون بعملية تحقق صارمة تشمل الهوية الشخصية، رخصة القيادة، وبيانات المركبة.",
  },
  {
    icon: Star,
    title: "نظام التقييمات",
    desc: "بعد كل رحلة، يقيّم الركاب والسائقون بعضهم البعض مما يضمن جودة الخدمة باستمرار.",
  },
  {
    icon: Lock,
    title: "حماية البيانات",
    desc: "بياناتك الشخصية محمية وفق معايير عالية ولا تُشارك مع أي طرف ثالث.",
  },
  {
    icon: Phone,
    // Previously claimed "24/7 support team" — that's an overclaim for
    // an early-stage app. Adjusted to factual: a support page where
    // users can submit reports and get follow-up.
    title: "دعم سريع",
    desc: "يمكنك التواصل مع فريق الدعم في أي وقت عبر صفحة المساعدة، وسنرد في أقرب فرصة.",
  },
  {
    icon: Shield,
    title: "سياسة الإلغاء",
    desc: "يمكنك إلغاء حجزك في أي وقت قبل بدء الرحلة من صفحة 'رحلاتي'. ننصح بالإلغاء قبل ساعتين على الأقل احتراماً للسائق وباقي الركاب.",
  },
  {
    icon: CheckCircle,
    // Previously: "we monitor trip quality continuously and take
    // immediate action on complaints" — overclaims continuous
    // monitoring + instant action. Honest version: review of reports
    // by the team.
    title: "متابعة الشكاوى",
    desc: "نستقبل البلاغات والملاحظات من المستخدمين، يراجعها فريق الإدارة ويتخذ الإجراء المناسب.",
  },
];

const tips = [
  "تحقق دائماً من تقييمات السائق قبل الحجز",
  "شارك تفاصيل رحلتك مع شخص تثق به",
  "تأكد من مطابقة لوحة السيارة قبل الركوب",
  "استخدم ميزة المحادثة داخل التطبيق",
  "أبلغ عن أي سلوك مشبوه فوراً",
  "عند نشر طلب رحلة، لا تشارك رقم هاتفك في الملاحظات",
  "تأكد من توثيق السائق (شارة 'سائق موثّق') قبل الموافقة على رحلة من طلب",
  "اطلب رؤية لوحة السيارة قبل الركوب حتى لو تواصلتم بشكل مسبق",
  "السائقون يرون فقط الركاب الموثّقين — توثيق هويتك يبني ثقتهم بك",
];

export default function Safety() {
  useSEO({
    title: "السلامة والأمان في مشوارو — رحلات موثوقة في فلسطين",
    description: "مشوارو يضمن سلامتك في كل رحلة: سائقون موثّقو الهوية، رخص قيادة سارية، تأمين مركبة، تقييمات حقيقية من الركاب. سافر بأمان مع مشوارو.",
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        الرئيسية
      </Link>

      {/* Hero */}
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Shield className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-3">الأمان في مشوارو</h1>
        <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
          سلامتك أولويتنا القصوى. نطبق أعلى معايير الأمان لضمان تجربة تنقل موثوقة لكل مستخدمينا.
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {features.map((f) => (
          <div key={f.title} className="bg-card rounded-2xl border border-border p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <f.icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-foreground mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tips */}
      <div className="bg-primary/5 rounded-2xl border border-primary/10 p-6">
        <h2 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-primary" />
          نصائح السلامة
        </h2>
        <ul className="space-y-3">
          {tips.map((tip, i) => (
            <li key={i} className="flex items-center gap-3 text-sm text-foreground">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                {i + 1}
              </div>
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}