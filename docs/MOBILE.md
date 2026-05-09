# Mobile app (Capacitor) — runbook

This document covers turning the مشوارو web app into native iOS and
Android apps for App Store / Play Store submission. Capacitor is the
chosen wrapper because it keeps the React/Vite SPA as the source of
truth — the same code that runs at https://mishwar-nu.vercel.app is
what runs inside the native shells.

The repo ships with the **scaffolding only** (`capacitor.config.ts`
and this doc). Platform-specific projects (`ios/`, `android/`) are
generated locally and gitignored.

## Prerequisites

- macOS with Xcode 15+ (iOS only — required by Apple)
- Android Studio Hedgehog (2023.1) or newer (Android)
- Apple Developer account ($99/year) — only needed at submission time
- Google Play Console account ($25 one-time) — same

## One-time setup

```bash
# Install Capacitor and the iOS + Android platforms
npm install --save-dev @capacitor/cli
npm install --save @capacitor/core @capacitor/ios @capacitor/android

# Install plugins we configured for in capacitor.config.ts
npm install --save @capacitor/splash-screen @capacitor/status-bar

# Optional plugins worth considering at launch
npm install --save @capacitor/app             # back button handling
npm install --save @capacitor/keyboard        # iOS keyboard avoiding
npm install --save @capacitor/network         # offline detection
npm install --save @capacitor/preferences     # secure key/value (iOS Keychain / Android KeyStore)

# Generate native projects (creates ios/ and android/ dirs)
npx cap add ios
npx cap add android
```

After this, you'll have local `ios/` and `android/` folders. They're
in `.gitignore` — do NOT commit them. They regenerate from
`capacitor.config.ts`.

## Build → Run cycle

Every time you change web code:

```bash
npm run build           # produces dist/
npx cap sync            # copies dist/ into both platforms
npx cap open ios        # opens in Xcode
# OR
npx cap open android    # opens in Android Studio
```

In Xcode / Android Studio, hit Run. The native shell loads `dist/`.

## Live-reload during native UI tweaks

When you're iterating on native config (splash, status bar, deep
links, push permissions) and want JS hot-reload from your laptop:

1. Edit `capacitor.config.ts` to set
   ```ts
   server: {
     url: "http://192.168.1.42:5173",   // your laptop's LAN IP
     cleartext: true,
     androidScheme: "https",
   }
   ```
2. `npm run dev` (Vite dev server on :5173)
3. `npx cap sync && npx cap run ios`
4. The phone pulls JS live from your laptop. **NEVER commit a
   non-empty `server.url`** — that would point production builds at
   your dev machine.

## What's pre-configured in `capacitor.config.ts`

| Setting | Value | Why |
|---|---|---|
| `appId` | `ps.mishwar.app` | Reverse-DNS bundle ID. Globally unique. **Cannot change post-launch.** |
| `appName` | `مشوارو` | Display name |
| `webDir` | `dist` | Output of `vite build` |
| Splash background | `#1a3d2a` | Brand forest green |
| Status bar style | `DARK` | Matches dark-on-cream UI |
| `androidScheme` | `https` | Force HTTPS for in-app navigation |
| `allowMixedContent` | `false` | Block HTTP-on-HTTPS leaks |

## Native permissions you must add

These go in the platform projects after `npx cap add`. Both stores
will reject the app without them.

### iOS — `ios/App/App/Info.plist`

```xml
<key>NSCameraUsageDescription</key>
<string>للتحقق من السائقين بصورة سيلفي</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>لاختيار صورة الملف الشخصي</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>لتحديد وصولك إلى الوجهة خلال الرحلة</string>
```

### Android — `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## Code differences for native context

The web app already mostly works inside Capacitor with no changes.
A few small tweaks improve UX:

```js
// src/main.jsx or App.jsx — detect native context
import { Capacitor } from "@capacitor/core";

if (Capacitor.isNativePlatform()) {
  // Configure status bar, hide splash, etc.
  import("@capacitor/splash-screen").then(({ SplashScreen }) => {
    SplashScreen.hide();
  });
}
```

Open links externally instead of inside the WebView:

```js
import { Capacitor } from "@capacitor/core";
// where you have a target="_blank" link:
if (Capacitor.isNativePlatform()) {
  // use Browser plugin for external links so they don't get
  // trapped inside the app
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
} else {
  window.open(url, "_blank", "noopener,noreferrer");
}
```

## Submission

### iOS (App Store)

1. In Xcode: Product → Archive
2. Distribute via App Store Connect
3. Upload screenshots (App Store Connect requires 6.7" + 6.5" + 5.5" iPhone sizes plus iPad if you support iPad)
4. Fill in App Privacy section — you MUST disclose:
   - Location (used for app functionality, not tracking)
   - Camera (selfie verification)
   - Photos (avatar selection)
   - Identifiers (Auth user ID — Supabase)
5. Submit for review (typical 24-48h)

### Android (Play Store)

1. In Android Studio: Build → Generate Signed Bundle (.aab)
2. Upload to Play Console
3. Fill in Data Safety section (parallel to Apple's App Privacy)
4. Internal testing → Closed testing → Production rollout

## Common pitfalls

| Pitfall | Fix |
|---|---|
| Splash screen sticks too long | Configure SplashScreen plugin, call `SplashScreen.hide()` after first paint |
| Status bar overlaps content on iOS | Use `safe-area-inset-top` in CSS, or set `contentInset: 'automatic'` (already set) |
| Back button closes app on Android instead of going back | Wire `@capacitor/app` to `App.addListener("backButton")` to navigate router |
| External links open inside app | Use `@capacitor/browser` for any `_blank` links |
| Push notifications don't work | Web Push doesn't work in Capacitor — switch to `@capacitor/push-notifications` (FCM/APNs) |
| API calls fail on Android with mixed-content | All endpoints must be https; we already set `allowMixedContent: false` |

## Open questions / decisions

- **Push notifications** — current web foreground-only wiring (`5fe0d65`)
  doesn't carry to native. Switching to `@capacitor/push-notifications`
  means going through APNs and FCM tokens which is its own integration.
  Defer until launch-week.
- **Deep links** — for `mishwar://trip/<id>` style links to open
  the app, configure URL schemes in Info.plist + AndroidManifest.xml
  AND add `App.addListener("appUrlOpen")` handlers.
- **Stores' commission policy on rideshare** — Apple and Google both
  exempt physical-world transport (Uber, Lyft, BlaBlaCar pattern).
  Mishwaro is in the same category. The IAP rules apply to digital
  goods only — cash / Jawwal Pay / Reflect / bank transfers are fine.

## Related docs

- [`/docs/PRE-LAUNCH.md`](PRE-LAUNCH.md) — audit-finding tracker (mobile readiness section)
- [`/docs/OPERATIONS.md`](OPERATIONS.md) — backups, alerting, incident response
