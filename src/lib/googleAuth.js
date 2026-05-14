/**
 * googleAuth.js — Google OAuth entry points for Mishwaro.
 *
 * Two flows live behind one function, decided at call time by checking
 * Capacitor.isNativePlatform():
 *
 *   WEB
 *   ─────────────────────────────────────────────────────────────────
 *   The standard redirect flow Supabase ships out of the box. We call
 *   signInWithOAuth(); Supabase redirects the browser to Google;
 *   Google authenticates and redirects back to Supabase
 *   (.../auth/v1/callback); Supabase finally redirects to the URL we
 *   pass as `redirectTo` with the session in the URL hash. Our
 *   supabase client is configured with detectSessionInUrl:true
 *   (lib/supabase.js L97), so it picks the session up automatically
 *   and the AuthContext sees the SIGNED_IN event without any callback
 *   plumbing on our side.
 *
 *   NATIVE (iOS + Android, Capacitor)
 *   ─────────────────────────────────────────────────────────────────
 *   A WKWebView can't follow an external redirect — there's nowhere
 *   for the browser to go because the app IS the browser. So we ask
 *   Supabase for the OAuth URL but tell it NOT to redirect us
 *   (skipBrowserRedirect:true), then open that URL in the system
 *   browser via @capacitor/browser. Google authenticates, redirects
 *   back to Supabase, Supabase redirects to mishwaro://auth/callback
 *   (our custom URL scheme — see ios/App/App/Info.plist and
 *   android/app/src/main/AndroidManifest.xml). The OS routes that
 *   deep link back to the app, the listener in native.js catches it,
 *   closes the browser sheet, and calls setSession() with the tokens
 *   from the URL hash.
 *
 *   For this to work end-to-end you must ALSO:
 *     1. Have toggled Google on in the Supabase Auth dashboard with
 *        the Web OAuth client ID + secret (done).
 *     2. Register the redirect URL `mishwaro://auth/callback` in the
 *        Supabase dashboard under Authentication → URL Configuration
 *        → Redirect URLs. Without this Supabase will reject the
 *        callback as not-whitelisted and you'll get
 *        "Invalid redirect URL" after Google auth.
 *     3. Add the URL scheme to iOS (Info.plist CFBundleURLTypes) and
 *        Android (AndroidManifest.xml intent-filter). See the commit
 *        message and the project guide for the exact snippets.
 */

import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";

// Custom URL scheme our app registers with iOS + Android so OAuth
// callbacks deep-link back into the app instead of staying in the
// system browser. Must match Info.plist + AndroidManifest entries.
const NATIVE_REDIRECT = "mishwaro://auth/callback";

// Web returns here after Supabase finishes the OAuth handshake. The
// route doesn't need any special handling — any page with detectSession
// InUrl:true on the supabase client picks up the hash automatically.
// Sending users to / (Home) means a brand-new Google-only signup lands
// on the same screen they'd see after a normal login.
function getWebRedirect() {
  // window may not exist at module-load time during SSG / Vite SSR
  // prerender — read lazily inside the function.
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/`;
}

/**
 * Start a Sign-in-with-Google flow. Returns whatever Supabase returns;
 * on native this resolves as soon as the system browser opens (the
 * actual session is set later by the deep-link listener), so callers
 * should NOT navigate based on the awaited value — let onAuthStateChange
 * in AuthContext drive navigation. Throws on configuration errors only
 * (e.g. provider disabled in Supabase, network unreachable).
 */
export async function signInWithGoogle() {
  if (!Capacitor.isNativePlatform()) {
    // Web path — Supabase handles the entire redirect dance.
    return supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getWebRedirect() },
    });
  }

  // Native path — get the URL, open it in @capacitor/browser ourselves.
  // skipBrowserRedirect:true is the key flag: without it, signInWithOAuth
  // would call window.location.assign() inside the WKWebView, which
  // navigates AWAY from our React app to Google's login page — and once
  // the user finishes, there's no way for Google to return to a WebView
  // (it tries to redirect to mishwaro://, which Chrome/Safari handle but
  // the in-app WebView can't).
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_REDIRECT,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("signInWithGoogle: no OAuth URL returned");

  // Dynamic import keeps the @capacitor/browser bundle out of the web
  // bundle on /login, matching the lazy-load pattern in lib/native.js.
  // Browsers without Capacitor never load this module.
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover" });

  // Don't return data.session — there isn't one yet. The deep-link
  // listener in native.js will finish the handshake by calling
  // supabase.auth.setSession({access_token, refresh_token}) once
  // Google + Supabase redirect back to mishwaro://auth/callback.
  return data;
}
