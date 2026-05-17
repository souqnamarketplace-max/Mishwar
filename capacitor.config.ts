/// <reference types="@capacitor/cli" />
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wrapper for Mishwaro — مشوارو.
 *
 * The same Vite-built SPA that runs at https://www.mishwaro.com is what
 * ships inside the iOS / Android shells. After `vite build`, the contents
 * of `dist/` are bundled into the native app and loaded by the WebView.
 *
 * ─── Production build workflow ─────────────────────────────────────────
 *   1. npm run build              # produces dist/
 *   2. npx cap sync               # copies dist/ into ios/ + android/
 *   3. npx cap open ios           # opens Xcode (Mac only)
 *   4. npx cap open android       # opens Android Studio (any OS)
 *
 * ─── Dev workflow with live reload (during native UI tweaks) ──────────
 *   1. npm run dev                # vite dev server on :5173
 *   2. Set server.url below to your Mac's LAN IP (e.g. 192.168.1.42:5173)
 *      and uncomment cleartext: true
 *   3. npx cap run ios            # device pulls live from your Mac
 *   ⚠️ NEVER commit a real LAN URL — only enable locally during dev.
 *
 * ─── App identity ──────────────────────────────────────────────────────
 *   Bundle ID and Display Name are PERMANENT once shipped to App Store /
 *   Play Store. Apple won't let you change appId post-publish without
 *   creating a brand-new app listing (which means losing reviews, ASO
 *   ranking, and existing TestFlight users). Triple-check before the
 *   first store submission.
 */
