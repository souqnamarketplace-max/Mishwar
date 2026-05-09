import { useSEO } from "@/hooks/useSEO";
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Search, ChevronDown, ChevronUp, MessageCircle, Phone, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// FAQ list. Reflects the ACTUAL payment/cancellation/communication
// model of the app:
//   - Payments are settled directly between passenger and driver
//     (cash / Jawwal Pay / Reflect / bank transfer). Mishwaro does NOT
//     process payments and does NOT take a per-trip commission.
//   - Drivers settle with the platform via a fixed monthly subscription
//     (currently ₪30) — no per-trip cut.
//   - Communication is via in-app messaging only (no WhatsApp).
//
// Also covers the most common pre-launch support questions:
//   - "I can't log in / didn't get the confirmation email"
//   - "What are the password requirements"
//   - "My city isn't in the list"
//   - "When does a trip get marked complete"
const faqs = [
  {
    q: "كيف أحجز رحلة في مشوارو؟",
    a: "ابحث عن وجهتك من الصفحة الرئيسية، اختر الرحلة المناسبة لك، ثم اضغط 'حجز' وحدد طريقة الدفع المتفق عليها مع السائق. ستتلقى إشعاراً بمجرد قبول السائق لحجزك."
  },
  {
    q: "كيف أدفع للسائق؟",
    a: "الدفع يتم مباشرة بينك وبين السائق — مشوارو لا يحتفظ بأموالك ولا يأخذ عمولة من الرحلة. عند الحجز اختر طريقة الدفع المناسبة (نقداً، جوال باي، ريفلكت، أو تحويل بنكي) واتفق مع السائق على التفاصيل."
  },
  {
    q: "هل يمكنني إلغاء حجزي؟",
    a: "نعم، يمكنك إلغاء حجزك من صفحة 'رحلاتي' قبل بدء الرحلة. ننصح بالإلغاء قبل ساعتين على الأقل من موعد الانطلاق احتراماً للسائق وللركاب الآخرين."
  },
  {
    q: "كيف أصبح سائقاً في مشوارو؟",
    a: "سجّل حسابك واختر 'سائق' في الإعداد الأولي، ثم أضف بيانات سيارتك ورخصة القيادة وتسجيل المركبة وصور التحقق. بعد مراجعة الفريق ستتمكن من نشر رحلاتك. يدفع السائقون اشتراكاً شهرياً ثابتاً للمنصة (لا عمولة من كل رحلة)."
  },
  {
    q: "لم تصلني رسالة تأكيد البريد الإلكتروني — ماذا أفعل؟",
    a: "تحقق أولاً من مجلد الرسائل غير المرغوب فيها (Spam) — أحياناً تصل الرسالة إلى هناك. إذا لم تجدها، اضغط على زر 'إعادة إرسال رابط التأكيد' في صفحة تسجيل الدخول. قد تستغرق الرسالة بضع دقائق للوصول. إذا استمرت المشكلة، تواصل مع الدعم وسنفعّل حسابك يدوياً."
  },
  {
    q: "ما متطلبات كلمة المرور؟",
    a: "كلمة المرور يجب أن تحتوي على: 8 أحرف على الأقل، حرف كبير واحد على الأقل (A-Z)، حرف صغير واحد على الأقل (a-z)، ورقم واحد على الأقل (0-9). مثال: Mishwar123"
  },
  {
    q: "مدينتي/قريتي غير موجودة في القائمة",
    a: "اكتب اسمها في حقل البحث وستظهر لك خيار 'اقترح إضافة'. سيراجع فريق الإدارة الطلب ويضيف المدينة قريباً مع موقعها على الخريطة."
  },
  {
    q: "كيف يتم احتساب سعر الرحلة؟",
    a: "السائق يحدد سعر المقعد الواحد عند نشر الرحلة. يمكنك مقارنة الأسعار واختيار الرحلة الأنسب لك. لا توجد رسوم خفية من جانب مشوارو."
  },
  {
    q: "ماذا يحدث إذا انتهت الرحلة بدون أن يضغط السائق على 'إنهاء الرحلة'؟",
    a: "إذا مر 30 دقيقة على وقت المغادرة دون تأكيد من السائق، يتم وضع علامة 'مكتملة' على الرحلة تلقائياً، ويتمكن الركاب من إضافة تقييماتهم."
  },
  {
    q: "هل بياناتي الشخصية آمنة؟",
    a: "نعم، نحمي بياناتك وفق معايير عالية. لمزيد من التفاصيل راجع صفحة 'سياسة الخصوصية'."
  },
  {
    q: "ماذا أفعل إذا واجهت مشكلة مع السائق أو راكب؟",
    a: "يمكنك الإبلاغ عن المستخدم مباشرة من صفحة الرحلة أو الرسائل (زر '⋯' ثم 'إبلاغ'). فريق الدعم يراجع كل بلاغ ويتخذ الإجراء المناسب."
  },
];

export default function Help() {
  // FAQPage structured data — gives the FAQ entries a chance to appear
  // as rich results in Google search ("People also ask" carousel).
  // Each Q&A becomes a Question + Answer pair in the itemListElement.
  const helpJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(f => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a },
    })),
  };
  useSEO({
    title: "المساعدة والدعم",
    description: "إجابات للأسئلة الشائعة وطرق التواصل مع فريق دعم مشوارو",
    canonical: "https://mishwar-nu.vercel.app/help",
    jsonLd: helpJsonLd,
  });

  const [openIndex, setOpenIndex] = useState(null);

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });

  const settings = settingsArr[0] || {};
  const supportPhone = settings.support_phone || "+970 59 123 4567";
  const supportEmail = settings.support_email || "support@mishwar.ps";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="text-center mb-10">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Headphones className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">المساعدة والدعم</h1>
        <p className="text-muted-foreground">كيف يمكننا مساعدتك اليوم؟</p>
      </div>

      {/* Search */}
      <div className="relative max-w-xl mx-auto mb-10">
        <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          placeholder="ابحث عن سؤالك..."
          className="h-12 pr-12 rounded-xl bg-card border-border text-base"
        />
      </div>

      {/* FAQs */}
      <div className="space-y-3 mb-12">
        <h2 className="text-xl font-bold text-foreground mb-4">الأسئلة الشائعة</h2>
        {faqs.map((faq, i) => (
          <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 text-right"
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
            >
              <span className="font-medium text-sm">{faq.q}</span>
              {openIndex === i ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </button>
            {openIndex === i && (
              <div className="px-4 pb-4 text-sm text-muted-foreground">
                {faq.a}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Contact */}
      <div className="bg-primary/5 rounded-2xl p-8 text-center">
        <h2 className="text-xl font-bold text-foreground mb-2">لم تجد إجابتك؟</h2>
        <p className="text-muted-foreground text-sm mb-6">فريق الدعم لدينا جاهز لمساعدتك</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button className="rounded-xl bg-primary text-primary-foreground gap-2">
            <MessageCircle className="w-4 h-4" />
            محادثة مباشرة
          </Button>
          <Button variant="outline" className="rounded-xl gap-2">
            <Phone className="w-4 h-4" />
            {supportPhone}
          </Button>
          <Button variant="outline" className="rounded-xl gap-2">
            <Mail className="w-4 h-4" />
            {supportEmail}
          </Button>
        </div>
      </div>
    </div>
  );
}