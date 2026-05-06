# Capacitor — App Store + Play Store wrapper

Closes the native-shell prerequisite for App Store / Play Store submission.
The Capacitor config at repo root (`capacitor.config.ts`) is committed; the
platform-specific `ios/` and `android/` folders are NOT — they are
regenerated locally per developer.

This document is a runbook for the day you decide to ship to the stores.
Today, only the config is scaffolded. No npm deps added — installing
Capacitor pulls ~10 MB of platform tooling, so we defer it until
genuinely needed.

---

## When to do this

You should NOT submit to App Store or Play Store until:

- ✅ Phase 0 + Phase 1 SQL migrations applied (security baseline)
- ⏳ Privacy policy + Terms reviewed by lawyer (audit C-10)
- ⏳ Privacy nutrition labels drafted (Apple) and Data Safety form
  drafted (Google)
- ⏳ App Store / Play Store developer accounts created
  ($99/year Apple, $25 one-time Google)
- ⏳ Test signed builds running on physical devices
- ⏳ Beta tested with real users via TestFlight / Play Console internal track

This runbook gets you from "Capacitor not installed" to "signed build on
a device" — about a half day of work for someone who has done it before,
two days for first-timers.

---

## One-time setup (per developer machine)

### 1. Install Capacitor + plugins

```bash
npm i --save \
  @capacitor/core \
  @capacitor/cli \
  @capacitor/ios \
  @capacitor/android \
  @capacitor/splash-screen \
  @capacitor/status-bar \
  @capacitor/keyboard \
  @capacitor/preferences \
  @capacitor/share
```

Optional plugins to consider later:

```bash
@capacitor/push-notifications   # background push for closed-app delivery (H-09)
@capacitor/geolocation          # native location (currently using browser API)
@capacitor/camera               # native camera (currently <input capture="user">)
@capacitor/haptics              # subtle UI feedback
```

### 2. Add native platforms

```bash
npx cap add ios
npx cap add android
```

This creates `ios/` and `android/` folders. Both are gitignored — every
developer regenerates locally. The source of truth is `capacitor.config.ts`.

### 3. First build + sync

```bash
npm run build    # vite produces dist/
npx cap sync     # copies dist/ into ios/App/App/public and android/app/src/main/assets/public
```

`cap sync` also copies the latest version of every plugin into the native
projects. Run it any time you `npm install` a new Capacitor plugin.

### 4. Open in native IDEs

```bash
npx cap open ios       # Xcode (macOS only)
npx cap open android   # Android Studio
```

Hit the **Run** button. The app should launch in the simulator with the
production SPA wrapped in a webview.

---

## Platform-specific configuration

### iOS (`ios/App/App/Info.plist`)

Add the following keys with Arabic descriptions (App Store reviewers will
test these strings appear at permission-prompt time):

```xml
<key>NSCameraUsageDescription</key>
<string>للتحقق من السائقين بصورة سيلفي</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>لاختيار صورة الملف الشخصي وصور الترخيص</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>لتحديد وصولك إلى الوجهة خلال الرحلة. لا يتم إرسال موقعك إلى خوادمنا.</string>

<key>CFBundleDisplayName</key>
<string>مِشوار</string>

<key>CFBundleLocalizations</key>
<array>
  <string>ar</string>
  <string>en</string>
</array>

<key>CFBundleDevelopmentRegion</key>
<string>ar</string>
```

**Critical:** the location string MUST match the privacy policy. Apple
reviewers compare the wording. The phrase "لا يتم إرسال موقعك إلى خوادمنا"
(your location is not sent to our servers) is what `gpsTracking.js`
actually does — keeping the strings consistent avoids rejection.

### Android (`android/app/src/main/AndroidManifest.xml`)

Add inside `<application>`:

```xml
<application
  android:name=".MainApplication"
  android:label="@string/app_name"
  android:icon="@mipmap/ic_launcher"
  android:roundIcon="@mipmap/ic_launcher_round"
  android:theme="@style/AppTheme"
  android:supportsRtl="true">
```

Add permissions inside `<manifest>` BEFORE `<application>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
```

Set the app name in `android/app/src/main/res/values/strings.xml`:

```xml
<resources>
    <string name="app_name">مِشوار</string>
    <string name="title_activity_main">مِشوار</string>
    <string name="package_name">ps.mishwar.app</string>
    <string name="custom_url_scheme">ps.mishwar.app</string>
</resources>
```

---

## Splash screen + icons

### Required asset sizes

| Platform | File | Size |
|---|---|---|
| iOS app icon | `ios/App/App/Assets.xcassets/AppIcon.appiconset/` | 1024×1024 (Apple generates the rest) |
| iOS splash | `ios/App/App/Assets.xcassets/Splash.imageset/` | 2732×2732 (universal) |
| Android icon | `android/app/src/main/res/mipmap-*/ic_launcher.png` | 48 / 72 / 96 / 144 / 192 (densities) |
| Android adaptive | `android/app/src/main/res/mipmap-anydpi-v26/` | foreground + background layers |
| Android splash | `android/app/src/main/res/drawable*/splash.png` | 480×800 minimum, scaled per density |

