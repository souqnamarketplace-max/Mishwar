import { useEffect } from "react";

/**
 * Set document title and meta description per page, plus optionally inject
 * a JSON-LD structured data block. Call inside any page component.
 *
 * @example
 * useSEO({
 *   title: "البحث عن رحلة",
 *   description: "ابحث عن رحلات بين المدن الفلسطينية",
 *   jsonLd: { "@context": "https://schema.org", "@type": "Trip", ... },
 * });
 *
 * jsonLd is keyed under <script id="page-jsonld"> and replaced/removed on
 * route change so each page's structured data doesn't accumulate.
 */
export function useSEO({ title, description, canonical, ogImage, jsonLd }) {
  useEffect(() => {
    const fullTitle = title ? `${title} | مشوارو` : "مشوارو — شارك الطريق، وفر أكثر";
    document.title = fullTitle;

    // Update meta description
    if (description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement("meta");
        metaDesc.setAttribute("name", "description");
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute("content", description);
    }

    // Update OG title
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", fullTitle);

    // Update OG description
    if (description) {
      let ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute("content", description);
    }

    // Update canonical
    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", canonical);
    }

    // Update OG image
    if (ogImage) {
      let ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) ogImg.setAttribute("content", ogImage);
    }

    // Update OG URL
    const currentUrl = canonical || window.location.href;
    let ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute("content", currentUrl);

    // Update Twitter desc
    if (description) {
      let twDesc = document.querySelector('meta[name="twitter:description"]');
      if (twDesc) twDesc.setAttribute("content", description);
      let twTitle = document.querySelector('meta[name="twitter:title"]');
      const ft = title ? `${title} | مشوارو` : "مشوارو — شارك الطريق، وفر أكثر";
      if (twTitle) twTitle.setAttribute("content", ft);
    }

    // ─── Per-page JSON-LD structured data ────────────────────────────────
    // Inject (or update) a <script type="application/ld+json"> with a
    // stable id="page-jsonld". Replacing on every render ensures route
    // changes update the schema; passing jsonLd=null/undefined removes it
    // so old pages' structured data doesn't leak into new ones.
    //
    // Note: the 3 site-level structured data blocks in index.html
    // (WebSite, Organization, MobileApplication) stay put and are
    // harmless duplicates if the page also emits its own — search engines
    // accept multiple JSON-LD blocks per page.
    let pageLdEl = document.querySelector('script#page-jsonld');
    if (jsonLd) {
      const payload = JSON.stringify(jsonLd);
      if (!pageLdEl) {
        pageLdEl = document.createElement("script");
        pageLdEl.setAttribute("type", "application/ld+json");
        pageLdEl.setAttribute("id", "page-jsonld");
        document.head.appendChild(pageLdEl);
      }
      // Only update text content if it actually changed (avoids triggering
      // unnecessary re-parses by some crawlers / dev-tools observers).
      if (pageLdEl.textContent !== payload) pageLdEl.textContent = payload;
    } else if (pageLdEl) {
      pageLdEl.remove();
    }
  }, [title, description, canonical, ogImage, JSON.stringify(jsonLd)]);
}
