/**
 * Native bridge for Capacitor iOS / Android shells.
 *
 * Called once on app boot from src/main.jsx. Detects whether we're
 * running in a native Capacitor wrapper vs a regular browser, and if
 * native, performs setup that only makes sense there:
 *
 *   - Hides the splash screen once React has mounted
 *   - Sets the status bar style to match the brand (light icons on
 *     forest green background)
 *   - Listens for hardware back button (Android) and routes to React
 *     Router's history instead of exiting the app
 *   - Wires up app state changes (foreground/background) so we can
 *     refresh the auth session when the app comes back to foreground
 *
 * In a regular web browser this entire module is a no-op. The
 * `Capacitor.isNativePlatform()` check is the cheapest possible
 * runtime gate — Capacitor.core ships a stub that returns false in
 * non-native contexts, so we don't pull native-only modules into the
 * web bundle execution path.
 *
 * IMPORTANT: this file MUST stay safe to import from a web-only
 * environment. Never use top-level await on a Capacitor plugin or
 * the entire app will fail to start in browsers.
 */

import { Capacitor } from "@capacitor/core";

// Lazily import these — only when actually running native — so the
// web bundle doesn't include their code on the initial parse pass.
// Vite's tree-shaker will still bundle them, but they won't execute.
async function loadNativeModules() {
  const [
    { App: CapApp },
    { SplashScreen },
    { StatusBar, Style },
    { Keyboard },
  ] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/splash-screen"),
    import("@capacitor/status-bar"),
    import("@capacitor/keyboard"),
  ]);
  return { CapApp, SplashScreen, StatusBar, Style, Keyboard };
}

/**
 * Initialize native-only behavior. Call once from main.jsx after
 * React renders.
 *
 * Returns Promise<void>. Errors are caught and logged but never
 * thrown — a native-init failure should never break the web app.
 */
