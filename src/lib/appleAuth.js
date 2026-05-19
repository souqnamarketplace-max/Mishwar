/**
 * appleAuth.js — Sign-in-with-Apple entry point for Mishwaro.
 *
 * Three flows live behind one function. Apple is the awkward middle
 * child of OAuth providers: iOS has its own native sheet that bypasses
 * the browser entirely, but every other platform falls back to the
 * standard OAuth redirect dance.
 *
 *   iOS (native, Capacitor)
 *   ─────────────────────────────────────────────────────────────────
 *   Use @capacitor-community/apple-sign-in to invoke
 *   ASAuthorizationAppleIDProvider. The OS shows the system sheet
 *   (Face ID, "Hide My Email", etc.) and returns an identity token
 *   signed by Apple. We exchange that token for a Supabase session
 *   via signInWithIdToken — no browser, no deep link, no callback URL.
 *   Replay protection via SHA-256-hashed nonce: the raw nonce goes to
 *   Supabase, the hash goes to Apple, Supabase verifies by hashing the
 *   raw value and comparing it against the JWT's `nonce` claim.
 *
 *   Web
 *   ─────────────────────────────────────────────────────────────────
 *   Same redirect flow as Google. signInWithOAuth() → Apple's web
 *   sign-in page → Supabase callback → redirectTo with session in hash.
 *   detectSessionInUrl on the supabase client picks it up automatically.
 *
 *   Android (native, Capacitor)
 *   ─────────────────────────────────────────────────────────────────
 *   No native Apple SDK on Android, so we use the same pattern as
 *   Google native: get the OAuth URL with skipBrowserRedirect:true,
 *   open it in @capacitor/browser, deep-link back via mishwaro://.
 *
 * For this to work end-to-end you must ALSO:
 *   1. Supabase Auth → Providers → Apple enabled with Client IDs
 *      "com.mishwaro.app.signin,com.mishwaro.app" + a current JWT
 *      client secret (regenerate via scripts/generate-apple-jwt.cjs
 *      every ~5 months — Apple caps it at 6).
 *   2. Apple Developer Portal: Services ID com.mishwaro.app.signin
 *      configured with primary App ID com.mishwaro.app, return URL
 *      https://dimtdwahtwaslmnuakij.supabase.co/auth/v1/callback.
 *   3. Sign In with Apple capability enabled in Xcode on the App
 *      target (writes com.apple.developer.applesignin to entitlements).
 *   4. mishwaro://auth/callback already whitelisted in Supabase
 *      Authentication → URL Configuration → Redirect URLs (done for
 *      Google, same scheme reused here).
 */

import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";

// Must match Info.plist + AndroidManifest, same scheme Google uses.
const NATIVE_REDIRECT = "mishwaro://auth/callback";

// The Services ID is what Supabase sends to Apple as the OAuth client_id
// for the web flow (it's listed first in our Supabase Client IDs field).
// The bundle ID below is the iOS app identifier — Apple uses the value
// from entitlements for the native flow, but the plugin still requires
// a clientId arg, so we pass the bundle ID for clarity.
const IOS_BUNDLE_ID = "com.mishwaro.app";

// Required by the plugin signature even on iOS, where it's ignored —
// the system never actually redirects on the native flow because the
// identity token comes back through the delegate, not a URL.
const PLUGIN_REDIRECT = "https://dimtdwahtwaslmnuakij.supabase.co/auth/v1/callback";

function getWebRedirect() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/`;
}

// SHA-256 → lowercase hex. We hash the nonce before sending to Apple so
// that an intercepted JWT can't be replayed against Supabase — the raw
// nonce is required to verify, and it never leaves our client.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 32-byte random nonce, base64url encoded. Generated fresh per sign-in
// attempt — never reused, never logged, never stored.
function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Start a Sign-in-with-Apple flow. Mirrors signInWithGoogle's contract:
 * on iOS native, resolves with the Supabase response once the session
 * is set; on web/Android, resolves as soon as the browser opens and
 * AuthContext's onAuthStateChange handles the actual sign-in event.
 *
 * Throws on configuration errors, missing tokens, or any non-cancel
 * Apple/Supabase error. User-cancellation should be detected by the
 * caller (error code "1001" on iOS, or message containing "canceled")
 * and swallowed silently — it's not an error worth toasting.
 */
export async function signInWithApple() {
  const platform = Capacitor.getPlatform();

  // ────────────────────────────────────────────────────────────────
  // iOS native — Apple's own sheet via the community plugin.
  // ────────────────────────────────────────────────────────────────
  if (platform === "ios") {
    const { SignInWithApple } = await import(
      "@capacitor-community/apple-sign-in"
    );
    const rawNonce = randomNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    const result = await SignInWithApple.authorize({
      clientId: IOS_BUNDLE_ID,
      redirectURI: PLUGIN_REDIRECT,
      scopes: "email name",
      nonce: hashedNonce,
    });

    const idToken = result?.response?.identityToken;
    if (!idToken) {
      // Almost always means user dismissed the sheet without completing.
      // Caller treats this as cancellation.
      throw new Error("Apple sign-in returned no identity token");
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: idToken,
      nonce: rawNonce,
    });
    if (error) throw error;
    return data;
  }

  // ────────────────────────────────────────────────────────────────
  // Web — standard Supabase OAuth redirect.
  // ────────────────────────────────────────────────────────────────
  if (!Capacitor.isNativePlatform()) {
    return supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: getWebRedirect() },
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Android native — OAuth URL + @capacitor/browser + deep link.
  // Same pattern as Google. The deep-link listener in lib/native.js
  // catches mishwaro://auth/callback and calls setSession().
  // ────────────────────────────────────────────────────────────────
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("signInWithApple: no OAuth URL returned");

  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover" });
  return data;
}
