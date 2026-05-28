// tests/k6/02_api_supabase.js
// Tests the Supabase REST API endpoints that the app hits on load.
// Focuses on the most-used tables: trips, profiles, app_settings, seo_pages.
// Uses the anon key — only publicly readable tables are testable here.
//
// Run:  k6 run tests/k6/02_api_supabase.js
// Stress: k6 run --stage 30s:20,1m:50,30s:0 tests/k6/02_api_supabase.js

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";
import { SUPABASE_URL, ANON_HEADERS, THRESHOLDS, LOAD } from "./config.js";

export const options = {
  ...LOAD,
  thresholds: {
    ...THRESHOLDS,
    "http_req_duration{endpoint:trips_list}":     ["p(95)<600"],
    "http_req_duration{endpoint:seo_pages}":      ["p(95)<400"],
    "http_req_duration{endpoint:app_settings}":   ["p(95)<500"],
    "http_req_duration{endpoint:blog_posts}":      ["p(95)<500"],
    "http_req_duration{endpoint:admin_cities}":   ["p(95)<400"],
    "http_req_duration{endpoint:release_notes}":  ["p(95)<400"],
  },
};

const REST = `${SUPABASE_URL}/rest/v1`;

export default function () {

  // ── 1. Home page: upcoming confirmed trips ─────────────────────────────
  group("trips_list", () => {
    const res = http.get(
      `${REST}/trips?select=id,from_city,to_city,trip_date,trip_time,available_seats,price_per_seat,driver_name,driver_rating&status=eq.confirmed&trip_date=gte.${new Date().toISOString().slice(0,10)}&order=trip_date.asc,trip_time.asc&limit=20`,
      { headers: ANON_HEADERS, tags: { type: "db", endpoint: "trips_list" } }
    );
    check(res, {
      "trips 200":           (r) => r.status === 200,
      "returns array":       (r) => Array.isArray(JSON.parse(r.body || "[]")),
      "reasonable payload":  (r) => r.body.length < 50_000,
    });
  });

  sleep(0.5);

  // ── 2. SEO landing page content ────────────────────────────────────────
  group("seo_pages", () => {
    const slugs = ["ramallah", "nablus", "hebron", "ramallah-nablus"];
    const slug  = slugs[Math.floor(Math.random() * slugs.length)];
    const res   = http.get(
      `${REST}/seo_pages?select=slug,page_type,title,subtitle,intro,sections,faq,related_links,breadcrumbs,keywords,meta_description,search_link&slug=eq.${slug}&is_published=eq.true&limit=1`,
      { headers: ANON_HEADERS, tags: { type: "db", endpoint: "seo_pages" } }
    );
    check(res, {
      "seo_pages 200":    (r) => r.status === 200,
      "has content":      (r) => r.body.length > 100,
      "has title":        (r) => r.body.includes("رحلات"),
    });
  });

  sleep(0.3);

  // ── 3. App settings (hero slides) ─────────────────────────────────────
  group("app_settings", () => {
    const res = http.get(
      `${REST}/app_settings?select=hero_city_slides,hero_badge_text&order=updated_at.desc&limit=1`,
      { headers: ANON_HEADERS, tags: { type: "db", endpoint: "app_settings" } }
    );
    check(res, {
      "app_settings 200":  (r) => r.status === 200,
    });
  });

  sleep(0.3);

  // ── 4. Blog posts list ─────────────────────────────────────────────────
  group("blog_posts", () => {
    const res = http.get(
      `${REST}/blog_posts?select=id,title,slug,excerpt,category,created_at&order=created_at.desc&limit=10`,
      { headers: ANON_HEADERS, tags: { type: "db", endpoint: "blog_posts" } }
    );
    check(res, {
      "blog_posts 200":  (r) => r.status === 200,
      "returns array":   (r) => Array.isArray(JSON.parse(r.body || "[]")),
    });
  });

  sleep(0.3);

  // ── 5. Admin cities (used in search form autocomplete) ──────────────────
  group("admin_cities", () => {
    const res = http.get(
      `${REST}/admin_cities?select=name&limit=2000`,
      { headers: ANON_HEADERS, tags: { type: "db", endpoint: "admin_cities" } }
    );
    check(res, {
      "admin_cities 200":   (r) => r.status === 200,
      "returns cities":     (r) => JSON.parse(r.body || "[]").length > 0,
    });
  });

  sleep(0.3);

  // ── 6. Release notes ───────────────────────────────────────────────────
  group("release_notes", () => {
    const res = http.get(
      `${REST}/release_notes?select=id,title,body,version,created_at&is_published=eq.true&order=created_at.desc&limit=5`,
      { headers: ANON_HEADERS, tags: { type: "db", endpoint: "release_notes" } }
    );
    check(res, {
      "release_notes 200":  (r) => r.status === 200,
    });
  });

  sleep(Math.random() * 2 + 1);
}
