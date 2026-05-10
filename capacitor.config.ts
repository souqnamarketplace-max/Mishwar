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
    backgroundColor: "#faf5e6",  // brand cream — flashes during cold boot
    captureInput: true,          // smarter keyboard handling for Arabic IME
    webContentsDebuggingEnabled: false, // disable in production builds
  },

  // ─── iOS-specific runtime config ──────────────────────────────────
  ios: {
    contentInset: "automatic",   // respect safe areas (notch, home bar)
    backgroundColor: "#faf5e6",
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
  // Production: leave url unset — the app loads from `webDir` (bundled
  // dist/). The hostname below tells Capacitor what origin to use
  // internally for cookies and CORS — must match what the server-side
  // code (api/trip.js, Supabase auth redirects) expects.
  server: {
    // For production builds, leave commented. The app loads dist/ locally.
    // url: "http://192.168.1.42:5173",
    // cleartext: true,
    androidScheme: "https",
    iosScheme: "https",
    // App-internal hostname — keeps cookies / localStorage / Supabase
    // session keyed to this origin instead of the random Capacitor
    // ionic://localhost. Match the production domain so a session
    // started in the web app can be recognized in the native shell
    // when the user signs in (not currently needed but future-proof).
    hostname: "www.mishwaro.com",
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
      style: "DARK",                       // light icons on dark forest green bg
      backgroundColor: "#1a3d2a",
      overlay: false,                      // status bar is its own area, not overlaid
    },

    Keyboard: {
      // Fix the common iOS bug where the keyboard pushes the WebView up
      // and breaks fixed-position elements. "body" mode is the modern
      // fix for Capacitor 5+; everything renders correctly without
      // manual safe-area calculation in CSS.
      resize: "body",
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
