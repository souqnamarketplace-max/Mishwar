/**
 * <SEO /> — per-route metadata component.
 *
 * Drop this at the top of any page component to set <title>, meta
 * description, canonical, OpenGraph, Twitter, and (optionally)
 * JSON-LD. Without it, the page inherits the homepage tags from
 * index.html — fine for SPA shell rendering, bad for Google.
 *
 * Usage:
 *   import SEO from "@/lib/seo/SEO";
 *   ...
 *   return (
 *     <>
 *       <SEO
 *         title="كيف يعمل مشوارو؟"
 *         description="دليل مبسّط لاستخدام منصة مشوارو..."
 *         path="/how-it-works"
 *         breadcrumbs={[{ name: "الرئيسية", path: "/" }, { name: "كيف يعمل", path: "/how-it-works" }]}
 *       />
 *       <main>...</main>
 *     </>
 *   );
 *
 * Why react-helmet-async (not raw document.title):
 *   - Async-safe: SSR-friendly if we later add prerendering
 *   - Manages meta tag dedup (a page that re-renders 10x doesn't
 *     leave 10 duplicate <title> in the head)
 *   - Lets multiple components contribute to the head without
 *     clobbering each other (the OG tags here merge with the static
 *     ones in index.html cleanly)
 *
 * Title behavior:
 *   - Pass `title` only → renders as "%s | مشوارو" via title template
 *   - Pass `titleFull` to override the template entirely (rare,
 *     e.g. for the homepage which uses brand-first format)
 */

import React from "react";
import { Helmet } from "react-helmet-async";
import {
  SITE_URL,
  SITE_NAME,
  DEFAULT_LOCALE,
  DEFAULT_OG_IMAGE,
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  absoluteUrl,
} from "./config";

export default function SEO({
  title,
  titleFull,
  description = DEFAULT_DESCRIPTION,
  // Path is the canonical for this page. Pass the route path
  // (e.g. "/how-it-works"). For dynamic pages use the actual
  // resolved path including params.
  path = "",
  // Extra keywords merged with site defaults. Brand-niche queries
  // often won't be in the global list (e.g. specific city pairs).
  keywords = [],
  // OG image override. If a page has a hero image worth featuring
  // in social previews, pass it here. Defaults to /og-image.png.
  ogImage = DEFAULT_OG_IMAGE,
  // og:type — "website" for landing/info pages, "article" for blog
  // posts, "profile" for user public pages.
  ogType = "website",
  // Optional breadcrumb trail. Renders BreadcrumbList JSON-LD which
  // Google uses to show breadcrumbs in search results.
  breadcrumbs,
  // Optional FAQ items. Renders FAQPage JSON-LD which can earn the
  // "People also ask" rich snippet on the SERP. Each item: {q, a}.
  faq,
  // Optional additional JSON-LD blocks. Pass an object or array of
  // objects — they'll be serialized into <script type="application/ld+json">.
  jsonLd,
  // If true, set robots to noindex,nofollow. Use for thin/preview
  // pages we don't want in the index.
  noIndex = false,
}) {
  const canonical = absoluteUrl(path);
  const fullTitle = titleFull || (title ? `${title} | ${SITE_NAME}` : SITE_NAME);
  const ogImageAbsolute = ogImage?.startsWith("http") ? ogImage : absoluteUrl(ogImage);
  const allKeywords = [...new Set([...DEFAULT_KEYWORDS, ...keywords])];

  // Build BreadcrumbList JSON-LD if breadcrumbs provided.
  // Required by Google: each item needs name, position (1-indexed),
  // and item (absolute URL).
  const breadcrumbLd = breadcrumbs?.length
    ? {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs.map((b, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: b.name,
          item: absoluteUrl(b.path),
        })),
      }
    : null;

  // Build FAQPage JSON-LD if FAQ items provided. Each Q is a
  // schema.org Question, each A is an Answer with the answer text.
  const faqLd = faq?.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.a,
          },
        })),
      }
    : null;

  // Normalize jsonLd to array.
  const extraJsonLd = jsonLd
    ? Array.isArray(jsonLd) ? jsonLd : [jsonLd]
    : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={allKeywords.join(", ")} />
      <link rel="canonical" href={canonical} />

      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* OpenGraph — for Facebook, WhatsApp, Telegram, LinkedIn link previews */}
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonical} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={ogImageAbsolute} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:locale" content={DEFAULT_LOCALE} />

      {/* Twitter — supports a slightly different shape than OG */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImageAbsolute} />

      {/* JSON-LD blocks — each script tag can hold ONE object.
          react-helmet-async serializes children of <script> as text. */}
      {breadcrumbLd && (
        <script type="application/ld+json">
          {JSON.stringify(breadcrumbLd)}
        </script>
      )}
      {faqLd && (
        <script type="application/ld+json">
          {JSON.stringify(faqLd)}
        </script>
      )}
      {extraJsonLd.map((block, i) => (
        <script key={`ld-${i}`} type="application/ld+json">
          {JSON.stringify(block)}
        </script>
      ))}
    </Helmet>
  );
}
