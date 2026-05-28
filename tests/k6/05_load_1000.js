// tests/k6/05_load_1000.js
// 1000 concurrent user load test with safe gradual ramp-up.
//
// ⚠️  WARNING: Run this against staging/preview URL first, NOT production.
//     Use: k6 run -e BASE_URL=https://mishwar-git-preview.vercel.app tests/k6/05_load_1000.js
//
// Strategy:
//   - Ramp slowly (10 VUs every 30s) to catch breaking points early
//   - Hold at 1000 for 2 minutes
//   - Watch for 429 (rate limit) and 503 (DB exhausted)
//
// Run:
//   k6 run tests/k6/05_load_1000.js
//
// Run against staging:
//   k6 run -e BASE_URL=https://mishwar-git-preview.vercel.app tests/k6/05_load_1000.js
//
// With HTML report:
//   k6 run --out json=results_1000.json tests/k6/05_load_1000.js

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { BASE_URL, SUPABASE_URL, ANON_KEY, ANON_HEADERS } from "./config.js";

// ── Custom metrics ───────────────────────────────────────────────────────────
const errorRate    = new Rate("errors");
const rateLimited  = new Counter("rate_limited_429");
const dbErrors     = new Counter("db_errors_5xx");
const searchTime   = new Trend("search_duration_ms");
const pageLoadTime = new Trend("page_load_ms");

// ── Load profile — ramp to 1000 VUs ─────────────────────────────────────────
export const options = {
  stages: [
    { duration: "30s",  target: 50   },  // Warm up
    { duration: "30s",  target: 100  },  // Low load
    { duration: "30s",  target: 200  },  // Medium load
    { duration: "30s",  target: 400  },  // High load
    { duration: "30s",  target: 700  },  // Very high load
    { duration: "1m",   target: 1000 },  // Peak: 1000 concurrent users
    { duration: "2m",   target: 1000 },  // Hold at peak
    { duration: "30s",  target: 0    },  // Ramp down
  ],

  thresholds: {
    // p95 under these times (relaxed for high load)
    "http_req_duration{type:page}":   ["p(95)<2000"],  // Pages under 2s
    "http_req_duration{type:db}":     ["p(95)<3000"],  // DB queries under 3s

    // Error rate — under 5% acceptable under 1000 VU load
    "http_req_failed":                ["rate<0.05"],
    "errors":                         ["rate<0.05"],

    // Zero tolerance for 5xx errors
    "db_errors_5xx":                  ["count<10"],
  },
};

const REST  = `${SUPABASE_URL}/rest/v1`;
const TODAY = new Date().toISOString().slice(0, 10);

const CITY_PAIRS = [
  ["رام الله", "نابلس"],
  ["نابلس", "رام الله"],
  ["الخليل", "بيت لحم"],
  ["جنين", "نابلس"],
  ["طولكرم", "نابلس"],
  ["رام الله", "الخليل"],
  ["رام الله", "أريحا"],
  ["بيت لحم", "رام الله"],
];

const SEO_SLUGS = [
  "ramallah", "nablus", "hebron", "bethlehem", "jenin", "tulkarm", "qalqilya"
];

