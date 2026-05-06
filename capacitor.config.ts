/// <reference types="@capacitor/cli" />
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wrapper for مِشوار.
 *
 * The same Vite-built SPA that runs at https://mishwar-nu.vercel.app
 * is what ships inside the iOS / Android shells. After `vite build`,
 * the contents of `dist/` are bundled into the native app.
 *
 * Workflow:
 *   1. npm run build              # produces dist/
 *   2. npx cap sync               # copies dist/ into ios/ and android/
 *   3. npx cap open ios           # open in Xcode
 *   4. npx cap open android       # open in Android Studio
 *
 * Dev workflow with live reload (during native UI tweaks):
 *   1. npm run dev                # vite dev server on :5173
 *   2. Update `server.url` below to your laptop's LAN IP, e.g.
 *      "http://192.168.1.42:5173"
 *   3. npx cap run ios            # device pulls live from your laptop
 *
 * Identifiers below MUST be unique to this app. Once published they
 * cannot be changed without creating a new app store listing.
 */
const config: CapacitorConfig = {
  // Reverse-DNS bundle ID. Apple + Google both use this; must be
  // globally unique. Cannot change post-launch.
  appId: "ps.mishwar.app",

  // Name shown under the icon on home screens. Unicode is fine for
  // Android; iOS uses CFBundleDisplayName which we set in Info.plist.
  // The native projects' Info.plist / strings.xml are what users
  // actually see — keep this matching for sync.
  appName: "مِشوار",

  // The SPA build output that gets packaged into the native app.
  webDir: "dist",

  // Platforms: managed via `npx cap add ios` / `npx cap add android`
  // — they generate `ios/` and `android/` folders that should NOT
  // be checked in (added to .gitignore). The platform-specific
  // settings live in those folders' Info.plist / AndroidManifest.xml.

  // Capacitor runtime config
  android: {
    allowMixedContent: false,    // require https everywhere
    backgroundColor: "#faf5e6",  // brand cream
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#faf5e6",
    // Required for haptics, status-bar styling, deep links.
    // Set in Info.plist by the @capacitor/ios setup; documented here
    // so the operator knows what's expected.
    // - NSCameraUsageDescription          "للتحقق من السائقين بصورة سيلفي"
    // - NSPhotoLibraryUsageDescription    "لاختيار صورة الملف الشخصي"
    // - NSLocationWhenInUseUsageDescription "لتحديد وصولك إلى الوجهة خلال الرحلة"
  },

  server: {
    // For production builds, leave empty — the app loads from `webDir`
    // (i.e. the bundled dist/). Uncomment + set during dev with live
    // reload. NEVER commit a real LAN URL.
    //
    // url: "http://192.168.1.42:5173",
    // cleartext: true,  // allow http during dev only
    androidScheme: "https",
  },

  // Plugin configuration — add as plugins are installed
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#1a3d2a",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#1a3d2a",
      overlay: false,
    },
  },
};

export default config;
