/**
 * Lightweight in-memory rate limiter for Vercel functions.
 *
 * Vercel's serverless model spawns short-lived instances per region
 * and can recycle the JS process at any time. That means in-memory
 * state is per-instance, NOT global — a determined attacker hitting
 * many regions could still exceed the cap. This helper is intended
 * as a "first cheap line of defense" against:
 *   - Accidental retry storms from buggy clients
 *   - Casual scraping
 *   - Single-source DDoS attempts
 *
 * For real protection at scale, replace with Upstash Redis or move
 * the limit to Vercel's edge config / firewall. Until that's wired,
 * this is better than nothing.
 *
 * Usage:
 *   import { rateLimit } from "./_rate-limit.js";
 *   export default function handler(req, res) {
 *     if (!rateLimit(req, res, { max: 30, windowMs: 60_000 })) return;
 *     // ... handler logic ...
 *   }
 */

// Map<bucketKey, { count: number, resetAt: number }>
// We bound the map size so a flood of unique IPs can't OOM the function.
const buckets = new Map();
const MAX_BUCKETS = 10_000;

/**
 * Returns the best-effort client identifier for rate-limiting purposes.
 * Vercel sets x-forwarded-for as the chain "client, proxy1, proxy2".
 * The first entry is the actual client.
 */
function clientId(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  return req.headers["x-real-ip"]
      || req.socket?.remoteAddress
      || "unknown";
}

/**
 * Apply a rate limit to the current request. Returns true if the
 * request is allowed, false if it was throttled (in which case the
 * 429 response has already been written and the caller should
 * return).
 *
 * options:
 *   max       — max requests per window (default 30)
 *   windowMs  — window length in ms (default 60_000)
 *   keyPrefix — namespace key (e.g. "trip:" so different endpoints
 *               don't share a bucket). Default "default:"
 */
export function rateLimit(req, res, options = {}) {
  const { max = 30, windowMs = 60_000, keyPrefix = "default:" } = options;
  const now = Date.now();
  const ip  = clientId(req);
  const key = keyPrefix + ip;

  // Cheap LRU-ish trim: if we ever exceed MAX_BUCKETS, drop expired
  // entries on the next call. Worst case we'd OOM ~MB at scale.
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (v.resetAt < now) buckets.delete(k);
      if (buckets.size <= MAX_BUCKETS / 2) break;
    }
  }

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  // Always set the standard headers — clients can use them to back off
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > max) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.status(429).send("Too many requests. Please slow down.");
    return false;
  }
  return true;
}
