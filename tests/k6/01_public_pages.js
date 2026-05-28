// tests/k6/01_public_pages.js
// Tests all public-facing pages served by Vercel CDN.
// These should be extremely fast (<300ms p95) since they're static assets.
//
// Run:  k6 run tests/k6/01_public_pages.js
// Stress: k6 run --stage 30s:20,1m:50,30s:0 tests/k6/01_public_pages.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import { BASE_URL, THRESHOLDS, LOAD } from "./config.js";

export const options = {
  ...LOAD,
  thresholds: {
    ...THRESHOLDS,
    "http_req_duration{page:home}":         ["p(95)<400"],
    "http_req_duration{page:search}":       ["p(95)<400"],
    "http_req_duration{page:how_it_works}": ["p(95)<400"],
    "http_req_duration{page:seo_city}":     ["p(95)<800"],  // DB-fetched
    "http_req_duration{page:seo_route}":    ["p(95)<800"],
  },
};

// ── All public static routes ────────────────────────────────────────────────
const STATIC_PAGES = [
  { path: "/",              tag: "home" },
  { path: "/search",        tag: "search" },
  { path: "/how-it-works",  tag: "how_it_works" },
  { path: "/about",         tag: "about" },
  { path: "/safety",        tag: "safety" },
  { path: "/community",     tag: "community" },
  { path: "/help",          tag: "help" },
  { path: "/blog",          tag: "blog" },
  { path: "/privacy",       tag: "privacy" },
  { path: "/terms",         tag: "terms" },
];

// SEO landing pages — now DB-driven, so slightly slower
const SEO_CITY_PAGES = [
  { path: "/cities/ramallah",  tag: "seo_city" },
  { path: "/cities/nablus",    tag: "seo_city" },
  { path: "/cities/hebron",    tag: "seo_city" },
  { path: "/cities/bethlehem", tag: "seo_city" },
  { path: "/cities/jenin",     tag: "seo_city" },
  { path: "/cities/tulkarm",   tag: "seo_city" },
  { path: "/cities/qalqilya",  tag: "seo_city" },
];

const SEO_ROUTE_PAGES = [
  { path: "/routes/ramallah-nablus",     tag: "seo_route" },
  { path: "/routes/jerusalem-bethlehem", tag: "seo_route" },
  { path: "/routes/hebron-jerusalem",    tag: "seo_route" },
];

const ALL_PAGES = [...STATIC_PAGES, ...SEO_CITY_PAGES, ...SEO_ROUTE_PAGES];

export default function () {
  // Each VU iterates through a random page each time
  const page = ALL_PAGES[Math.floor(Math.random() * ALL_PAGES.length)];
  const url   = `${BASE_URL}${page.path}`;

  const res = http.get(url, { tags: { type: "static", page: page.tag } });

  check(res, {
    "status 200":        (r) => r.status === 200,
    "has html content":  (r) => r.body && r.body.includes("مشوارو"),
    "no server errors":  (r) => r.status < 500,
  });

  sleep(Math.random() * 2 + 1); // 1-3s think time between requests
}
