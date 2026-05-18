import { useEffect } from "react";
import {
  SITE_URL,
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  absoluteUrl,
} from "@/lib/seo/config";

/**
 * useSEO — set per-page SEO via direct DOM mutation.
 *
 * This hook predates the <SEO /> react-helmet-async component and
 * is still used by 11+ pages with a stable call signature:
 *
 *   useSEO({
 *     title:       string,         // appended as "{title} | مشوارو"
 *     description: string,
 *     canonical?:  string,         // absolute URL — auto-built if omitted
 *     ogImage?:    string,         // absolute URL or path
 *     jsonLd?:     object | null,  // structured data, replaces id=page-jsonld
 *   });
 *
 * Why keep this alongside <SEO />:
 *   - Many pages already call useSEO and changing them all in one PR
 *     is too much surface change.
 *   - For pages that need richer features (breadcrumbs, FAQ schema,
 *     custom JSON-LD blocks), use <SEO /> in the JSX instead.
 *   - Both can coexist on the same page — useSEO mutates the DOM, helmet
 *     manages its own dedup, and the last-write wins per attribute.
 *
 * Improvements over the original:
 *   - canonical now auto-builds from window.location.pathname against
 *     SITE_URL (env-driven), so we get correct canonical URLs on every
 *     page without callers having to pass them
 *   - ogImage is auto-resolved to an absolute URL via absoluteUrl()
 *   - og:url and twitter:url updates use the resolved canonical, never
 *     the raw window.location.href (which would carry query strings into
 *     canonicals — bad for SEO dedup)
 *   - Cleanup-safe: if a component unmounts, we don't leave stale tags
 *     because every render writes the new values, and the next route's
 *     useSEO call overwrites.
 */
export function useSEO({ title, description, canonical, ogImage, jsonLd, noindex }) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} — شارك الطريق، وفر أكثر`;
    document.title = fullTitle;

    const desc = description || DEFAULT_DESCRIPTION;

    // Helper: upsert a meta tag (creates if missing, updates if present).
    const upsertMeta = (selector, attr, attrValue, content) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, attrValue);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    // Description
    upsertMeta('meta[name="description"]', "name", "description", desc);

    // ─── Robots / indexability control ───────────────────────────────
    //
    // When a page renders an error / empty / not-found state and the
    // calling component knows it shouldn't be indexed, it passes
    // noindex: true. We then INSERT a <meta name="robots"
    // content="noindex,nofollow"> tag — and REMOVE it on the next
    // render that doesn't pass noindex (so navigating from a
    // not-found state back to a valid page doesn't leave the meta
    // accidentally stuck).
    //
    // This is the SPA-side companion to the /api/trip server-side
    // 404+noindex fix. /api/trip handles the initial HTML response
    // (what Googlebot sees on first crawl); useSEO handles in-app
    // navigation where the user clicks into a page that turns out
    // to be empty (e.g. a deleted trip, missing profile, expired
    // request).
    //
    // Google policy: noindex,nofollow on a 200 OK page is the second-
    // best signal after a hard 404/410. Combined with the SPA's
    // 'trip not found' visible message, it gives Googlebot a clear
    // dismiss-this-URL signal.
    let robotsEl = document.querySelector('meta[name="robots"]');
    if (noindex) {
      if (!robotsEl) {
        robotsEl = document.createElement("meta");
        robotsEl.setAttribute("name", "robots");
        document.head.appendChild(robotsEl);
      }
      robotsEl.setAttribute("content", "noindex,nofollow");
    } else if (robotsEl) {
      // Cleanup: drop the meta on pages that ARE indexable. Without
      // this, a noindex stamped by a previous render would persist
      // through navigation and silently de-index reachable pages.
      robotsEl.remove();
    }

    // Canonical — auto-build from pathname if not explicitly passed.
    // Use pathname only (no query, no hash) so /search?from=X and
    // /search?from=Y don't compete in the index.
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    const resolvedCanonical = canonical || absoluteUrl(path);
    let linkEl = document.querySelector('link[rel="canonical"]');
    if (!linkEl) {
      linkEl = document.createElement("link");
      linkEl.setAttribute("rel", "canonical");
      document.head.appendChild(linkEl);
    }
    linkEl.setAttribute("href", resolvedCanonical);

    // OpenGraph
    upsertMeta('meta[property="og:title"]',       "property", "og:title",       fullTitle);
    upsertMeta('meta[property="og:description"]', "property", "og:description", desc);
    upsertMeta('meta[property="og:url"]',         "property", "og:url",         resolvedCanonical);

    const resolvedOgImage = ogImage
      ? (ogImage.startsWith("http") ? ogImage : absoluteUrl(ogImage))
      : absoluteUrl(DEFAULT_OG_IMAGE);
    upsertMeta('meta[property="og:image"]', "property", "og:image", resolvedOgImage);

    // Twitter
    upsertMeta('meta[name="twitter:title"]',       "name", "twitter:title",       fullTitle);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", desc);
    upsertMeta('meta[name="twitter:image"]',       "name", "twitter:image",       resolvedOgImage);

    // ─── Per-page JSON-LD ───────────────────────────────────────────
    // Single <script id="page-jsonld"> slot, replaced on every route
    // change. The 3 site-level JSON-LD blocks in index.html (WebSite,
    // Organization, MobileApplication) stay put — Google accepts
    // multiple blocks per page, no conflict.
    let pageLdEl = document.querySelector('script#page-jsonld');
    if (jsonLd) {
      const payload = JSON.stringify(jsonLd);
      if (!pageLdEl) {
        pageLdEl = document.createElement("script");
        pageLdEl.setAttribute("type", "application/ld+json");
        pageLdEl.setAttribute("id", "page-jsonld");
        document.head.appendChild(pageLdEl);
      }
      if (pageLdEl.textContent !== payload) pageLdEl.textContent = payload;
    } else if (pageLdEl) {
      pageLdEl.remove();
    }
  }, [title, description, canonical, ogImage, JSON.stringify(jsonLd), noindex]);
}
