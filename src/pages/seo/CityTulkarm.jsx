import React from "react";
import SEO from "@/lib/seo/SEO";
import SeoLandingLayout from "./SeoLandingLayout";

export default function CityTulkarm() {
  const breadcrumbs = [
    { name: "الرئيسية", path: "/" },
    { name: "المدن",     path: "/" },
    { name: "طولكرم",    path: "/cities/tulkarm" },
  ];

  const faq = [
    { q: "ما أكثر الوجهات من طولكرم؟", a: "نابلس، قلقيلية، جنين، ورام الله. الرحلات اليومية متوفرة بكثافة عالية." },
    { q: "كم سعر رحلة طولكرم — نابلس؟", a: "بين ١٨ و٣٠ شيكل للمقعد على مسافة ٣٠ كم." },
    { q: "هل أجد رحلات صباحية؟", a: "نعم، عشرات الرحلات بين ٦:٣٠ و٩ صباحاً للعاملين والطلاب." },
  ];

  return (
    <>
      <SEO
        title="رحلات من طولكرم — مشاركة سيارات في فلسطين"
        description="رحلات يومية من طولكرم إلى نابلس، قلقيلية، جنين، ورام الله. سائقون موثَّقون وأسعار شفافة."
        path="/cities/tulkarm"
        keywords={["رحلات طولكرم","مشاوير طولكرم","من طولكرم إلى نابلس","carpool Tulkarm"]}
        breadcrumbs={breadcrumbs}
        faq={faq}
      />
      <SeoLandingLayout
        title="رحلات من طولكرم"
        subtitle="طولكرم، مدينة فلسطينية شمال الضفة. رحلات يومية إلى نابلس، قلقيلية، جنين، ورام الله بأسعار شفافة."
        searchLink="/search?from=طولكرم"
        breadcrumbs={breadcrumbs}
        intro={
`طولكرم مدينة فلسطينية في شمال الضفة الغربية، تشكّل نقطة تجمع حيوية بين الجامعات والمراكز التجارية في الشمال. مشوارو يربط طولكرم بنابلس وقلقيلية ورام الله عبر مشاركة الرحلات اليومية. السائقون موثَّقون، الأسعار شفافة، والحجز فوري.`
        }
        sections={[
          {
            heading: "أكثر المسارات شعبية من طولكرم",
            body:
`**طولكرم — نابلس** (٣٠ كم شرقاً، ٣٥-٤٥ دقيقة): الأكثر طلباً. السعر ١٨-٣٠ شيكل.

**طولكرم — قلقيلية** (٢٥ كم جنوباً، ٣٠-٤٠ دقيقة): مسار يومي شائع. السعر ١٥-٢٥ شيكل.

**طولكرم — جنين** (٣٥ كم شمال شرق، ٤٠-٥٠ دقيقة): متوفر يومياً. السعر ١٨-٣٠ شيكل.

**طولكرم — رام الله** (٧٠ كم جنوب شرق، ٩٠-١١٠ دقيقة): مسار طويل لكنه نشط. السعر ٣٥-٥٠ شيكل.`,
          },
          {
            heading: "نصائح للمسافرين",
            body:
`**احجز رحلات الصباح مسبقاً**: لطلاب الجامعة والعاملين، احجز قبل بـ ١-٢ ساعة.

**اقرأ تقييمات السائق**: المنصة شفافة عن تقييمات السائقين. اختر بتقييم ٤.٥+.

**فعّل إشعارات المسارات المعتادة**: لتصلك تنبيهات عن الرحلات الجديدة على مسارك اليومي.`,
          },
        ]}
        related={[
          { label: "رحلات نابلس",       path: "/cities/nablus" },
          { label: "رحلات قلقيلية",     path: "/cities/qalqilya" },
          { label: "رحلات جنين",        path: "/cities/jenin" },
          { label: "كيف يعمل مشوارو؟",  path: "/how-it-works" },
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
