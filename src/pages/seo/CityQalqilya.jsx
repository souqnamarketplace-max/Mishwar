import React from "react";
import SEO from "@/lib/seo/SEO";
import SeoLandingLayout from "./SeoLandingLayout";

export default function CityQalqilya() {
  const breadcrumbs = [
    { name: "الرئيسية", path: "/" },
    { name: "المدن",     path: "/" },
    { name: "قلقيلية",   path: "/cities/qalqilya" },
  ];

  const faq = [
    { q: "ما أكثر الوجهات من قلقيلية؟", a: "نابلس، طولكرم، رام الله، وسلفيت. الرحلات تتوفر يومياً." },
    { q: "كم سعر رحلة قلقيلية — نابلس؟", a: "بين ٢٥ و٤٠ شيكل للمقعد على مسافة ٤٥ كم." },
    { q: "هل تتوفر رحلات لرام الله؟", a: "نعم، رحلات يومية تستغرق ٦٠-٨٠ دقيقة. السعر ٣٠-٤٥ شيكل." },
  ];

  return (
    <>
      <SEO
        title="رحلات من قلقيلية — مشاركة السيارات في فلسطين"
        description="رحلات يومية من قلقيلية إلى نابلس، طولكرم، رام الله، وسلفيت. سائقون موثَّقون وأسعار شفافة."
        path="/cities/qalqilya"
        keywords={["رحلات قلقيلية","مشاوير قلقيلية","من قلقيلية إلى نابلس","carpool Qalqilya"]}
        breadcrumbs={breadcrumbs}
        faq={faq}
      />
      <SeoLandingLayout
        title="رحلات من قلقيلية"
        subtitle="قلقيلية، مدينة فلسطينية غرب الضفة. رحلات يومية إلى نابلس، طولكرم، ورام الله بأسعار شفافة."
        searchLink="/search?from=قلقيلية"
        breadcrumbs={breadcrumbs}
        intro={
`قلقيلية مدينة فلسطينية في غرب الضفة الغربية، مركز زراعي وتجاري حيوي. مشوارو يربط قلقيلية بمدن الضفة الرئيسية عبر مشاركة الرحلات اليومية. السائقون موثَّقون، الأسعار شفافة، والحجز فوري بدون عمولة.`
        }
        sections={[
          {
            heading: "أكثر المسارات شعبية من قلقيلية",
            body:
`**قلقيلية — نابلس** (٤٥ كم شرقاً، ٥٠-٦٥ دقيقة): الأكثر طلباً. السعر ٢٥-٤٠ شيكل.

**قلقيلية — طولكرم** (٢٥ كم شمالاً، ٣٠-٤٠ دقيقة): مسار يومي. السعر ١٥-٢٥ شيكل.

**قلقيلية — رام الله** (٦٠ كم جنوب شرق، ٦٠-٨٠ دقيقة): مسار شائع. السعر ٣٠-٤٥ شيكل.

**قلقيلية — سلفيت** (٢٠ كم جنوب شرق، ٣٠ دقيقة): مسار قصير ومتوفر. السعر ١٥-٢٥ شيكل.`,
          },
          {
            heading: "نصائح للمسافرين",
            body:
`**احجز رحلات الصباح مسبقاً**: للعاملين والطلاب، الرحلات الصباحية مطلوبة جداً.

**استخدم نظام الرسائل**: لتأكيد نقطة اللقاء في قلقيلية بدقة قبل الانطلاق.

**اقرأ تقييمات السائق**: لاختيار تجربة أفضل وأكثر أماناً.`,
          },
        ]}
        related={[
          { label: "رحلات نابلس",       path: "/cities/nablus" },
          { label: "رحلات طولكرم",      path: "/cities/tulkarm" },
          { label: "رحلات رام الله",    path: "/cities/ramallah" },
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
