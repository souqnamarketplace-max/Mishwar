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

    // 1) Status bar — light icons on the dark brand background.
    //    Style.Dark = light foreground icons (counterintuitive naming).
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#1a3d2a" }).catch(() => {});
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

    // 6) App URL open — handle deep links into the app (e.g. tapping
     //   a notification or a https://www.mishwaro.com/trip/abc link
     //   from another app). Capacitor passes the URL; we extract the
     //   path and feed it to React Router.
    CapApp.addListener("appUrlOpen", (event) => {
      try {
        const url = new URL(event.url);
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
