import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables');
}

// ─── Remember-Me storage adapter ───────────────────────────────────────
//
// Supabase by default stores the auth session in localStorage, which
// persists across browser restarts. That's the "remembered" behaviour.
// To support "Remember me OFF" (session ends when the browser closes),
// we route writes to sessionStorage instead — sessionStorage is auto-
// cleared by the browser when the tab closes.
//
// The flag itself lives in localStorage (key REMEMBER_KEY) so it
// persists between login attempts, separately from the actual auth
// token. Default is REMEMBERED (most users expect to stay logged in).
//
// Reads check sessionStorage first, then localStorage, so an in-flight
// session is found regardless of which store it currently lives in
// (this matters during the brief moment between login and the first
// setItem call where Supabase might read before write).

const REMEMBER_KEY = 'mishwaro_remember_me';

function isRemembered() {
  try {
    // Default true: only treat as "not remembered" if explicitly set to "0"
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

const rememberMeStorage = {
  getItem: (key) => {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (isRemembered()) {
        localStorage.setItem(key, value);
        // Clean up any stale sessionStorage entry from a previous "no
        // remember" session so the storage doesn't drift.
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore — private browsing / disabled storage falls back to
      // in-memory session via Supabase's own buffer.
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

/**
 * Set the remember-me preference. Call this BEFORE the login request
 * so that when Supabase writes the new session, our storage adapter
 * routes it to the correct backing store.
 *
 * @param {boolean} remember  true = persist across browser restart,
 *                            false = session ends on browser close
 */
export function setRememberMe(remember) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    // ignore
  }
}

/** Read the current remember-me preference (for UI initial state). */
export function getRememberMe() {
  return isRemembered();
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: rememberMeStorage,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export default supabase;
