import React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import SEO from "@/lib/seo/SEO";
import SeoLandingLayout from "./SeoLandingLayout";

/**
 * DynamicSeoPage — renders any /cities/:slug or /routes/:slug page from the
 * `seo_pages` Supabase table. Replaces the 10 hardcoded React components so
 * admins can edit content from the dashboard without code deploys.
 *
 * URL strategy:
 *   - /cities/ramallah  →  fetches WHERE slug='ramallah' AND page_type='city'
 *   - /routes/ramallah-nablus → fetches WHERE slug='ramallah-nablus' AND page_type='route'
 *
 * Caching:
 *   - 5-minute stale time. Edits in the admin dashboard reflect on the live
 *     site within 5 minutes for users who already had the page loaded;
 *     instantly for first-time loads.
 *
 * Fallback:
 *   - If DB is unreachable or row is missing/unpublished, renders a friendly
 *     404-style message instead of crashing the SPA.
 */
export default function DynamicSeoPage({ pageType }) {
  const { slug } = useParams();

  const { data: page, isLoading, isError } = useQuery({
    queryKey: ["seo-page", pageType, slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seo_pages")
        .select("*")
        .eq("slug", slug)
        .eq("page_type", pageType)
        .eq("is_published", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center text-muted-foreground" dir="rtl">
        جاري التحميل...
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center" dir="rtl">
        <h1 className="text-2xl font-bold text-foreground mb-3">الصفحة غير موجودة</h1>
        <p className="text-muted-foreground">يبدو أن هذه الصفحة لم تعد متاحة. عد إلى الصفحة الرئيسية لاستكشاف الرحلات.</p>
      </div>
    );
  }

  return (
    <>
      <SEO
        title={page.title}
        description={page.meta_description || page.subtitle || ""}
        path={pageType === "city" ? `/cities/${slug}` : `/routes/${slug}`}
        keywords={page.keywords || []}
        breadcrumbs={page.breadcrumbs || []}
        faq={page.faq || []}
      />
      <SeoLandingLayout
        title={page.title}
        subtitle={page.subtitle}
        intro={page.intro}
        sections={page.sections || []}
        related={page.related_links || []}
        breadcrumbs={page.breadcrumbs || []}
        searchLink={page.search_link || "/search"}
      >
        {Array.isArray(page.faq) && page.faq.length > 0 && (
          <section className="mt-10">
            <h2 className="text-2xl font-bold text-foreground mb-4">أسئلة شائعة</h2>
            <div className="space-y-3">
              {page.faq.map((item, i) => (
                <details key={i} className="bg-card border border-border rounded-xl p-4 group">
                  <summary className="font-semibold text-foreground cursor-pointer list-none flex items-center justify-between gap-2">
                    <span>{item.q}</span>
                    <span className="text-primary group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <p className="mt-3 text-foreground/80 leading-relaxed whitespace-pre-wrap">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}
      </SeoLandingLayout>
    </>
  );
}
