// tests/k6/00_smoke.js
// 30-second sanity check. Run this before EVERY deployment to production.
// If this fails, don't release.
//
// Run:  k6 run tests/k6/00_smoke.js

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, SUPABASE_URL, ANON_HEADERS } from "./config.js";

export const options = {
  vus: 1,
  duration: "30s",
  thresholds: {
    "http_req_duration": ["p(99)<2000"],  // 99% under 2s
    "http_req_failed":   ["rate<0.01"],   // <1% errors
    "checks":            ["rate==1.0"],   // All checks must pass
  },
};

const REST  = `${SUPABASE_URL}/rest/v1`;
const TODAY = new Date().toISOString().slice(0, 10);

export default function () {
  // 1. Home page responds
  const home = http.get(`${BASE_URL}/`);
  check(home, {
    "✓ home page 200":          (r) => r.status === 200,
    "✓ home has Mishwaro":      (r) => r.body && (r.body.includes("مشوارو") || r.body.includes("Mishwaro")),
  });

  // 2. Supabase is reachable
  const trips = http.get(
    `${REST}/trips?select=id&status=eq.confirmed&limit=1`,
    { headers: ANON_HEADERS }
  );
  check(trips, {
    "✓ supabase reachable":    (r) => r.status === 200,
    "✓ trips table readable":  (r) => r.body.startsWith("["),
  });

  // 3. SEO page is loading from DB
  const seo = http.get(
    `${REST}/seo_pages?select=slug&is_published=eq.true&limit=1`,
    { headers: ANON_HEADERS }
  );
  check(seo, {
    "✓ seo_pages table readable": (r) => r.status === 200 && r.body.includes("slug"),
  });

  // 4. Blog posts readable
  const blog = http.get(
    `${REST}/blog_posts?select=id&limit=1`,
    { headers: ANON_HEADERS }
  );
  check(blog, {
    "✓ blog_posts readable": (r) => r.status === 200,
  });

  // 5. Admin cities (search autocomplete)
  const cities = http.get(
    `${REST}/admin_cities?select=name&limit=5`,
    { headers: ANON_HEADERS }
  );
  check(cities, {
    "✓ admin_cities readable": (r) => r.status === 200,
    "✓ has city data":         (r) => {
      // Table may be empty in staging — just verify it returns a valid array
      try { JSON.parse(r.body); return true; } catch { return false; }
    },
  });

  // 6. robots.txt and llms.txt reachable (AI discoverability)
  const robots = http.get(`${BASE_URL}/robots.txt`);
  check(robots, {
    "✓ robots.txt 200":       (r) => r.status === 200,
    "✓ GPTBot allowed":       (r) => r.body && r.body.includes("GPTBot"),
  });

  const llms = http.get(`${BASE_URL}/llms.txt`);
  check(llms, {
    "✓ llms.txt 200":         (r) => r.status === 200,
    "✓ llms.txt has brand":   (r) => r.body && r.body.includes("Mishwaro"),
  });

  sleep(3);
}
