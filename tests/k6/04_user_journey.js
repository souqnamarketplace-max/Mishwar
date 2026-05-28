// tests/k6/04_user_journey.js
// Simulates the complete anonymous user journey:
// Home → Browse → Search → Trip Detail → SEO landing page
//
// This is the most realistic test. Run this for final pre-launch validation.
//
// Run:  k6 run tests/k6/04_user_journey.js
// Stress: k6 run --stage 1m:50,2m:50,30s:0 tests/k6/04_user_journey.js

import http from "k6/http";
import { check, group, sleep } from "k6";
import { BASE_URL, SUPABASE_URL, ANON_HEADERS, STRESS } from "./config.js";

export const options = {
  ...STRESS,
  thresholds: {
    "http_req_duration{step:home}":         ["p(95)<500"],
    "http_req_duration{step:trips_query}":  ["p(95)<800"],
    "http_req_duration{step:seo_page}":     ["p(95)<800"],
    "http_req_duration{step:search_page}":  ["p(95)<500"],
    "http_req_failed":                      ["rate<0.01"],
    "checks":                               ["rate>0.98"],
  },
};

const REST  = `${SUPABASE_URL}/rest/v1`;
const TODAY = new Date().toISOString().slice(0, 10);

const CITIES = ["رام الله","نابلس","الخليل","بيت لحم","جنين","طولكرم","قلقيلية"];
const SEO_CITY_SLUGS = ["ramallah","nablus","hebron","bethlehem","jenin","tulkarm","qalqilya"];
const ROUTE_SLUGS    = ["ramallah-nablus","jerusalem-bethlehem","hebron-jerusalem"];

export default function () {

  // ── Step 1: Land on home page ─────────────────────────────────────────
  group("step_home", () => {
    const res = http.get(`${BASE_URL}/`, { tags: { step: "home" } });
    check(res, {
      "home loads":         (r) => r.status === 200,
      "has app content":    (r) => r.body && (r.body.includes("مشوارو") || r.body.includes("Mishwaro")),
    });
  });
  sleep(2);

  // ── Step 2: Fetch home page trips (what FeaturedTrips does) ──────────
  group("step_featured_trips", () => {
    const userCity = CITIES[Math.floor(Math.random() * CITIES.length)];
    const res = http.get(
      `${REST}/trips?select=id,from_city,to_city,trip_date,trip_time,available_seats,price_per_seat,driver_name,driver_rating&status=eq.confirmed&trip_date=gte.${TODAY}&order=created_at.desc&limit=20`,
      { headers: ANON_HEADERS, tags: { type: "db", step: "trips_query" } }
    );
    check(res, {
      "trips query 200":   (r) => r.status === 200,
      "array response":    (r) => {
        try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
      },
    });
  });
  sleep(3);

  // ── Step 3: Navigate to a city SEO landing page ───────────────────────
  group("step_seo_city", () => {
    const slug = SEO_CITY_SLUGS[Math.floor(Math.random() * SEO_CITY_SLUGS.length)];
    const res  = http.get(`${BASE_URL}/cities/${slug}`, { tags: { step: "seo_page" } });
    check(res, {
      "seo city loads":  (r) => r.status === 200,
      "has content":     (r) => r.body && r.body.includes("مشوارو"),
    });
  });
  sleep(4);

  // ── Step 4: Visit search page ─────────────────────────────────────────
  group("step_search_page", () => {
    const from = CITIES[Math.floor(Math.random() * CITIES.length)];
    let to;
    do { to = CITIES[Math.floor(Math.random() * CITIES.length)]; } while (to === from);

    const res = http.get(
      `${BASE_URL}/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${TODAY}`,
      { tags: { step: "search_page" } }
    );
    check(res, {
      "search page loads":  (r) => r.status === 200,
    });
  });
  sleep(2);

  // ── Step 5: Fetch cities list (autocomplete warm-up) ──────────────────
  group("step_cities_autocomplete", () => {
    const res = http.get(
      `${REST}/admin_cities?select=name&limit=2000`,
      { headers: ANON_HEADERS, tags: { type: "db", step: "trips_query" } }
    );
    check(res, {
      "cities 200":  (r) => r.status === 200,
    });
  });

  // Think time between user journeys
  sleep(Math.random() * 5 + 3); // 3-8s
}