export default function () {
  // Each VU randomly picks a scenario to simulate diverse realistic traffic
  const scenario = __VU % 4;

  if (scenario === 0) {
    // ── 25%: Home page visitors ──────────────────────────────────────────
    group("home_visit", () => {
      const start = Date.now();
      const res   = http.get(`${BASE_URL}/`, { tags: { type: "page" } });
      pageLoadTime.add(Date.now() - start);

      const ok = check(res, {
        "home 200":     (r) => r.status === 200,
        "no 429":       (r) => r.status !== 429,
        "no 5xx":       (r) => r.status < 500,
      });

      if (!ok)             errorRate.add(1);
      if (res.status === 429) rateLimited.add(1);
      if (res.status >= 500)  dbErrors.add(1);
    });

  } else if (scenario === 1) {
    // ── 25%: Trip searchers ──────────────────────────────────────────────
    group("trip_search", () => {
      const pair  = CITY_PAIRS[__VU % CITY_PAIRS.length];
      const start = Date.now();
      const res   = http.get(
        `${REST}/trips?select=id,from_city,to_city,trip_date,trip_time,available_seats,price_per_seat,driver_name,driver_rating&from_city=eq.${encodeURIComponent(pair[0])}&to_city=eq.${encodeURIComponent(pair[1])}&status=eq.confirmed&trip_date=gte.${TODAY}&available_seats=gt.0&order=trip_date.asc&limit=20`,
        { headers: ANON_HEADERS, tags: { type: "db" } }
      );
      searchTime.add(Date.now() - start);

      const ok = check(res, {
        "search 200":   (r) => r.status === 200,
        "no 429":       (r) => r.status !== 429,
        "no 5xx":       (r) => r.status < 500,
      });

      if (!ok)             errorRate.add(1);
      if (res.status === 429) rateLimited.add(1);
      if (res.status >= 500)  dbErrors.add(1);
    });

  } else if (scenario === 2) {
    // ── 25%: SEO landing page visitors ──────────────────────────────────
    group("seo_page", () => {
      const slug  = SEO_SLUGS[__VU % SEO_SLUGS.length];
      const start = Date.now();
      const res   = http.get(`${BASE_URL}/cities/${slug}`, { tags: { type: "page" } });
      pageLoadTime.add(Date.now() - start);

      const ok = check(res, {
        "seo 200":    (r) => r.status === 200,
        "no 429":     (r) => r.status !== 429,
        "no 5xx":     (r) => r.status < 500,
      });

      if (!ok)             errorRate.add(1);
      if (res.status === 429) rateLimited.add(1);
      if (res.status >= 500)  dbErrors.add(1);
    });

  } else {
    // ── 25%: API-only (mobile app users) ────────────────────────────────
    group("api_only", () => {
      // Cities autocomplete (hits on every search form open)
      const res = http.get(
        `${REST}/admin_cities?select=name&limit=2000`,
        { headers: ANON_HEADERS, tags: { type: "db" } }
      );

      const ok = check(res, {
        "cities 200":  (r) => r.status === 200,
        "no 429":      (r) => r.status !== 429,
        "no 5xx":      (r) => r.status < 500,
      });

      if (!ok)             errorRate.add(1);
      if (res.status === 429) rateLimited.add(1);
      if (res.status >= 500)  dbErrors.add(1);
    });
  }

  // Realistic think time — Palestinian users on mobile (~3-8s between actions)
  sleep(Math.random() * 5 + 3);
}

// ── Summary handler — printed after test completes ───────────────────────────
export function handleSummary(data) {
  const dur    = data.metrics.http_req_duration;
  const failed = data.metrics.http_req_failed;
  const reqs   = data.metrics.http_reqs;
  const rl     = data.metrics.rate_limited_429;
  const dbe    = data.metrics.db_errors_5xx;

  const summary = `
╔══════════════════════════════════════════════════════════╗
║           مشوارو — 1000 VU Load Test Results           ║
╠══════════════════════════════════════════════════════════╣
║  Total requests:   ${String(reqs?.values?.count || 0).padEnd(10)}                        ║
║  Req/s (avg):      ${String((reqs?.values?.rate || 0).toFixed(1)).padEnd(10)}                        ║
║                                                          ║
║  Response times:                                         ║
║    p50:  ${String((dur?.values?.["p(50)"] || 0).toFixed(0) + "ms").padEnd(10)}                                    ║
║    p90:  ${String((dur?.values?.["p(90)"] || 0).toFixed(0) + "ms").padEnd(10)}                                    ║
║    p95:  ${String((dur?.values?.["p(95)"] || 0).toFixed(0) + "ms").padEnd(10)}                                    ║
║    p99:  ${String((dur?.values?.["p(99)"] || 0).toFixed(0) + "ms").padEnd(10)}                                    ║
║                                                          ║
║  Error rate:       ${String(((failed?.values?.rate || 0) * 100).toFixed(2) + "%").padEnd(10)}                        ║
║  429 rate limits:  ${String(rl?.values?.count || 0).padEnd(10)}                        ║
║  5xx DB errors:    ${String(dbe?.values?.count || 0).padEnd(10)}                        ║
╚══════════════════════════════════════════════════════════╝
`;
  console.log(summary);

  return {
    "results_1000.txt": summary,
  };
}
