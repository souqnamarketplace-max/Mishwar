/**
 * Resolve a stored license / KYC document URL to a fetchable URL.
 *
 * After migration 004 (storage hardening), new uploads go to the
 * `uploads-private` bucket and the column stores a PATH (e.g.
 * `<uid>/license-front.jpg`), not a full URL. To display these we
 * mint a short-lived signed URL via the Storage API.
 *
 * Legacy rows still have full https URLs pointing at the public
 * bucket (`/object/public/uploads/...`). Those continue to work
 * without modification — they're already publicly readable.
 *
 * Strategy:
 *   1. If the value starts with `http://` or `https://`, return it as-is.
 *   2. Otherwise treat it as a private-bucket path and sign it.
 *   3. Cache signed URLs in memory for ~50s (signed TTL is 60s).
 *
 * Returns a Promise<string|null>. Use with React `useEffect` +
 * `useState` for clean re-rendering.
 */

import { supabase } from "@/lib/supabase";

const SIGN_TTL_SECONDS = 60;
const CACHE_MS = 50_000; // expire 10s before the signed URL itself does

// In-memory cache. Per-tab; clears on page reload (which is fine).
const cache = new Map(); // path → { url, expiresAt }

export function isPublicHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * Resolve a single stored value to a displayable URL.
 * @param {string|null|undefined} stored — value of license_image_url
 *        or similar column. May be a full URL (legacy) or a path
 *        (post-migration-004).
 * @returns {Promise<string|null>}
 */
export async function resolveDocumentUrl(stored) {
  if (!stored) return null;
  if (isPublicHttpUrl(stored)) return stored;

  // It's a path. Check cache.
  const now = Date.now();
  const cached = cache.get(stored);
  if (cached && cached.expiresAt > now) return cached.url;

  // Sign it. We try the private bucket first; if that 404s
  // (might happen for legacy paths uploaded to the public bucket
  // before backfill), fall back to the public bucket.
  try {
    const { data, error } = await supabase.storage
      .from("uploads-private")
      .createSignedUrl(stored, SIGN_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      cache.set(stored, { url: data.signedUrl, expiresAt: now + CACHE_MS });
      return data.signedUrl;
    }
  } catch {
    // fall through
  }

  try {
    const { data, error } = await supabase.storage
      .from("uploads")
      .createSignedUrl(stored, SIGN_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      cache.set(stored, { url: data.signedUrl, expiresAt: now + CACHE_MS });
      return data.signedUrl;
    }
  } catch {
    // fall through
  }

  return null;
}

/**
 * Resolve many at once. Useful for the admin license review modal
 * which displays five documents in a grid.
 * @param {Record<string, string|null>} input — { key: stored }
 * @returns {Promise<Record<string, string|null>>}
 */
export async function resolveDocumentUrls(input) {
  const entries = Object.entries(input);
  const results = await Promise.all(
    entries.map(async ([key, stored]) => [key, await resolveDocumentUrl(stored)])
  );
  return Object.fromEntries(results);
}
