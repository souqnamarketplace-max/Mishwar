import React from "react";
import SEO from "@/lib/seo/SEO";
import SeoLandingLayout from "./SeoLandingLayout";

/** /routes/hebron-jerusalem — SEO landing page. */
export default function RouteHebronJerusalem() {
  const breadcrumbs = [
    { name: "الرئيسية", path: "/" },
    { name: "المسارات", path: "/" },
    { name: "الخليل ← القدس", path: "/routes/hebron-jerusalem" },
  ];

  const faq = [
    {
      q: "كم يستغرق المشوار من الخليل إلى القدس؟",
      a: "تبعد الخليل عن القدس حوالي 35 كم جنوباً، والرحلة عادةً بين 50 دقيقة وساعة وربع حسب حركة المرور والحواجز.",
    },
    {
      q: "ما هو السعر التقريبي؟",
      a: "يبدأ سعر المقعد المشترك من 25-35 شيكل، أرخص بنسبة 50-70% من التاكسي الخاص الذي قد يصل إلى 100-150 شيكل.",
    },
    {
      q: "هل تعمل خدمة مشوارو في الخليل؟",
      a: "نعم. نغطي الخليل وريفها، بما في ذلك بيت أمر، حلحول، وعدد من القرى المحيطة. ابحث عن رحلتك من صفحة البحث وستظهر لك جميع الرحلات المتاحة.",
    },
    {
      q: "هل أحتاج تصريح دخول للقدس؟",
      a: "إذا كنت تحمل هوية الضفة، نعم — وفقاً للقوانين السارية. السائقون عادةً يكونون على دراية بمسارات الحواجز الأنسب.",
    },
  ];

  return (
    <>
      <SEO
        title="رحلات الخليل — القدس"
        description="ابحث عن رحلات مشتركة من الخليل إلى القدس بأسعار تبدأ من 25 شيكل. سائقون موثَّقون، حجز فوري، تواصل عبر التطبيق."
        path="/routes/hebron-jerusalem"
        keywords={["رحلات الخليل القدس", "مشوار الخليل", "تكسي الخليل القدس", "نقل الخليل القدس"]}
        breadcrumbs={breadcrumbs}
        faq={faq}
      />
      <SeoLandingLayout
        title="رحلات الخليل — القدس"
        subtitle="الخليل أكبر مدن جنوب الضفة الغربية. شارك مشوارك إلى القدس واختصر التكلفة والمشقة."
        searchLink="/search?from=الخليل&to=القدس"
        breadcrumbs={breadcrumbs}
        intro={
`الخليل ثاني أكبر مدن الضفة الغربية بعد رام الله من حيث عدد السكان، وتشهد حركة تنقل يومية ضخمة باتجاه القدس للعمل، الدراسة، والعلاج الطبي. مشوارو يربط أهالي الخليل بسائقين منظَّمين متجهين شمالاً، بأسعار معقولة وشفافة.

الرحلة المشتركة على مشوارو أرخص بكثير من التاكسي الخاص، وأكثر مرونة من الباصات. تحجز مقعدك من خلال التطبيق، تتواصل مع السائق عبر الرسائل المضمَّنة، وتدفع نقداً عند الركوب — لا عمولات مخفية، لا مفاجآت في السعر.`
        }
        sections={[
          {
            heading: "محطات شائعة في الخليل",
            body:
`أكثر نقاط الانطلاق نشاطاً في الخليل: باب الزاوية، الشلاله، عين سارة، شارع عين خير الدين، حلحول، وبيت أمر. كل سائق يحدد نقطة انطلاقه بدقة عند نشر الرحلة، فتختار ما يناسبك.

إذا كنت قادماً من بلدة محيطة كدورا، يطا، أو الظاهرية، يمكنك الاتفاق مع السائق مسبقاً على نقطة لقاء على الطريق الرئيسي.`,
          },
          {
            heading: "موعد الرحلات وكثافتها",
            body:
`أكثر الأوقات نشاطاً: الصباح الباكر من 06:00-08:00 (للموظفين والطلاب)، والمساء من 16:00-19:00 (رحلات العودة). الرحلات بين هذه الأوقات أقل عدداً لكن متوفرة.

إذا كنت تحتاج رحلة في وقت غير معتاد، استخدم خدمة "اطلب رحلة" لتنشر طلبك ويتواصل معك سائق مناسب.`,
          },
        ]}
        related={[
          { label: "رحلات القدس — بيت لحم",  path: "/routes/jerusalem-bethlehem" },
          { label: "رحلات رام الله — نابلس",  path: "/routes/ramallah-nablus" },
          { label: "كيف يعمل مشوارو؟",         path: "/how-it-works" },
          { label: "السلامة والأمان",          path: "/safety" },
        ]}
      >
        <section className="mt-10">
          <h2 className="text-2xl font-bold text-foreground mb-4">أسئلة شائعة</h2>
          <div className="space-y-3">
            {faq.map((item, i) => (
              <details key={i} className="bg-card border border-border rounded-xl p-4 group">
                <summary className="font-semibold text-foreground cursor-pointer list-none flex items-center justify-between gap-2">
                  <span>{item.q}</span>
                  <span className="text-primary group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="mt-3 text-foreground/80 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </SeoLandingLayout>
    </>
  );
}
