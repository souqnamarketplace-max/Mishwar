/**
 * Centralized session reader.
 *
 * The Supabase client occasionally hangs on getSession() after token
 * refresh, so the codebase historically reaches into localStorage in
 * five places to pull the JWT. This helper consolidates that logic so
 * everyone agrees on:
 *   - the storage key format
 *   - expiry handling
 *   - error swallowing
 *
 * If the underlying session shape ever changes (e.g. Supabase v3),
 * fix it here in one place.
 */

function getProjectRef() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return '';
  return url.split('//')[1]?.split('.')[0] || '';
}

/**
 * Read the auth session straight from localStorage. Returns null if
 * unset, expired, or unparseable. Never throws.
 */
export function readLocalSession() {
  try {
    const ref = getProjectRef();
    if (!ref) return null;
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // expires_at is a UNIX seconds timestamp
    if (parsed?.expires_at && parsed.expires_at * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Quick lookups derived from the session — null-safe. */
export function readSessionEmail()    { return readLocalSession()?.user?.email ?? null; }
export function readSessionUserId()   { return readLocalSession()?.user?.id    ?? null; }
export function readSessionToken()    { return readLocalSession()?.access_token ?? null; }
