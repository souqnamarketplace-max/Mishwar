import { useSEO } from "@/hooks/useSEO";
import React from "react";

// Bump this date whenever the policy text is materially updated.
// It is rendered in Arabic via Intl.DateTimeFormat below.
//
// ⚠️ LAWYER REVIEW REQUIRED before launch (audit C-10).
// The text below was edited 2026-05-06 to make the technical claims
// accurate (GPS during active trips, localStorage instead of cookies,
// sub-processors disclosed). It is NOT a substitute for review by a
// lawyer familiar with Palestinian law + GDPR + CCPA. Bump
// LAST_UPDATED_ISO when the lawyer's revisions land.
const LAST_UPDATED_ISO = "2026-05-06";

function formatArabicMonthYear(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(d);
  } catch {
    return iso;
  }
}

export default function PrivacyPolicy() {
  useSEO({ title: "سياسة الخصوصية", description: "سياسة خصوصية وحماية البيانات في مِشوار" });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12" dir="rtl">
      <h1 className="text-3xl font-black mb-2">سياسة الخصوصية</h1>
      <p className="text-muted-foreground text-sm mb-8">آخر تحديث: {formatArabicMonthYear(LAST_UPDATED_ISO)}</p>

      {[
        {
          title: "1. المعلومات التي نجمعها",
          body: "نجمع المعلومات التي تقدمها مباشرةً عند التسجيل (الاسم، البريد الإلكتروني، رقم الهاتف، صورة الملف الشخصي)، ومن السائقين بالإضافة إلى ذلك (رخصة القيادة، تسجيل المركبة، التأمين، صورة شخصية للتحقق). نسجل أيضاً نشاطك على المنصة (الرحلات، الحجوزات، الرسائل، التقييمات)."
        },
        {
          title: "2. الموقع الجغرافي",
          body: "خلال الرحلة النشطة فقط، قد يطلب التطبيق إذنك للوصول إلى موقعك الجغرافي لتحديد وصولك إلى الوجهة. تتم معالجة هذه البيانات محلياً على جهازك ولا يتم إرسالها إلى خوادمنا أو مشاركتها مع أي طرف ثالث. يمكنك رفض الإذن أو سحبه في أي وقت من إعدادات متصفحك أو نظام تشغيلك."
        },
        {
          title: "3. كيف نستخدم معلوماتك",
          body: "نستخدم بياناتك لتقديم خدمة مشاركة الرحلات، والتواصل معك بشأن حجوزاتك، والتحقق من هوية السائقين، وتحسين تجربتك على المنصة. لا نبيع بياناتك لأي طرف ثالث."
        },
        {
          title: "4. مشاركة المعلومات",
          body: "يتم مشاركة اسمك ورقم هاتفك مع السائق أو الراكب عند إتمام الحجز فقط. لا يتم مشاركة بريدك الإلكتروني أو بيانات الدفع المالية مع المستخدمين الآخرين."
        },
        {
          title: "5. مزودو الخدمات (المعالجون الفرعيون)",
          body: "نستخدم مزودي خدمات موثوقين لتشغيل المنصة: Supabase (قاعدة البيانات والمصادقة وتخزين الملفات)، Vercel (الاستضافة)، OpenStreetMap وNominatim وValhalla (خرائط وحساب المسارات). تتم معالجة بياناتك من قبل هؤلاء المزودين فقط بالقدر الضروري لتقديم الخدمة."
        },
        {
          title: "6. أمان البيانات",
          body: "نستخدم تشفيراً معيارياً في الصناعة (TLS/HTTPS) لحماية بياناتك أثناء النقل، وتشفيراً على مستوى التخزين (AES-256) لحمايتها عند الراحة. يتم تخزين بياناتك على خوادم Supabase في مراكز بيانات معتمدة."
        },
        {
          title: "7. التخزين المحلي",
          body: "نستخدم التخزين المحلي للمتصفح (localStorage) لإدارة جلسة تسجيل الدخول وتفضيلات الواجهة. لا نستخدم ملفات تعريف الارتباط (Cookies) للإعلانات أو التتبع. يمكنك مسح التخزين المحلي في أي وقت من إعدادات متصفحك (سيؤدي ذلك إلى تسجيل خروجك)."
        },
        {
          title: "8. حقوقك",
          body: "يحق لك الاطلاع على بياناتك الشخصية أو تصحيحها أو حذفها في أي وقت من صفحة إعدادات الحساب. يمكنك طلب نسخة من بياناتك بإرسال بريد إلكتروني إلى privacy@mishwar.ps. عند حذف حسابك، نقوم بإخفاء هويتك (anonymize) في بياناتنا للحفاظ على سلامة سجلات الرحلات للأطراف الأخرى، مع حذف معلوماتك الشخصية القابلة للتعرف."
        },
        {
          title: "9. الاحتفاظ بالبيانات",
          body: "نحتفظ ببياناتك طوال فترة نشاط حسابك. عند حذف الحساب، يتم إخفاء هويتك فوراً، مع الاحتفاظ بالسجلات المالية لمدة 7 سنوات وفقاً للمتطلبات القانونية."
        },
        {
          title: "10. التواصل",
          body: "لأي استفسار حول سياسة الخصوصية، تواصل معنا على: privacy@mishwar.ps"
        },
      ].map(s => (
        <div key={s.title} className="mb-6">
          <h2 className="text-lg font-bold text-foreground mb-2">{s.title}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">{s.body}</p>
        </div>
      ))}
    </div>
  );
}
