import { useState, useEffect } from "react";

/**
 * useCanSeeDebugDetails — returns true if the current viewer should be
 * able to see technical error details (stack traces, component stacks,
 * raw error messages). Returns false for regular end users.
 *
 * Gate logic (any of these is sufficient):
 *
 *   1. Build is dev/preview (import.meta.env.DEV) — local development
 *      always sees details
 *   2. URL has ?debug=1 query param — admin can append this manually
 *      on any device, even one they're not signed into. Useful when
 *      a user reports an error and the admin wants to reproduce it
 *      on a fresh browser without having to log in first.
 *   3. Current Supabase session belongs to the admin email
 *      (ADMIN_EMAIL constant from src/lib/notifyAdmin.js — kept
 *      duplicated here as a literal to keep this hook standalone
 *      and resilient to import failures during error boundaries).
 *
 * IMPORTANT — failure modes:
 *   This hook is called from inside ErrorBoundary's fallback UI.
 *   When the boundary catches an error, OTHER parts of the app may
 *   also be broken — AuthContext might have crashed, supabase client
 *   might be unavailable. We therefore CANNOT rely on:
 *     - useAuth() hook (might re-throw)
 *     - imported supabase client (might be the source of the error)
 *
 *   Instead, we read the Supabase session directly from localStorage
 *   (where the supabase-js client persists it). Every read is wrapped
 *   in try/catch — any failure means 'cannot determine identity' and
 *   we fail closed (no details shown). This is the safer default
 *   because the WORST outcome of failing closed is 'admin doesn't
 *   see details and has to add ?debug=1' — a minor inconvenience.
 *   The worst outcome of failing OPEN would be leaking stack traces
 *   to end users — a privacy regression.
 *
 *   localStorage may also throw on Safari private browsing or when
 *   3rd-party cookies are disabled — same fail-closed outcome.
 *
 * USAGE:
 *   const canSeeDetails = useCanSeeDebugDetails();
 *   {error && canSeeDetails && (
 *     <button onClick={...}>Show technical details</button>
 *   )}
 */
export function useCanSeeDebugDetails() {
  const [canSee, setCanSee] = useState(false);

  useEffect(() => {
    // Dev/preview build → always allow
    if (import.meta.env.DEV) {
      setCanSee(true);
      return;
    }

    // ?debug=1 URL override (works for admins on fresh devices)
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has("debug")) {
        setCanSee(true);
        return;
      }
    } catch { /* no-op */ }

    // Admin session check via localStorage. Supabase persists the
    // current session under a key matching 'sb-<projectref>-auth-token'.
    // We iterate localStorage keys (typically very small) and
    // attempt to parse each candidate. Anything throws → ignored.
    try {
      const ADMIN_EMAIL = "souqnamarketplace@gmail.com";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // Different supabase-js versions nest the session differently:
        //   v2:    { access_token, user: { email, ... } }
        //   older: { currentSession: { user: { email, ... } } }
        const email =
          parsed?.user?.email ||
          parsed?.currentSession?.user?.email ||
          parsed?.session?.user?.email;
        if (email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          setCanSee(true);
          return;
        }
      }
    } catch { /* no-op — fail closed */ }
  }, []);

  return canSee;
}