Easiest path: install [`@capacitor/assets`](https://capacitorjs.com/docs/guides/splash-screens-and-icons):

```bash
npm i --save-dev @capacitor/assets
mkdir -p resources
# Place icon.png (1024×1024) and splash.png (2732×2732) in resources/
npx capacitor-assets generate
```

This auto-generates every platform-specific size from two source images.

---

## Build + sign for release

### iOS — Xcode

1. Open `ios/App/App.xcworkspace` (NOT `.xcodeproj`)
2. Select target **App** → tab **Signing & Capabilities**
3. Sign in to Apple Developer account ($99/year)
4. Select team, set bundle identifier to `ps.mishwar.app`
5. **Product → Archive**
6. Once archived, **Distribute App → TestFlight & App Store**
7. Upload to App Store Connect
8. In App Store Connect: fill out app metadata, screenshots, privacy
   nutrition labels (see "Privacy disclosures" below)
9. Submit for review. First review takes ~24-72 hours.

### Android — Android Studio

1. Open `android/` folder in Android Studio
2. **Build → Generate Signed Bundle / APK**
3. Choose **Android App Bundle (.aab)** — required for Play Console
4. Create a new keystore (save to a secure location — losing it means
   you can never update the app without users uninstalling)
5. Upload the `.aab` to Play Console → Internal testing track first
6. Once tested, promote to Production

---

## Privacy disclosures

### Apple — Privacy Nutrition Labels

In App Store Connect → App Privacy, declare the following data
collection. **The disclosure MUST match what the privacy policy says.**

| Data type | Collected | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Name | Yes | Yes | No | App functionality |
| Email | Yes | Yes | No | App functionality |
| Phone number | Yes | Yes | No | App functionality |
| Photos | Yes | Yes | No | App functionality (avatar, license, selfie) |
| Government ID | Yes | Yes | No | App functionality (driver verification) |
| Location | Yes | No | No | App functionality (arrival detection — NOT stored) |
| Customer support data | Yes | Yes | No | App functionality |
| User content | Yes | Yes | No | App functionality (messages, reviews) |

If you start using analytics later, add: Product Interaction, Crash Data,
Performance Data — all "Linked to user: No" if anonymized.

### Google — Data Safety form

Play Console → App content → Data safety. The form structure is
similar to Apple's. Match the answers to Apple's verbatim where possible.

Critical: the "Data is encrypted in transit" and "You can request data
deletion" boxes BOTH must be checkable (they are — TLS via Vercel,
deletion via account-settings page).

---

## Live reload during native UI development

You can run the iOS / Android app pointed at your laptop's Vite dev
server so changes refresh instantly without rebuilding the native app.

1. Find your laptop's LAN IP: `ipconfig getifaddr en0` (macOS)
2. Edit `capacitor.config.ts`:
   ```ts
   server: {
     url: "http://192.168.1.42:5173",  // your IP
     cleartext: true,                    // dev only
     androidScheme: "https",
   },
   ```
3. `npm run dev` (Vite dev server)
4. `npx cap run ios` (or android) — installs to device, opens app
5. Edit React/Tailwind on your laptop — device refreshes

**Reset before commit:** comment out `server.url` and `server.cleartext`
before pushing. Don't ship a build with a LAN URL baked in.

---

## What NOT to commit

Already in `.gitignore`:
- `ios/`
- `android/`
- `.capacitor/`

Also keep out:
- Apple `.cer`, `.p12`, `.mobileprovision` files (signing certs)
- Android keystore (`.jks`, `.keystore`)
- App Store / Play Console API keys

Store these in a password manager + offline backup. **Losing the Android
keystore means you cannot update the app on Play Store** — users would
have to uninstall and reinstall.

---

## Submission checklist

Before clicking "Submit for review":

- [ ] All Phase 0 + Phase 1 SQL migrations applied
- [ ] hCaptcha enabled (audit H-06)
- [ ] Privacy policy + Terms lawyer-reviewed (audit C-10)
- [ ] Production deploy on Vercel green for at least a week
- [ ] No critical Sentry errors in last 7 days
- [ ] Test account credentials prepared for the App Store reviewer
  (they will log in and click around)
- [ ] Privacy nutrition labels filled out (Apple) and Data Safety form
  filled out (Google) — both match the privacy policy text
- [ ] Screenshots for both platforms (iPhone 6.5"/6.7" + iPad if iPad
  build, plus Android phone + tablet)
- [ ] App description, subtitle, keywords in Arabic + English
- [ ] Support email + privacy URL set in App Store Connect / Play Console
- [ ] Bundle version bumped (e.g. 1.0.0 → 1.0.1 for resubmission)
- [ ] In Capacitor: `server.url` is unset, no LAN dev URLs

---

## Common rejection reasons

| Reason | Fix |
|---|---|
| Privacy policy URL doesn't load | Verify https://mishwar-nu.vercel.app/privacy returns HTML |
| App requests permission without explanation | Make sure NSCameraUsageDescription etc. are set |
| "App is just a webview" (Apple Guideline 4.2) | Add native features: haptics, push, share, camera, biometric login. Even one or two natively-implemented features satisfies this |
| Sign-in not provided | Apple may require a test account. Have one ready and document it in the review notes |
| Account deletion not present | The app does have account deletion (audit C-05). Document the path: Settings → "حذف الحساب" |
| In-app purchases bypass | N/A — physical-world transport is exempt from IAP requirements per Apple Guideline 3.1.5 and Google's billing policy. Document this rationale in the review notes |
