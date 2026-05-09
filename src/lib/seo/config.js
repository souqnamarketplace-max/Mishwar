/**
 * Central SEO configuration for مشوارو.
 *
 * Single source of truth for:
 *   - SITE_URL         — canonical base, env-flippable when domain lands
 *   - DEFAULT_OG_IMAGE — fallback OpenGraph image
 *   - SITE_NAME        — brand name (Arabic + Latin)
 *   - DEFAULT_LOCALE   — used in OpenGraph and html lang
 *
 * The canonical URL system depends on SITE_URL being right. When you
 * register the production domain (e.g. mishwaro.com), set the env var
 * VITE_SITE_URL on Vercel — every <SEO> tag, sitemap entry, JSON-LD
 * url field, and OpenGraph URL will pick it up on the next deploy.
 *
 * Rationale for env var rather than constant:
 *   - SEO requires the SAME absolute URL everywhere (canonical, og:url,
 *     sitemap loc, JSON-LD url). Hardcoding mishwar-nu.vercel.app means
 *     the domain change becomes a multi-file find-and-replace with high
 *     chance of missing one. env var = one place, zero risk.
 *   - Local dev gets http://localhost:5173 automatically (no SEO tags
 *     pointing to production for in-progress work).
 */

// Vite exposes import.meta.env at build time. The fallback chain:
//   1. VITE_SITE_URL env var — set on Vercel when the real domain lands
//   2. window.location.origin — runtime fallback for local dev / preview
//   3. mishwar-nu.vercel.app — last-resort default
const ENV_SITE_URL = import.meta.env.VITE_SITE_URL;
const RUNTIME_ORIGIN = (typeof window !== "undefined" && window.location?.origin) || null;

export const SITE_URL =
  (ENV_SITE_URL && stripTrailingSlash(ENV_SITE_URL)) ||
  RUNTIME_ORIGIN ||
  "https://mishwar-nu.vercel.app";

function stripTrailingSlash(s) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export const SITE_NAME = "مشوارو";
export const SITE_NAME_LATIN = "Mishwaro";
export const DEFAULT_LOCALE = "ar_PS";
export const DEFAULT_OG_IMAGE = "/og-image.png"; // 1200x630, in public/

// Default Arabic description used when a page doesn't supply its own.
// Should be 150-160 chars to fit Google snippet without truncation.
export const DEFAULT_DESCRIPTION =
  "منصة فلسطينية لمشاركة رحلات السيارة بين المدن. سافر بأمان، وفر المال، واحجز مقعدك في ثوانٍ. رام الله، نابلس، الخليل، بيت لحم، القدس وأكثر.";

// Default Arabic keywords. Note: Google long ago stopped using the
// keywords meta for ranking, but Bing and Yandex still consult it,
// and it's harmless. Targeted to Palestinian rideshare niche.
export const DEFAULT_KEYWORDS = [
  "مشاركة رحلات فلسطين",
  "مشاوير فلسطين",
  "رام الله نابلس",
  "مواصلات فلسطين",
  "تنقل بين المدن",
  "رحلات مشتركة",
  "كاربولينج فلسطين",
  "carpooling palestine",
];

/**
 * Build a canonical absolute URL from a relative path.
 *   absoluteUrl("/routes/ramallah-nablus")
 *     → "https://mishwar-nu.vercel.app/routes/ramallah-nablus"
 */
export function absoluteUrl(path = "") {
  if (!path) return SITE_URL;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean}`;
}
