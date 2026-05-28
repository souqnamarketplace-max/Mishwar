// tests/k6/03_trip_search.js
// Simulates the most common user journey: searching for a trip.
// This is the highest-value query in the app — the search results
// page hits trips table with multiple filters + ordering.
//
// Run:  k6 run tests/k6/03_trip_search.js

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";
import { SUPABASE_URL, ANON_HEADERS, LOAD } from "./config.js";

export const options = {
  ...LOAD,
  thresholds: {
    "http_req_duration{journey:search}":          ["p(95)<800"],
    "http_req_duration{journey:search_filtered}": ["p(95)<900"],
    "http_req_duration{journey:trip_detail}":     ["p(95)<600"],
    "http_req_failed":                            ["rate<0.01"],
    "checks":                                     ["rate>0.99"],
  },
};

const REST  = `${SUPABASE_URL}/rest/v1`;
const TODAY = new Date().toISOString().slice(0, 10);

// Palestinian city pairs — most realistic search combinations
const SEARCH_PAIRS = [
  { from: "رام الله",  to: "نابلس"   },
  { from: "نابلس",     to: "رام الله" },
  { from: "الخليل",    to: "بيت لحم" },
  { from: "بيت لحم",   to: "الخليل"  },
  { from: "جنين",      to: "نابلس"   },
  { from: "طولكرم",    to: "نابلس"   },
  { from: "رام الله",  to: "الخليل"  },
  { from: "رام الله",  to: "أريحا"   },
];

export default function () {
  const pair = SEARCH_PAIRS[Math.floor(Math.random() * SEARCH_PAIRS.length)];

  // ── Step 1: Basic search (from + to + date) ──────────────────────────
  group("search_basic", () => {
    const res = http.get(
      `${REST}/trips?select=id,from_city,to_city,trip_date,trip_time,available_seats,price_per_seat,driver_name,driver_rating,driver_photo_url&from_city=eq.${encodeURIComponent(pair.from)}&to_city=eq.${encodeURIComponent(pair.to)}&status=eq.confirmed&trip_date=gte.${TODAY}&available_seats=gt.0&order=trip_date.asc,trip_time.asc&limit=20`,
      { headers: ANON_HEADERS, tags: { type: "db", journey: "search" } }
    );
    check(res, {
      "search 200":          (r) => r.status === 200,
      "returns array":       (r) => {
        try { return Array.isArray(JSON.parse(r.body)); }
        catch { return false; }
      },
      "response under 2s":   (r) => r.timings.duration < 2000,
    });
  });

  sleep(1);

  // ── Step 2: Filtered search (seats filter) ────────────────────────────
  group("search_filtered", () => {
    const res = http.get(
      `${REST}/trips?select=id,from_city,to_city,trip_date,trip_time,available_seats,price_per_seat,driver_name,driver_rating&from_city=eq.${encodeURIComponent(pair.from)}&status=eq.confirmed&trip_date=gte.${TODAY}&available_seats=gte.2&order=price_per_seat.asc&limit=20`,
      { headers: ANON_HEADERS, tags: { type: "db", journey: "search_filtered" } }
    );
    check(res, {
      "filtered 200":   (r) => r.status === 200,
      "has body":       (r) => r.body && r.body.length > 2,
    });
  });

  sleep(1);

  // ── Step 3: Simulate opening a trip detail ─────────────────────────────
  // We search first, then fetch the first trip detail
  group("trip_detail", () => {
    // First get trip IDs
    const listRes = http.get(
      `${REST}/trips?select=id&status=eq.confirmed&trip_date=gte.${TODAY}&limit=5`,
      { headers: ANON_HEADERS, tags: { type: "db", journey: "trip_detail" } }
    );

    if (listRes.status === 200) {
      let trips = [];
      try { trips = JSON.parse(listRes.body); } catch {}

      if (trips.length > 0) {
        const trip = trips[Math.floor(Math.random() * trips.length)];
        const detailRes = http.get(
          `${REST}/trips?select=*&id=eq.${trip.id}&limit=1`,
          { headers: ANON_HEADERS, tags: { type: "db", journey: "trip_detail" } }
        );
        check(detailRes, {
          "detail 200":  (r) => r.status === 200,
          "has trip":    (r) => r.body.includes(trip.id),
        });
      }
    }
  });

  sleep(Math.random() * 3 + 2); // 2-5s think time (realistic user)
}