export async function initNativeShell() {
  if (!Capacitor.isNativePlatform()) {
    // Web browser — nothing to do.
    return;
  }

  try {
    const { CapApp, SplashScreen, StatusBar, Style, Keyboard } =
      await loadNativeModules();

    // 1) Status bar — dark icons on the white bg-card header. Both
    //    iOS and Android now use overlay (StatusBar.overlay:true in
    //    capacitor.config.ts on iOS; setOverlaysWebView on Android
    //    below) so the WebView extends UNDER the status bar and the
    //    sticky header's safe-area-inset-top padding fills the notch
    //    zone with white. Style.Light = dark foreground icons —
    //    Capacitor's enum is named for the background brightness,
    //    not the icon color. Was Style.Dark (light icons) back when
    //    the status bar had its own forest-green strip.
    await StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    if (Capacitor.getPlatform() === "android") {
      // Tell Android to let the WebView draw under the status bar,
      // matching iOS overlay:true. Without this, Android reserves a
      // strip at the top and fills it with the color set below.
      await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      // Transparent so the white header bleeds through. Some Android
      // versions ignore alpha and fall back to solid — #ffffff is the
      // safe value either way (matches the header bg).
      await StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => {});
    }

    // 2) Splash screen — hide as soon as React has rendered. The
    //    capacitor.config.ts has launchAutoHide:true with a 1500ms
    //    timer, so this is belt-and-suspenders to ensure a snappy
    //    boot if React renders faster than the timer.
    SplashScreen.hide().catch(() => {});

    // 3) Hardware back button (Android only — iOS has no back button).
    //    Default Capacitor behavior is to exit the app on back press
    //    at the root, which is correct, but we want intermediate back
    //    presses to route through React Router rather than the
    //    WebView's native history. Most React Router setups handle
    //    this automatically because they call history.back(); we just
    //    need to NOT block the default.
    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        // At the root — let the OS handle it (minimize app on Android).
        CapApp.exitApp();
      }
    });

    // 4) Keyboard show/hide — iOS-specific UX. When the keyboard
    //    appears we add a class to <body> so CSS can shift fixed
    //    elements (e.g., the bottom nav bar would otherwise be
    //    covered by the keyboard).
    if (Capacitor.getPlatform() === "ios") {
      Keyboard.addListener("keyboardWillShow", () => {
        document.body.classList.add("keyboard-visible");
      });
      Keyboard.addListener("keyboardWillHide", () => {
        document.body.classList.remove("keyboard-visible");
      });
    }

    // 5) Foreground/background — when the user backgrounds and returns,
    //    refresh the Supabase session token. Mobile users often leave
    //    apps open for days; tokens expire silently and the next API
    //    call would 401. This listener proactively refreshes when the
    //    app comes back.
    CapApp.addListener("appStateChange", async ({ isActive }) => {
      if (isActive) {
        // Dynamic import to avoid pulling Supabase into the native
        // init path before it's needed.
        const { supabase } = await import("@/lib/supabase");
        try {
          await supabase.auth.getSession();
        } catch {
          // Silent — if the session is gone the user will be redirected
          // to /login on the next protected route navigation.
        }
      }
    });

    // 6) App URL open — handle deep links into the app. Two cases:
    //
    //    (a) OAuth callback — `mishwaro://auth/callback#access_token=...&
    //        refresh_token=...`. After Sign-in-with-Google in @capacitor/
    //        browser, Supabase redirects to this URL; iOS/Android route
    //        that scheme back to the app and this listener fires. We
    //        parse the tokens out of the hash, call setSession() so the
    //        Supabase client picks the user up (and onAuthStateChange
    //        fires SIGNED_IN — AuthContext handles navigation from
    //        there), then close the system browser sheet so the user is
    //        looking at the app instead of the OAuth page. This branch
    //        explicitly does NOT fall through to the React Router push
    //        below — there is no "/callback" route to land on, and we
    //        don't want the URL bar showing the tokens to the user.
    //
    //    (b) Generic deep link — e.g. tapping a notification or a
    //        https://www.mishwaro.com/trip/abc link from another app.
    //        Pull the path and feed it to React Router.
    CapApp.addListener("appUrlOpen", async (event) => {
      try {
        const url = new URL(event.url);

        // (a) Google OAuth callback
        if (url.protocol === "mishwaro:" && url.host === "auth" && url.pathname === "/callback") {
          // Tokens come back in the URL fragment per the OAuth implicit
          // flow that Supabase uses. Hash is "#key=val&key=val" — strip
          // the leading "#" before URLSearchParams.
          const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
          const access_token  = hashParams.get("access_token");
          const refresh_token = hashParams.get("refresh_token");
          if (access_token && refresh_token) {
            const { supabase } = await import("@/lib/supabase");
            try {
              await supabase.auth.setSession({ access_token, refresh_token });
            } catch (e) {
              console.warn("[native] setSession from OAuth callback failed:", e?.message);
            }
          } else {
            // The hash didn't carry tokens — could mean Supabase appended
            // an error_description=... query param instead. Log it so the
            // user (and the audit trail) can see what went wrong. Common
            // causes: redirect URL not whitelisted in Supabase, Google
            // OAuth consent screen still pending verification, user
            // tapped Cancel on the consent screen.
            const errorMsg = url.searchParams.get("error_description") || url.searchParams.get("error");
            console.warn("[native] OAuth callback without tokens:", errorMsg || "unknown");
          }
          // Whatever happened, return the user to the app surface.
          try {
            const { Browser } = await import("@capacitor/browser");
            await Browser.close();
          } catch {
            // Browser plugin not installed / already closed — non-fatal.
          }
          return;
        }

        // (b) Generic deep link → React Router
        const path = url.pathname + url.search + url.hash;
        if (path && path !== "/") {
          // history.pushState then dispatch popstate so React Router picks it up
          window.history.pushState({}, "", path);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      } catch (e) {
        console.warn("[native] appUrlOpen parse failed:", e);
      }
    });
  } catch (err) {
    console.error("[native] init failed:", err);
    // Never throw — the app must keep running.
  }
}

/**
 * Convenience flag for components that want to render differently in
 * the native shell (e.g., hide the "Open in App" CTA which only makes
 * sense on web).
 */
export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform(); // "ios" | "android" | "web"