const config: CapacitorConfig = {
  // Reverse-DNS bundle ID. Apple + Google both use this format. Must be
  // globally unique across the App Store. PERMANENT once shipped.
  // Note: this is unrelated to the public domain mishwaro.com — it's
  // just a unique reverse-DNS identifier Apple/Google use to track apps.
  appId: "com.mishwaro.app",

  // Display name shown under the icon on the iPhone home screen.
  // Apple recommends English-first for non-Latin apps because the App
  // Store search index works better with Latin characters. Users see
  // this string on their home screen — keep it under 12 chars to avoid
  // truncation on small devices.
  appName: "Mishwaro",

  // The SPA build output that gets packaged into the native app.
  webDir: "dist",

  // ─── Android-specific runtime config ──────────────────────────────
  android: {
    allowMixedContent: false,    // require https for all network requests
    // Window background color shown behind the WebView during cold-boot
    // flash and (if the native nav-bar / status-bar were ever set to
    // transparent) in the inset zones. Was cream #faf5e6 — visually
    // matched the brand palette but mismatched the white `--card`
    // surfaces (header, tab bar) the user actually sees, leaving a
    // cream halo around the chrome. White makes the inset zone visually
    // flush with the chrome.
    backgroundColor: "#ffffff",
    captureInput: true,          // smarter keyboard handling for Arabic IME
    webContentsDebuggingEnabled: false, // disable in production builds
  },

  // ─── iOS-specific runtime config ──────────────────────────────────
  ios: {
    // Was "automatic" — which made WKScrollView add an inset for the
    // home-indicator safe area. The native window bg then showed
    // through that inset zone as a cream stripe under our white
    // bg-card tab bar. With "never" the WebView reaches the screen's
    // bottom edge and the tab bar's own .safe-area-inset-bottom
    // utility (env(safe-area-inset-bottom) → ~34px on home-indicator
    // devices) fills that zone with bg-card white — same color as
    // the tab bar itself, so no visible seam.
    contentInset: "never",
    // Window bg shown behind the WebView during cold-boot flash and
    // anywhere the WebView itself is transparent. White matches the
    // header/tab-bar surfaces so the boot flash is the same color
    // family as the chrome.
    backgroundColor: "#ffffff",
    scrollEnabled: true,
    // Required Info.plist permission strings — set during `npx cap add ios`
    // and editable in ios/App/App/Info.plist:
    //   NSLocationWhenInUseUsageDescription   "لتحديد وصولك إلى الوجهة خلال الرحلة"
    //   NSCameraUsageDescription              "للتحقق من السائقين بصورة سيلفي"
    //   NSPhotoLibraryUsageDescription        "لاختيار صورة الملف الشخصي"
    //   NSPhotoLibraryAddUsageDescription     "لحفظ صور الرحلة في معرض الصور"
    // App Store review will REJECT submissions missing these strings if the
    // app uses the corresponding APIs — the strings are user-facing so
    // they must be in Arabic for our locale.
  },

  // ─── Server config ────────────────────────────────────────────────
  //
  // CRITICAL — DO NOT set `hostname: "www.mishwaro.com"` with
  // `iosScheme: "https"`. That combination makes the iOS WKWebView
  // load the app over the public internet from
  // https://www.mishwaro.com/, BYPASSING the bundled `dist/` entirely.
  // We hit that bug once — debug session 2026-05-17 — and the symptom
  // is mysterious: native code rebuilds and reinstalls correctly, the
  // JS bundle in `ios/App/App/public/` is current, but the user sees
  // a stale UI because the WebView is silently loading Vercel's last
  // deploy instead. Catastrophic on flaky networks (ERR_NETWORK_CHANGED
  // floods the console) and impossible to ship to App Store reviewers
  // who'll test on airplane mode.
  //
  // The correct pattern for loading the bundled app while still
  // namespacing cookies/storage to a stable origin is:
  //   - iosScheme: "capacitor"  (the Capacitor 4+ default)
  //   - hostname: "localhost"   (or omit entirely)
  // This makes the WebView load from `capacitor://localhost/` which
  // resolves to the local bundle. Cookies and localStorage are
  // keyed to that origin and persist across launches.
  //
  // If you ever NEED to point at a remote URL (e.g. live-reload during
  // native dev), set `server.url` explicitly — that's the documented
  // way. Never rely on hostname+scheme to do it implicitly.
  //
  // Android uses `https://localhost` by default which is fine; the
  // androidScheme below makes it consistent.
  server: {
    // For production builds, leave url unset. The app loads dist/ locally.
    // For dev with live-reload: uncomment and point at your LAN IP.
    //   url: "http://192.168.1.42:5173",
    //   cleartext: true,
    androidScheme: "https",
    iosScheme: "capacitor",
    // No hostname — let Capacitor use its default (localhost). The
    // previous value (www.mishwaro.com) combined with iosScheme:https
    // caused the WebView to fetch from the real internet.
  },

  // ─── Plugin configuration ─────────────────────────────────────────
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,           // ms to show splash before fade
      launchAutoHide: true,                // auto-fade vs hold until JS calls hide()
      backgroundColor: "#1a3d2a",          // brand forest green
      androidScaleType: "CENTER_CROP",
      showSpinner: false,                  // we have our own loading UI
      iosSpinnerStyle: "small",
      spinnerColor: "#c9a227",             // gold (used if showSpinner true)
    },

    StatusBar: {
      // Style names are inverted from intuition: "LIGHT" means "for a
      // LIGHT background", i.e. it renders DARK icons. Our sticky
      // header is white bg-card, so we need dark status-bar icons
      // (time, wifi, battery) to be readable.
      style: "LIGHT",
      // No backgroundColor key — iOS ignores it (status-bar bg is
      // system-managed and effectively transparent over whatever the
      // WebView paints underneath). Android sets bg at runtime in
      // src/lib/native.js if needed.
      // overlay:true makes the WKWebView extend UNDER the status bar
      // instead of being pushed below it. The sticky header's
      // safe-area-inset-top padding then fills the notch / dynamic-
      // island zone with bg-card white — same color as the header
      // itself — and the status-bar icons render on top of it. Was
      // false, which reserved that zone OUTSIDE the WebView and
      // filled it with the iOS native window bg as a visible cream
      // (now white) stripe disconnected from the header.
      overlay: true,
    },

    Keyboard: {
      // For chat-heavy apps, "native" works better than "body" because
      // it doesn't reflow the entire web view — the WKWebView shrinks
      // its visible area and our sticky-bottom composer stays anchored
      // just above the keyboard. Previously "body" mode caused the
      // composer to be hidden behind the keyboard when the input field
      // was focused inside the Messages screen.
      resize: "native",
      style: "DARK",
      resizeOnFullScreen: true,
    },

    PushNotifications: {
      // iOS: presents banner+sound when notification arrives in foreground
      // (default behavior is to stay silent when app is open).
      presentationOptions: ["badge", "sound", "alert"],
    },

    // Geolocation, Camera, Network, Preferences, Haptics, Device, App —
    // all use sensible defaults out of the box, no config needed here.
    // Permission prompts trigger on first use of the API.
  },
};

export default config;
