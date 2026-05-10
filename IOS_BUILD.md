# iOS Build & App Store Submission Guide

Step-by-step guide to take Mishwaro from this repo on your Mac to a live
TestFlight build, and then to App Store review submission.

This guide assumes:
- ✅ You have an active **Apple Developer account** ($99/year)
- ✅ You have a **Mac** (Big Sur or later) with Xcode 15+ installed
- ✅ You have a **real iPhone** with iOS 13+ for device testing
- ✅ This repo is cloned on your Mac at e.g. `~/Projects/Mishwar`

If any of those are missing, stop and resolve them before continuing.

---

## Table of Contents

1. [One-time Mac setup](#one-time-mac-setup)
2. [First-time iOS project initialization](#first-time-ios-project-initialization)
3. [App icon + splash screen](#app-icon--splash-screen)  *(includes 2.5 — Arabic localization)*
4. [Test on simulator](#test-on-simulator)
5. [Test on real iPhone](#test-on-real-iphone)
6. [Code signing setup](#code-signing-setup)
7. [Build the .ipa archive](#build-the-ipa-archive)
8. [Upload to App Store Connect](#upload-to-app-store-connect)
9. [TestFlight internal testing](#testflight-internal-testing)
10. [App Store submission](#app-store-submission)
11. [Common rejection reasons + how to handle](#common-rejection-reasons)
12. [Updating the app later](#updating-the-app-later)

---

## One-time Mac setup

### 1.1 Install Xcode

Open the **Mac App Store**, search for "Xcode", install. Takes ~15 minutes.

After install, open Xcode once, accept the license agreement when prompted,
and let it install Command Line Tools.

Confirm in Terminal:

```bash
xcode-select -p
# Should print: /Applications/Xcode.app/Contents/Developer

xcodebuild -version
# Should print: Xcode 15.x or later
```

### 1.2 Install CocoaPods

CocoaPods is the iOS dependency manager. Capacitor uses it to wire native
plugins into the Xcode project.

```bash
sudo gem install cocoapods
pod --version
# Should print: 1.15 or later
```

If `gem` isn't found, install Homebrew first:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install cocoapods
```

### 1.3 Install Node.js

Match the version this project uses (Node 20 LTS):

```bash
# If you don't have Node yet:
brew install node@20
node --version
# Should print: v20.x.x
```

### 1.4 Sign into Xcode with your Apple Developer account

Xcode → Settings → Accounts → click `+` → Apple ID → enter your dev account
credentials. After sign-in, you should see your team name listed (e.g.
"Mishwaro" or your personal name).

This is what lets Xcode automatically download signing certificates and
provisioning profiles when you build.

---

## First-time iOS project initialization

The `ios/` directory is committed to this repo with the project structure,
permission strings, and build settings already configured. But you still
need to install CocoaPods dependencies on your Mac (the `Pods/` dir is
gitignored because it contains machine-specific binary builds).

```bash
cd ~/Projects/Mishwar
npm install                  # install Node deps if you haven't
npm run build                # produce dist/
npx cap sync ios             # copies dist/ + runs pod install
```

The `cap sync` step will:
1. Copy `dist/` to `ios/App/App/public/`
2. Run `pod install` inside `ios/App/` to pull native dependencies
3. Update `ios/App/Podfile.lock`

If `pod install` fails with "Compatibility issue with React Native repo",
that's because Capacitor and React Native both pull plugin pods. We don't
use React Native, so this shouldn't happen — but if it does:

```bash
cd ios/App
pod install --repo-update
```

---

## App icon + splash screen

Apple requires multiple sizes of your icon (1024×1024 down to 20×20). The
easiest approach: provide one 1024×1024 PNG and let Capacitor generate
the rest.

### 2.1 Prepare your icon

You need a **1024×1024 PNG**, square, with no transparency, no rounded
corners (iOS adds those automatically), and the brand mark centered with
~10% padding around the edges.

Use the Mishwaro logo:
- Forest green (#1a3d2a) background
- Gold "م" or full "مشوارو" wordmark in cream/gold (#c9a227 or #faf5e6)
- Save as `resources/icon-only.png` in the repo root

### 2.2 Prepare your splash screen

You also need a splash screen — shown for ~1.5s during cold boot.

Provide a **2732×2732 PNG** with the Mishwaro logo centered on the brand
forest green background. The image will be cropped/scaled for different
device sizes; keep important content within the center 60%.

Save as `resources/splash.png` in the repo root.

### 2.3 Generate all sizes

Use `@capacitor/assets` to auto-generate every required size:

```bash
npm install --save-dev @capacitor/assets
npx capacitor-assets generate --ios --android
```

This produces:
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/` — all 18 required iOS sizes
- `ios/App/App/Assets.xcassets/Splash.imageset/` — universal splash
- Android equivalents in `android/app/src/main/res/`

### 2.4 Verify icons in Xcode

Open the project: `npm run cap:ios` (this builds + syncs + opens Xcode).

In Xcode's left panel, navigate to **App > App > Assets.xcassets >
AppIcon**. You should see all icon sizes filled in. If any are missing,
the App Store submission will be rejected.

---

### 2.5 Wire up Arabic localization (one-time, ~2 min)

The repo includes `ios/App/App/ar.lproj/InfoPlist.strings` and
`ios/App/App/en.lproj/InfoPlist.strings` — these localize:

- The display name under the home-screen icon (Arabic users see مشوارو,
  English users see Mishwaro)
- All permission prompts ("App wants to use your location") in the
  user's preferred language

These files exist on disk but Xcode doesn't auto-pick them up — you
need to add them to the project once. Do this:

1. In Xcode's left panel, find the **App** group (top-level folder)
2. **Right-click** → **Add Files to "App"...**
3. In the file picker, navigate to `ios/App/App/`
4. Select **both** `ar.lproj` and `en.lproj` folders (Cmd+click both)
5. **Important:** check that **"Create folder references"** is selected
   (NOT "Create groups") — you want Xcode to track the folders, not
   copy the contents
6. Verify "Add to targets: ☑ App" is checked
7. Click **Add**

After this, Xcode's left panel shows `ar.lproj` and `en.lproj` under
**App**, each with `InfoPlist.strings` inside. Build the project
(Product → Build) — no errors expected.

To verify it worked:
- Open Settings on your iPhone → General → Language & Region → set
  iPhone language to **العربية (Arabic)**
- Reinstall the app via Xcode
- Home screen icon now shows **مشوارو**, not **Mishwaro**
- When the app asks for location permission, the prompt is in Arabic

If you see "Mishwaro" with Arabic system language, the strings file
isn't wired up — re-do step 5 making sure "Create folder references"
was selected.

> **Why dual format?** Apple's HIG (Human Interface Guidelines) says
> non-Latin display names work but English-first improves App Store
> search discoverability. The clean solution: keep the English string
> as the default, override per-locale via InfoPlist.strings. The App
> Store listing name (set in App Store Connect, not in code) can be
> "Mishwaro — مشوارو" so search results show both scripts.

---

## Test on simulator

Quick sanity check that the app boots before plugging in a real device.

In Xcode:
1. Select a simulator from the device dropdown at the top (e.g. **iPhone 15**)
2. Click the **▶️ Play** button (top left)
3. The simulator launches, Mishwaro splash appears, then the app loads

What to verify in the simulator:
- ✅ Splash screen shows for ~1.5s with brand colors
- ✅ Status bar is dark (light icons on forest green)
- ✅ Arabic text renders right-to-left correctly
- ✅ Bottom nav doesn't get cropped by the home indicator
- ✅ Tapping a trip card navigates to /trip/:id
- ✅ Login form works (Supabase reaches www.mishwaro.com)

What WON'T work in the simulator (need real device):
- 🚫 Real GPS location (simulator gives fake Apple HQ coordinates)
- 🚫 Camera (simulator only has a fake "checker" image)
- 🚫 Push notifications (APNs not available in simulator)
- 🚫 Real performance (simulator runs at Mac speed, masks slowness)

---

## Test on real iPhone

### 5.1 Plug in your iPhone

USB-C or Lightning cable. Trust the computer if prompted on the phone.

### 5.2 Select your device in Xcode

Top device dropdown → your iPhone should appear. If it shows "Preparing
iPhone for development", wait — Xcode is downloading device support
files, can take 5-10 minutes the first time.

### 5.3 Trust the developer profile (one-time)

When you first run a build on your iPhone, iOS will refuse to launch it
because the developer cert isn't trusted. To fix:

iPhone → Settings → General → VPN & Device Management → tap your developer
account email → **Trust "Apple Development: ..."** → confirm.

### 5.4 Run on device

Click ▶️ Play in Xcode. The app installs and launches on your iPhone.

What to verify on real hardware:
- ✅ GPS gives your actual location (test on /create-trip pickup picker)
- ✅ Camera works for license/selfie upload
- ✅ Splash transition is smooth (no white flash)
- ✅ Arabic keyboard input works in text fields
- ✅ Tapping system back gestures works (swipe from left edge)
- ✅ App resumes correctly after backgrounding (lock phone, unlock)

If any of these fail, fix before continuing to TestFlight.

---

## Code signing setup

This is where most first-time submitters get stuck. The basic concept:
**Apple won't run your app on any device, anywhere, unless it's signed
with a certificate they recognize.**

For TestFlight + App Store, you need a **Distribution** certificate
(separate from the Development cert that Xcode auto-creates for testing).

### 6.1 Enable Automatic Signing (recommended)

This is the easiest path. Xcode handles cert + provisioning profile
generation automatically.

In Xcode:
1. Click the project name "App" in the left panel
2. Select the "App" target (under TARGETS)
3. Go to "Signing & Capabilities" tab
4. ✅ Check "Automatically manage signing"
5. Team: select your Apple Developer team from the dropdown
6. Bundle Identifier: should already say `com.mishwaro.app`

Xcode will automatically create:
- A development provisioning profile (for running on your phone)
- A distribution provisioning profile (created later when you archive)

If Xcode shows red "Failed to register bundle identifier", that means
`com.mishwaro.app` is already registered to a different Apple Developer
account. Pick a different bundle ID — but remember this is permanent.

### 6.2 Verify the App ID is registered

Go to https://developer.apple.com/account/resources/identifiers/list

You should see `com.mishwaro.app` in the list with type "App ID". If not,
click the `+` button to register it manually:
- Description: Mishwaro
- Bundle ID: Explicit, `com.mishwaro.app`
- Capabilities: Push Notifications (check this if you'll use them)

---

## Build the .ipa archive

The `.ipa` file is what gets uploaded to App Store Connect. Built via
"Archive" in Xcode.

### 7.1 Set the destination to "Any iOS Device (arm64)"

Top device dropdown in Xcode → "Any iOS Device (arm64)". This is
**required** for archiving — you cannot archive while a simulator is
selected.

### 7.2 Build the archive

Xcode menu: **Product → Archive**.

Takes 2-5 minutes. When done, the **Organizer** window opens
automatically showing your archives.

If you get errors:
- "No signing certificate" → go back to Signing & Capabilities, the
  team/cert is misconfigured
- "MARKETING_VERSION needs to be incremented" → in
  ios/App/App.xcodeproj/project.pbxproj search for MARKETING_VERSION,
  bump from 1.0 to 1.0.1 (only matters for resubmissions)

### 7.3 Validate the archive (optional but smart)

In Organizer, with your archive selected, click "Validate App". Apple
runs a remote validation to catch obvious issues before upload. Takes
2-3 minutes. Fix any errors before continuing.

---

## Upload to App Store Connect

In Organizer, with your validated archive selected:

1. Click **Distribute App**
2. Select **App Store Connect**
3. Select **Upload**
4. Use **Automatic signing** (Xcode picks the dist profile)
5. Click **Upload**

Takes 5-15 minutes for upload + Apple's processing. You'll get an email
when it's done — usually within an hour, though Apple has been known to
take 24h on bad days.

After processing, the build appears in App Store Connect under your app's
**TestFlight** tab.

---

## TestFlight internal testing

ALWAYS test via TestFlight before submitting to App Store review. Catches
bugs that don't show up on developer-built ipa files.

### 9.1 Set up your app in App Store Connect

If you haven't yet:
1. Go to https://appstoreconnect.apple.com/apps
2. Click `+` → New App
3. Platform: iOS
4. Name: **Mishwaro** (this is what shows on App Store; max 30 chars)
5. Primary language: Arabic
6. Bundle ID: `com.mishwaro.app` (select from dropdown)
7. SKU: `mishwaro-001` (any unique string for your records)
8. User Access: Full Access
9. Click Create

### 9.2 Add your build to TestFlight

In App Store Connect → your app → **TestFlight** tab.

Wait for the build to finish processing (status: "Ready to Submit"). Then:
1. Click the build
2. Fill in **Test Information**:
   - Beta App Description: "تطبيق فلسطيني لمشاركة رحلات السيارة بين المدن" (or similar)
   - Beta App Feedback Email: souqnamarketplace@gmail.com
   - Beta App Marketing URL: https://www.mishwaro.com
3. Add yourself as an Internal Tester:
   - Internal Testing tab → click `+` → enter your Apple ID email
4. Save

### 9.3 Install on your iPhone via TestFlight

1. On your iPhone, install the **TestFlight** app from the App Store
2. Sign in with the same Apple ID you added as Internal Tester
3. Mishwaro will appear — tap Install
4. App installs as a normal-looking iPhone app (no developer banner)

What to test in TestFlight:
- ✅ Cold boot from icon tap (not Xcode play button)
- ✅ Sign up with a brand new email; receive confirmation; tap link
- ✅ Sign up flow on first install (no cached state)
- ✅ Push notifications (if you configured them server-side)
- ✅ Background → foreground transitions
- ✅ All payment flows (book a trip, see payment-info screen)
- ✅ Driver onboarding with real license photo upload
- ✅ Permission prompts (location, camera, photos) — verify Arabic strings

### 9.4 Add external testers (optional)

If you want trusted Palestinian friends to test before App Store review:
- TestFlight tab → External Testing → click `+`
- Add their email addresses
- Apple does a 1-day "Beta App Review" before they can install
- Up to 10,000 external testers; great for early feedback

---

## App Store submission

When TestFlight is solid (no crashes, all flows work), submit for
production review.

### 10.1 Fill in App Store metadata

In App Store Connect → your app → **App Store** tab → "1.0 Prepare for
Submission".

#### Required fields:

**App Information**
- Privacy Policy URL: `https://www.mishwaro.com/privacy` (must exist!)
- Category: Travel
- Secondary Category: Navigation
- Content Rights: No (you don't license third-party content)

**Pricing and Availability**
- Price: Free
- Availability: All countries — OR limit to Palestinian Territories +
  Israel + Jordan if you want phased rollout

**App Privacy** (the big one)
- Click "Get Started" under Data Privacy
- For each data type (Location, Name, Email, Phone, Photos):
  - Tracking: No
  - Linked to user: Yes
  - Purpose: App Functionality (and Analytics if Sentry tracks identifiable data)
- Save

**Version Information** (per-version, refilled each release)
- What's New in This Version: "الإصدار الأول من تطبيق مشوارو 🚗" (or similar)
- Promotional Text (170 chars): Marketing pitch, can update without
  resubmission. e.g. "شارك رحلتك. وفّر المال. سافر بأمان مع مشوارو."
- Description (4000 chars): Full app description. Include keywords like
  مشاركة رحلات, نابلس, رام الله, القدس, تنقل
- Keywords (100 chars): comma-separated. e.g. "مشاوير,رحلات,نابلس,رام الله,سفر"
- Support URL: https://www.mishwaro.com/support
- Marketing URL: https://www.mishwaro.com

**Build**
- Click `+ Build` → select the TestFlight build you tested

**Screenshots** (the most painful part)
- 6.5" iPhone (1284 × 2778): 5-10 screenshots. Required.
- 5.5" iPhone (1242 × 2208): 5-10 screenshots. Required for older devices.
- iPad screenshots: only if you support iPad (we don't yet — skip)

Take screenshots from your real iPhone via TestFlight. Hold Volume Up +
Power button. AirDrop to Mac. Resize/edit if needed (some screens look
better with overlay text via Figma/Photoshop, but raw screenshots are fine
for initial submission).

**App Review Information**
- Sign-in required: YES
- Provide test account: Create a special test driver + test passenger
  account in production Supabase, give them realistic test data
  (1-2 trips, some bookings) so reviewers see a non-empty experience.
  Submit credentials in this section.
- Notes: "هذا تطبيق مشاركة رحلات في فلسطين. الدفع خارج التطبيق (تحويل
  بنكي / Jawwal Pay / كاش). معاملات النقل المادي معفاة من قاعدة 3.1.5
  حسب توجيهات Apple Review."
  (Translation: "This is a ride-sharing app in Palestine. Payments are
  outside the app (bank transfer / Jawwal Pay / cash). Physical transport
  transactions are exempt from rule 3.1.5 per Apple Review guidelines.")

**Age Rating**
- Click "Edit" → answer the questionnaire honestly. Mishwaro should rate
  4+ (no objectionable content). If you have user-generated content
  (messages, profile photos), Apple may bump to 12+ — that's fine.

**Version Release**
- Manually release: ON (you click "Release" after approval; safer)
- Or "Automatically release after approval": OFF for first launch

### 10.2 Submit

Top right of the page → **Submit for Review**.

Apple will ask 2 final questions:
- Export Compliance: "Does your app use encryption?"
  - Answer: YES (HTTPS counts)
  - Then: "Does it qualify for exemptions?"
  - Answer: YES (HTTPS-only with standard ciphers is exempt)
- Content Rights: NO (no third-party content)
- Advertising Identifier: NO (you don't use IDFA)

Click Submit.

### 10.3 Wait

Typical review time: **1-3 days**. You'll get email status updates:
- "Waiting for Review" → in queue
- "In Review" → reviewer is testing
- "Approved" 🎉 OR
- "Rejected" with reason

If rejected, see next section.

---

## Common rejection reasons

### "Guideline 3.1.1 — In-App Purchase: digital goods"
**False positive for ride-share apps.** Apple sometimes flags Mishwaro's
payment screens because the reviewer didn't understand it's physical
transport. **Reply via Resolution Center:**

> "Hi review team, the booking flow facilitates payment for physical
> transportation services (ride-sharing between cities in Palestine).
> Per App Store Review Guideline 3.1.5(a), 'Goods and Services Outside
> of the App', physical transportation is explicitly exempt from the
> in-app purchase requirement. The bank transfer / Jawwal Pay / cash
> options are how Palestinian users pay for real-world rides in their
> own currency. Please reconsider."

Usually approved on resubmission.

### "Guideline 5.1.1(ix) — Driver background checks"
Apple requires ride-share apps to verify drivers. **Reply with:**

> "Mishwaro requires every driver to submit a Palestinian driver's
> license + vehicle registration + insurance documentation, manually
> reviewed by our admin team before the driver can publish trips.
> See [link to /how-it-works on www.mishwaro.com] for the documented
> verification process."

### "Guideline 5.1.1 — Privacy / data collection without consent"
Probably triggered by missing/incomplete Data Privacy disclosure. Go back
to App Privacy section, fill in every data type the app collects.

### "Metadata Rejected — placeholder text"
Your description, keywords, or screenshots reference "lorem ipsum" or
unfilled template fields. Fill in everything for real.

### "App crashes on launch"
Reviewer's specific iPhone model crashes. Check Xcode crash logs for
device IDs. Often due to missing Info.plist permission strings — make
sure all four (Camera, Photos, Location, PhotosAdd) are present.

### "Empty content / unable to test"
Your test account has no trips, no bookings, nothing to demonstrate.
Seed real test data: at least 3 active trips on different routes,
2 bookings in different states, a verified driver profile.

---

## Updating the app later

After your first submission is approved, future updates follow the same
flow but skip most of the metadata:

1. Make code changes, test locally
2. Bump versions in `ios/App/App.xcodeproj/project.pbxproj`:
   - `MARKETING_VERSION = 1.0.1` (user-visible version)
   - `CURRENT_PROJECT_VERSION = 2` (always increment, even for re-uploads)
3. `npm run cap:sync` then archive in Xcode
4. Upload via Organizer
5. In App Store Connect → click `+ Version` → enter "What's New" → submit

For minor updates (typo fixes, small features), Apple often approves in
under 24 hours. Major version changes (1.x → 2.0) get more scrutiny.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `pod install` fails with "incompatible architecture" | `cd ios/App && arch -x86_64 pod install` (Intel emulation on M1/M2) |
| Xcode: "Could not locate device support files" | Update Xcode to the latest version |
| Xcode: "Untrusted Developer" on iPhone | iPhone → Settings → General → VPN & Device Management → Trust |
| "Build input file cannot be found" | Run `npm run cap:sync` to refresh the dist/ → ios sync |
| Splash screen flashes white before showing | Check capacitor.config.ts → SplashScreen.backgroundColor |
| Status bar is wrong color (black on dark bg) | Check src/lib/native.js → StatusBar.setStyle config |
| Push notifications don't arrive | Need APNs cert + Firebase setup; not covered here. Skip for v1. |
| Privacy policy URL doesn't load | Verify https://www.mishwaro.com/privacy returns HTML |
| Demo account credentials don't work in App Review | Re-test the credentials yourself before submitting |

---

## Reference Links

- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Capacitor docs: https://capacitorjs.com/docs/ios
- App Store Connect: https://appstoreconnect.apple.com
- Apple Developer console: https://developer.apple.com/account
- Resolution Center (after rejection): https://appstoreconnect.apple.com/Resolution

---

*Last updated: 2026-05-10*
*Capacitor version: 8.x*
*iOS deployment target: 13.0*
