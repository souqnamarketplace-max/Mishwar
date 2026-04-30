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

const SUPA_URL = process.env.VITE_SUPABASE_URL || "https://dimtdwahtwaslmnuakij.supabase.co";
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_LlK5ig0ruElVt3Z6j0FNkQ_MAGvKRC_";
const APP_URL  = "https://mishwar-nu.vercel.app";

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
    return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>مِشوار</title></head><body><div id="root"></div></body></html>`;
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

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    // Invalid ID — just serve the SPA
    const html = getIndexHtml();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  }

  // Fetch trip from Supabase REST API (no SDK, pure fetch)
  let trip = null;
  try {
    const r = await fetch(
      `${SUPA_URL}/rest/v1/trips?id=eq.${encodeURIComponent(id)}&select=from_city,to_city,price,date,time,available_seats,driver_name,driver_gender,driver_rating,status,distance,car_model&limit=1`,
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

    const title   = `رحلة من ${from} إلى ${to} 🚗 | مِشوار`;
    const desc    = [
      `₪${price} للمقعد`,
      date,
      seats > 0 ? `${seats} مقاعد متاحة` : "الرحلة ممتلئة",
      `السائق${isFem ? "ة" : ""}: ${driver}${rating ? " " + rating : ""}`,
      dist,
    ].filter(Boolean).join(" · ");

    const ogImage = `${APP_URL}/og-trip-placeholder.png`; // static placeholder
    const tripUrl = `${APP_URL}/trip/${id}`;

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
  }

  // Cache: 60s fresh, 5min stale-while-revalidate
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.status(200).send(html);
}
