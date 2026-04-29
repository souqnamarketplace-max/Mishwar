import { useSEO } from "@/hooks/useSEO";
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Search, ChevronDown, ChevronUp, MessageCircle, Phone, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const faqs = [
  { q: "كيف أحجز رحلة في مِشوار؟", a: "ابحث عن وجهتك، اختر الرحلة المناسبة، وأكمل الحجز بسهولة. يمكنك الدفع عبر المنصة بأمان." },
  { q: "هل يمكنني إلغاء حجزي؟", a: "نعم، لكن يعتمد على طريقة الدفع: • للدفع الإلكتروني (بطاقة/تحويل): إلغاء مجاني قبل 24 ساعة من الرحلة • للدفع النقدي: إلغاء مجاني قبل ساعتين من الرحلة • بعد هذه الأوقات قد تطبق رسوم إلغاء" },
  { q: "كيف أصبح سائقاً في مِشوار؟", a: "سجّل حسابك كسائق، أضف معلومات سيارتك، وانتظر التوثيق. بعدها يمكنك نشر رحلاتك." },
  { q: "هل بياناتي المالية آمنة؟", a: "نعم، جميع المعاملات المالية مشفرة ومحمية بأعلى معايير الأمان." },
  { q: "ماذا أفعل إذا واجهت مشكلة مع السائق؟", a: "يمكنك التواصل مع فريق الدعم عبر المحادثة أو الاتصال المباشر. نحن هنا لمساعدتك." },
  { q: "كيف يتم احتساب سعر الرحلة؟", a: "السائق يحدد سعر المقعد الواحد. يمكنك مقارنة الأسعار واختيار الأنسب لك." },
];

export default function Help() {
  useSEO({ title: "المساعدة والدعم", description: "إجابات للأسئلة الشائعة وطرق التواصل مع فريق دعم مِشوار" });

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