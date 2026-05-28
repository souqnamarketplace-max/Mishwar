// tests/k6/config.js
// Shared config for all Mishwaro k6 load tests
// Edit BASE_URL and ANON_KEY to point at staging vs production.

export const BASE_URL     = __ENV.BASE_URL     || "https://www.mishwaro.com";
export const SUPABASE_URL = __ENV.SUPABASE_URL || "https://dimtdwahtwaslmnuakij.supabase.co";
export const ANON_KEY     = __ENV.ANON_KEY     || "sb_publishable_LlK5ig0ruElVt3Z6j0FNkQ_MAGvKRC_";

// Standard Supabase REST headers for anonymous requests
export const ANON_HEADERS = {
  "Content-Type":  "application/json",
  "apikey":        ANON_KEY,
  "Authorization": `Bearer ${ANON_KEY}`,
};

// ── Thresholds (what "pass" means) ──────────────────────────────────────────
// These are the numbers Google cares about for Core Web Vitals + UX.
// Adjust if real-world baseline differs.
export const THRESHOLDS = {
  // 95% of requests must complete under these times
  "http_req_duration{type:static}":   ["p(95)<300"],   // CDN pages
  "http_req_duration{type:db}":       ["p(95)<800"],   // DB-backed queries
  "http_req_duration{type:rpc}":      ["p(95)<1000"],  // Supabase RPCs
  "http_req_duration{type:seo}":      ["p(95)<600"],   // SEO landing pages (DB-driven)

  // Error rate — less than 1% of requests should fail
  "http_req_failed":                  ["rate<0.01"],
};

// ── Load profiles ─────────────────────────────────────────────────────────
export const SMOKE = {
  vus: 1, duration: "30s",   // Sanity check: 1 user, 30 seconds
};

export const LOAD = {
  stages: [
    { duration: "30s", target: 10  },  // Ramp up
    { duration: "1m",  target: 10  },  // Hold at 10 concurrent users
    { duration: "15s", target: 0   },  // Ramp down
  ],
};

export const STRESS = {
  stages: [
    { duration: "30s", target: 20  },
    { duration: "1m",  target: 50  },  // 50 concurrent — peak Palestinian rush hour estimate
    { duration: "30s", target: 100 },  // Spike
    { duration: "30s", target: 0   },
  ],
};

export const SOAK = {
  stages: [
    { duration: "1m",  target: 10  },
    { duration: "10m", target: 10  },  // 10 min steady — catches memory leaks
    { duration: "30s", target: 0   },
  ],
};
