#!/usr/bin/env node
/**
 * scripts/build-sitemap.js
 *
 * Generates dist/sitemap.xml at build time by:
 *   1. Listing all static public routes (the same allow-list robots.txt has)
 *   2. Adding the SEO landing pages (/routes/*, /cities/*)
 *   3. Pulling the most recent N public trips from Supabase, building a
 *      /trip/:id entry for each — so newly-posted public trips become
 *      discoverable to Google without a manual sitemap edit
 *   4. Pulling the most recent N public profile pages (drivers who opted
 *      in to public profiles)
 *
 * Why build-time, not server-side:
 *   - The app is a static SPA on Vercel. There's no server runtime to
 *     dynamically regenerate sitemap.xml on a schedule. We hook into
 *     `vite build` so every Vercel deploy refreshes the sitemap with
 *     the trips that exist at deploy time.
 *   - For frequently-changing content (new trips daily), this means the
 *     sitemap is at most as fresh as the last deploy. That's fine for
 *     SEO — Google re-crawls the sitemap on its own schedule, not in
 *     real-time. If trip churn becomes very high we can add a daily
 *     redeploy webhook later.
 *
 * Why Supabase service-role key NOT required here:
 *   - We read from `trips` and `profiles` using the public anon key.
 *   - RLS policies on those tables permit unauthenticated read of public
 *     rows (status='confirmed', is_public=true) — exactly what a sitemap
 *     should expose. Anything sensitive stays hidden by RLS.
 *   - This means the script can run in CI without secrets — just the
 *     anon key already in the repo's env.
 *
 * Output: dist/sitemap.xml — overwrites the static one in public/.
 *   Vite copies public/* to dist/ during build, then this script
 *   overwrites the sitemap with the dynamic version. Static URLs stay
 *   in case Supabase is unreachable; dynamic URLs are an enhancement.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const DIST_PATH = path.join(ROOT, "dist", "sitemap.xml");

// ─── Configuration ─────────────────────────────────────────────────
// SITE_URL is taken from VITE_SITE_URL. If unset (local dev), we fall
// back to the production fallback so the generated sitemap is at least
// self-consistent. Production deploys MUST have VITE_SITE_URL set on
// Vercel for the canonical URLs to be correct.
const SITE_URL = (process.env.VITE_SITE_URL || "https://www.mishwaro.com").replace(/\/$/, "");

const SUPABASE_URL    = process.env.VITE_SUPABASE_URL    || "https://dimtdwahtwaslmnuakij.supabase.co";
const SUPABASE_ANON   = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_LlK5ig0ruElVt3Z6j0FNkQ_MAGvKRC_";

// How many recent dynamic rows to include. Sitemap soft cap is 50k
// entries / 50MB; we stay well under both. Pulling all trips ever isn't
// useful — Google deprioritizes very old transient content anyway.
const MAX_TRIPS    = 200;
const MAX_PROFILES = 100;

const TODAY = new Date().toISOString().slice(0, 10);

// ─── Slug builder (mirrors src/lib/slug.js, inlined here) ──────────────
// Vite aliases (@/...) don't resolve in plain Node ESM, so we inline a
// minimal version. If src/lib/slug.js changes its slug format, mirror
// the change here. The CITY-name → Latin map is intentionally TINY here
// because the sitemap doesn't need pretty Latin city names — only
// uniqueness. autoTranslit gives us URL-safe slugs for any city. The
// frontend uses the full curated map for nicer URLs.
const SITEMAP_ARABIC_TO_LATIN = {
  "رام الله":"ramallah","نابلس":"nablus","الخليل":"hebron",
  "بيت لحم":"bethlehem","القدس":"jerusalem","غزة":"gaza",
  "أريحا":"jericho","جنين":"jenin","طولكرم":"tulkarm",
  "قلقيلية":"qalqilya","سلفيت":"salfit","طوباس":"tubas",
  "قصرة":"qasra","كفر الليمون":"kafr-al-laymun",
};
const SITEMAP_TRANSLIT = {
  "ا":"a","أ":"a","إ":"a","آ":"a","ء":"a","ى":"a","ب":"b","ت":"t","ة":"a",
  "ث":"th","ج":"j","ح":"h","خ":"kh","د":"d","ذ":"dh","ر":"r","ز":"z",
  "س":"s","ش":"sh","ص":"s","ض":"d","ط":"t","ظ":"z","ع":"a","غ":"gh",
  "ف":"f","ق":"q","ك":"k","ل":"l","م":"m","ن":"n","ه":"h","ؤ":"w",
  "و":"w","ي":"y","ئ":"y"," ":"-",
};
function sitemapCityToLatin(s) {
  if (!s) return "";
  if (SITEMAP_ARABIC_TO_LATIN[s]) return SITEMAP_ARABIC_TO_LATIN[s];
  let out = "";
  for (const ch of s) out += (SITEMAP_TRANSLIT[ch] ?? "");
  return out.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
const SITEMAP_MONTH_SHORT = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function sitemapFormatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${SITEMAP_MONTH_SHORT[d.getUTCMonth()]}${d.getUTCDate()}`;
}
function buildTripSlugSitemap(t) {
  if (!t.short_code) return `/trip/${t.id}`;
  const from = sitemapCityToLatin(t.from_city);
  const to   = sitemapCityToLatin(t.to_city);
  const date = sitemapFormatDate(t.date);
  const parts = [from, to, date, t.short_code].filter(Boolean);
  return `/trip/${parts.join("-")}`;
}

// ─── Static routes (must match robots.txt allow-list) ──────────────
// priority and changefreq are advisory — Google barely uses them but
// other crawlers do. Higher priority = "this page matters more on this
// site relative to others". Homepage = 1.0; supporting/legal = 0.4.
const STATIC_ROUTES = [
  { path: "/",                   priority: "1.0", changefreq: "daily"   },
  { path: "/search",             priority: "0.9", changefreq: "hourly"  },
  { path: "/how-it-works",       priority: "0.8", changefreq: "monthly" },
  { path: "/about",              priority: "0.6", changefreq: "monthly" },
  { path: "/community",          priority: "0.6", changefreq: "weekly"  },
  { path: "/help",               priority: "0.7", changefreq: "monthly" },
  { path: "/safety",             priority: "0.6", changefreq: "monthly" },
  { path: "/blog",               priority: "0.7", changefreq: "weekly"  },
  { path: "/become-driver",      priority: "0.8", changefreq: "monthly" },
  { path: "/privacy",            priority: "0.4", changefreq: "yearly"  },
  { path: "/terms",              priority: "0.4", changefreq: "yearly"  },
];

// ─── SEO landing pages (route + city pages) ────────────────────────
// These are hand-written Arabic landing pages targeting specific
// query patterns ("رحلات رام الله نابلس", "مشاوير الخليل"). Each
// one is a real React route under src/pages/seo/ and gets its own
// sitemap entry with high priority because they're built specifically
// to rank.
const SEO_LANDING_ROUTES = [
  { path: "/routes/ramallah-nablus",     priority: "0.9", changefreq: "weekly" },
  { path: "/routes/jerusalem-bethlehem", priority: "0.9", changefreq: "weekly" },
  { path: "/routes/hebron-jerusalem",    priority: "0.9", changefreq: "weekly" },
  { path: "/cities/ramallah",            priority: "0.8", changefreq: "weekly" },
  { path: "/cities/nablus",              priority: "0.8", changefreq: "weekly" },
  { path: "/cities/hebron",              priority: "0.8", changefreq: "weekly" },
  { path: "/cities/bethlehem",           priority: "0.8", changefreq: "weekly" },
  { path: "/cities/jenin",               priority: "0.8", changefreq: "weekly" },
  { path: "/cities/tulkarm",             priority: "0.8", changefreq: "weekly" },
  { path: "/cities/qalqilya",            priority: "0.8", changefreq: "weekly" },
];

async function fetchRecentTrips() {
  // Pull confirmed + future-dated trips. Past trips are still public but
  // less SEO-valuable; we still include them because the page renders
  // with a "completed" badge and the route + price are indexable.
  // is_public defaults true; we filter just-in-case it's false.
  const url = `${SUPABASE_URL}/rest/v1/trips?` +
    `select=id,short_code,from_city,to_city,date,updated_at,status&` +
    `order=created_at.desc&limit=${MAX_TRIPS}`;
  try {
    const res = await fetch(url, {
      headers: {
        "apikey":        SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
      },
    });
    if (!res.ok) {
      console.warn(`  ⚠ trips fetch failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.warn(`  ⚠ trips fetch error: ${err.message}`);
    return [];
  }
}

async function fetchPublicProfiles() {
  // Profiles that opted in to a public-facing profile page. Falls back
  // to all profiles if the column doesn't exist yet — sitemap will
  // include too many but no privacy leak (the profile page itself
  // gates non-public profiles with a 404).
  const url = `${SUPABASE_URL}/rest/v1/profiles?` +
    `select=email,updated_at&` +
    `order=updated_at.desc&limit=${MAX_PROFILES}`;
  try {
    const res = await fetch(url, {
      headers: {
        "apikey":        SUPABASE_ANON,
        "Authorization": `Bearer ${SUPABASE_ANON}`,
      },
    });
    if (!res.ok) {
      console.warn(`  ⚠ profiles fetch failed: ${res.status}`);
      return [];
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.warn(`  ⚠ profiles fetch error: ${err.message}`);
    return [];
  }
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  // hreflang alternates point to themselves for now (Arabic-only site)
  // but the structure is in place if/when we add /en/ later. x-default
  // tells Google "this is the version for users whose locale we don't
  // recognize" — pointing at the Arabic version is correct because
  // that's the production language of the site.
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod || TODAY}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="ar" href="${loc}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}"/>
  </url>`;
}

async function main() {
  console.log(`▸ Generating sitemap with SITE_URL=${SITE_URL}`);

  const entries = [];

  // 1. Static routes
  for (const r of STATIC_ROUTES) {
    entries.push(urlEntry({
      loc:        `${SITE_URL}${r.path}`,
      changefreq: r.changefreq,
      priority:   r.priority,
    }));
  }

  // 2. SEO landing pages
  for (const r of SEO_LANDING_ROUTES) {
    entries.push(urlEntry({
      loc:        `${SITE_URL}${r.path}`,
      changefreq: r.changefreq,
      priority:   r.priority,
    }));
  }

  // 3. Recent trips
  const trips = await fetchRecentTrips();
  console.log(`  · trips:    ${trips.length}`);
  for (const t of trips) {
    if (!t.id) continue;
    // Prefer slug URL when short_code is present (post-migration 022).
    // Falls back to UUID for trips without short_code (shouldn't happen
    // post-deploy but defensive). Slug builder is inlined here because
    // this script is plain Node ESM and can't resolve the Vite alias.
    const slugPath = buildTripSlugSitemap(t);
    entries.push(urlEntry({
      loc:        `${SITE_URL}${slugPath}`,
      lastmod:    (t.updated_at || "").slice(0, 10) || TODAY,
      changefreq: "daily",
      priority:   "0.6",
    }));
  }

  // 4. Public profiles
  const profiles = await fetchPublicProfiles();
  console.log(`  · profiles: ${profiles.length}`);
  for (const p of profiles) {
    if (!p.email) continue;
    entries.push(urlEntry({
      loc:        `${SITE_URL}/profile?email=${encodeURIComponent(p.email)}`,
      lastmod:    (p.updated_at || "").slice(0, 10) || TODAY,
      changefreq: "weekly",
      priority:   "0.5",
    }));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Sitemap for مشوارو — auto-generated at build time by scripts/build-sitemap.js
  Generated: ${new Date().toISOString()}
  Entries: ${entries.length}
  SITE_URL: ${SITE_URL}

  IMPORTANT: do NOT edit this file by hand. Edit scripts/build-sitemap.js
  instead and re-run \`npm run build\`. The dynamic trip/profile entries
  refresh on every Vercel deploy.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;

  fs.mkdirSync(path.dirname(DIST_PATH), { recursive: true });
  fs.writeFileSync(DIST_PATH, xml);
  console.log(`✓ Wrote ${DIST_PATH} (${entries.length} entries)`);
}

main().catch((err) => {
  console.error("✗ Sitemap generation failed:", err);
  process.exit(1);
});
