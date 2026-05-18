/**
 * Vercel Serverless Function — /api/trip?id=:id
 *
 * Fetches trip data server-side and injects dynamic Open Graph meta tags
 * so sharing links on WhatsApp, Telegram, Twitter, Facebook etc. shows
 * real trip info (route, price, driver, date) instead of generic app title.
 *
 * Human users get the same page with the full React app bundled in.
 * Bot crawlers read the OG meta tags from the server-rendered <head>.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { rateLimit } from "./_rate-limit.js";

// Configuration. SUPA_URL and SUPA_KEY are required at runtime; the
// previous version of this file shipped a hardcoded anon-key fallback
// which made credential rotation a code change. Now we fail loud and
// continue serving the SPA without OG enrichment if the env is missing,
// instead of silently using a baked-in key.
const SUPA_URL = process.env.VITE_SUPABASE_URL || "";
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const APP_URL  = process.env.VITE_APP_URL || "https://www.mishwaro.com";

// Palestinian cities → Arabic weekday dates helper
function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" });
  } catch { return dateStr; }
}

// Safe HTML attribute escape
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Read built index.html (available after `npm run build`)
function getIndexHtml() {
  try {
    return readFileSync(join(process.cwd(), "dist", "index.html"), "utf-8");
  } catch {
    // Fallback: minimal shell that loads the SPA
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>مشوارو</title></head><body><div id="root"></div></body></html>`;
  }
}

// Inject or replace a <meta> tag in HTML
function setMeta(html, attr, attrVal, contentVal) {
  const escaped = esc(contentVal);
  const re = new RegExp(`<meta\\s+${attr}="${attrVal}"[^>]*>`, "i");
  if (re.test(html)) {
    return html.replace(re, `<meta ${attr}="${attrVal}" content="${escaped}" />`);
  }
  // Not found — insert before </head>
  return html.replace("</head>", `<meta ${attr}="${attrVal}" content="${escaped}" />\n</head>`);
}

// Specialized helper for the robots meta tag.
//
// The static index.html ships with <meta name="robots" content="index, follow" />
// as the default for marketing pages. When this endpoint detects a missing
// trip and wants to mark the response noindex, naïvely appending a SECOND
// <meta name="robots"> leaves both tags in the response:
//
//   <meta name="robots" content="index, follow" />
//   <meta name="robots" content="noindex,nofollow" />
//
// Google docs say the most restrictive directive wins, so the page still
// gets deindexed. But:
//   - Search Console URL Inspection flags 'multiple robots tags' as a
//     warning
//   - Less strict crawlers (some Bing versions, Yandex, smaller crawlers
//     used by SEO tools) take the FIRST tag and ignore the rest, so
//     the page would appear indexable to them
//   - Manual code review is confused by the conflicting signal
//
// Fix: regex-replace the existing tag (case-insensitive) BEFORE the
// insert-before-</head> fallback fires. This guarantees a single
// <meta name="robots"> tag in the response, with our desired value.
function setRobotsMeta(html, content) {
  const escaped = esc(content);
  const re = /<meta\s+name="robots"[^>]*>/i;
  if (re.test(html)) {
    return html.replace(re, `<meta name="robots" content="${escaped}" />`);
  }
  return html.replace("</head>", `<meta name="robots" content="${escaped}" />\n</head>`);
}

export default async function handler(req, res) {
  // Rate limit per-IP. 60 requests/minute is generous for a real
  // user clicking around, but blocks scraper / retry-storm patterns.
  // See api/_rate-limit.js for caveats (per-instance, in-memory).
  if (!rateLimit(req, res, { max: 60, windowMs: 60_000, keyPrefix: "trip:" })) {
    return;
  }

  const { id: rawId } = req.query;

  // Detect whether `id` is a UUID or a slug ending in 6-char short_code.
  // UUID pattern: 8-4-4-4-12 hex.
  // Slug pattern: anything ending in `-{6 alphanumerics}` after at least
  // one earlier hyphen-separated segment.
  // Anything else is invalid → fall through to SPA shell.
  let lookupCol = null;
  let lookupVal = null;
  if (rawId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
    lookupCol = "id";
    lookupVal = rawId.toLowerCase();
  } else if (rawId) {
    const segs = rawId.split("-");
    const last = segs[segs.length - 1];
    if (last && /^[0-9A-Za-z]{6}$/.test(last) && segs.length >= 2) {
      lookupCol = "short_code";
      lookupVal = last;
    }
  }

  if (!lookupCol || !lookupVal) {
    // Invalid ID format — return 404 with noindex meta so Google won't
    // index this as a thin/duplicate page. Returning 200 here caused
    // Google Search Console to flag these as "Soft 404" (HTTP success
    // status but thin content with no real article).
    //
    // setRobotsMeta REPLACES the existing <meta name="robots"
    // content="index, follow"> shipped in index.html, rather than
    // appending a second one. Conflicting robots metas caused
    // crawler-dependent behavior — most respected the more restrictive
    // 'noindex' but some indexed anyway.
    const html = setRobotsMeta(getIndexHtml(), "noindex,nofollow");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(404).send(html);
  }

  // If Supabase env is unset (e.g., a preview deploy missing vars), serve
  // the SPA without OG enrichment instead of hitting a hardcoded fallback.
  if (!SUPA_URL || !SUPA_KEY) {
    const html = getIndexHtml();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  }

  // Fetch trip from Supabase REST API (no SDK, pure fetch). Looks up by
  // either trips.id (UUID URLs) or trips.short_code (slug URLs).
  let trip = null;
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/trips?${lookupCol}=eq.${encodeURIComponent(lookupVal)}&select=from_city,to_city,price,date,time,available_seats,driver_name,driver_gender,driver_rating,status,distance,car_model&limit=1`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    const rows = await r.json();
    trip = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) {
    // Supabase fetch failed — serve SPA anyway
  }

  // Read the built index.html
  let html = getIndexHtml();

  if (trip) {
    const from    = trip.from_city || "";
    const to      = trip.to_city   || "";
    const price   = trip.price     || "";
    const date    = formatDate(trip.date);
    const seats   = trip.available_seats || 0;
    const driver  = trip.driver_name || "سائق";
    const isFem   = trip.driver_gender === "female";
    const rating  = trip.driver_rating ? `⭐ ${Number(trip.driver_rating).toFixed(1)}` : "";
    const dist    = trip.distance ? ` · ${trip.distance}` : "";

    const title   = `رحلة من ${from} إلى ${to} 🚗 | مشوارو`;
    const desc    = [
      `₪${price} للمقعد`,
      date,
      seats > 0 ? `${seats} مقاعد متاحة` : "الرحلة ممتلئة",
      `السائق${isFem ? "ة" : ""}: ${driver}${rating ? " " + rating : ""}`,
      dist,
    ].filter(Boolean).join(" · ");

    const ogImage = `${APP_URL}/og-trip-placeholder.png`; // static placeholder
    // tripUrl uses the original URL form (UUID or slug) the visitor hit.
    // For canonical SEO consolidation the rendered <link rel="canonical">
    // and <meta property="og:url"> always point to whatever was in the
    // URL — the React app handles the silent redirect to slug form
    // client-side after hydration. Using the request param avoids
    // building a slug server-side (we don't have the slug helper here).
    const tripUrl = `${APP_URL}/trip/${rawId}`;

    // Inject title
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);

    // OG meta tags
    html = setMeta(html, "property", "og:title",       title);
    html = setMeta(html, "property", "og:description", desc);
    html = setMeta(html, "property", "og:url",         tripUrl);
    html = setMeta(html, "property", "og:image",       ogImage);
    html = setMeta(html, "property", "og:type",        "article");

    // Twitter card
    html = setMeta(html, "name", "twitter:title",       title);
    html = setMeta(html, "name", "twitter:description", desc);
    html = setMeta(html, "name", "twitter:image",       ogImage);
    html = setMeta(html, "name", "twitter:card",        "summary_large_image");

    // General description
    html = setMeta(html, "name", "description", desc);

    // Canonical URL
    html = html.replace(
      /<link rel="canonical"[^>]*>/,
      `<link rel="canonical" href="${esc(tripUrl)}" />`
    );
    if (!html.includes('rel="canonical"')) {
      html = html.replace("</head>", `<link rel="canonical" href="${esc(tripUrl)}" />\n</head>`);
    }
  } else {
    // Trip not found in DB (deleted, expired, or never existed). This is
    // THE soft-404 scenario that Google Search Console flagged. Without
    // proper handling, we'd return:
    //   - HTTP 200 (suggests success)
    //   - Generic homepage OG meta (no trip-specific content)
    //   - The SPA shell that hydrates and shows 'trip not found' state
    // Google interprets this as 'thin/empty page returned with success
    // status' = Soft 404.
    //
    // The fix has three parts:
    //   1. Return HTTP 404 — explicit signal that the resource is gone
    //   2. Add <meta name="robots" content="noindex,nofollow"> so even
    //      if Google or another crawler reaches this URL, it won't be
    //      indexed and won't pass link equity to other URLs
    //   3. Don't enrich OG meta (the generic homepage values would be
    //      misleading on a trip URL)
    //
    // Why 404 not 410 (Gone): 410 implies the resource USED to exist
    // and is permanently removed. We can't distinguish 'deleted'
    // from 'never existed' from 'expired' from 'short_code typo'
    // server-side, so 404 (Not Found, possibly temporary) is the
    // safer general-purpose response.
    //
    // Why noindex+nofollow: noindex prevents the URL from joining the
    // index; nofollow stops the crawler from chasing links inside the
    // 'not found' page back into Mishwaro (avoiding crawl-budget waste
    // on dead branches).
    //
    // setRobotsMeta REPLACES the existing index,follow meta rather than
    // appending — see helper comment for why duplicate robots tags are
    // a problem despite Google's 'most restrictive wins' policy.
    html = setRobotsMeta(html, "noindex,nofollow");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Short cache — if the driver re-posts a similar trip with same
    // short_code (rare but possible), the 404 expires quickly. 5min
    // is long enough to absorb crawler retry storms.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(404).send(html);
  }

  // Cache: 30s fresh, 60s stale-while-revalidate (lowered from 60/300 so
  // driver edits propagate to OG previews faster — see audit M-11)
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.status(200).send(html);
}
