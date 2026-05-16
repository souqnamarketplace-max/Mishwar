# Push Notifications — Handoff & Testing Guide

This document is the single source of truth for finishing the push
notifications pipeline. The code is done. Six commits land everything
on `main`. What's left is configuration + real-device testing.

Follow the steps **in order**. Each section is self-contained and
ends with a clear "done" check.

---

## What's done (code-level)

| # | Commit | What it does |
|---|---|---|
| 1 | `cf8aede` | `device_tokens` table + RPCs (`upsert_device_token`, `delete_my_device_token`) |
| 2 | `c13f053` | Edge Function `send-push-notification` |
| 3 | `3d30141` | Postgres trigger on `notifications` INSERT |
| 4 | `655b3c9` | Frontend Capacitor push integration + AuthContext lifecycle |
| 5 | `11c9b8f` | iOS `AppDelegate.swift` Firebase Messaging integration |
| 6 | `ae62bc8` | Android `POST_NOTIFICATIONS` permission + Firebase BoM |

## What's done (Firebase / Apple side)

- ✅ Firebase project `Mishwaro` created (Spark plan)
- ✅ Android app `com.mishwaro.app` registered; `google-services.json` in `android/app/`
- ✅ iOS app `com.mishwaro.app` registered; `GoogleService-Info.plist` in `ios/App/App/`
- ✅ APNS Auth Key `8NVYX93HK7` uploaded to Firebase (Sandbox + Production slots, Team `TNRL5XN485`)
- ✅ Firebase Admin service account `3c75f800b389...` (the active key)
- ✅ `FIREBASE_SERVICE_ACCOUNT` Supabase Edge Function secret saved

---

## ▼ STEP 1 — Apply migration 060 in Supabase

Open the Supabase SQL editor. Paste the contents of
`migrations/060_notifications_push_trigger.sql`. Click **Run without
RLS**.

You should see at the bottom:

```
NOTICE: MIGRATION 060 OK — push trigger installed (vault secrets pending if reminders above appeared)
```

It's normal for two `REMINDER` notices to appear above that — they
warn that the vault secrets aren't set yet. We set them in Step 2.

**Done check:** the `trg_notifications_send_push` trigger exists. To
verify, run:

```sql
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_notifications_send_push';
```

Should return one row.

---

## ▼ STEP 2 — Set the two Vault secrets

The push trigger reads these secrets to know where to POST and how to
authenticate. Until both are set, the trigger logs a warning and skips
(so notifications still get inserted, just no push fires).

### 2a. Get your service_role JWT

1. Supabase Dashboard → **Project Settings** → **API Keys** tab
2. Find **service_role** under "Project API keys" (NOT the publishable
   anon key; this is the one labeled "secret" with a warning icon)
3. Click "Reveal" → copy the JWT (starts with `eyJ...`)

This JWT is sensitive — anyone with it has full admin DB access.
Don't paste it in chat, don't commit it to git.

### 2b. Run these in Supabase SQL editor

```sql
-- URL to invoke this project's Edge Functions
SELECT vault.create_secret(
  'https://dimtdwahtwaslmnuakij.functions.supabase.co',
  'project_functions_url',
  'Base URL for invoking this project Edge Functions'
);

-- service_role JWT (paste between the quotes — replace PASTE_HERE)
SELECT vault.create_secret(
  'PASTE_SERVICE_ROLE_KEY_HERE',
  'service_role_key',
  'Service role JWT used by push trigger to invoke Edge Functions'
);
```

**Done check:** Run

```sql
SELECT name FROM vault.decrypted_secrets
 WHERE name IN ('project_functions_url', 'service_role_key');
```

Should return two rows.

---

## ▼ STEP 3 — Deploy the Edge Function

The Edge Function code is in `supabase/functions/send-push-notification/`.
It needs to be deployed to Supabase so the trigger has something to
call.

### 3a. Install Supabase CLI (if you haven't)

```bash
brew install supabase/tap/supabase
```

### 3b. Login to your Supabase project

```bash
cd /Users/katykate/Desktop/projects/Mishwaro
supabase login
```

A browser opens. Sign in with the same Google account you use for
the Supabase dashboard. Authorize the CLI.

### 3c. Link the local repo to the remote project

```bash
supabase link --project-ref dimtdwahtwaslmnuakij
```

You may be asked for the database password — paste it from your
password manager (it's stored under "Supabase Mishwaro DB password"
or similar). If you don't have it, you can reset it from Supabase
Dashboard → Settings → Database → Reset database password.

### 3d. Deploy the function

```bash
supabase functions deploy send-push-notification
```

Output should end with:

```
Deployed Function send-push-notification on project dimtdwahtwaslmnuakij
You can inspect your deployment in the Dashboard...
```

**Done check:** In Supabase Dashboard → **Edge Functions**, you
should see `send-push-notification` with a green "Active" status.

---

## ▼ STEP 4 — Add Firebase iOS SDK in Xcode

The `AppDelegate.swift` from commit `11c9b8f` has `import FirebaseCore`
and `import FirebaseMessaging`. These will fail to compile until you
add the Firebase iOS SDK to the Xcode project. Capacitor's
auto-managed `Package.swift` cannot be edited (CI rewrites it on every
`cap sync`), so this is a manual Xcode step.

1. Open Xcode:
   ```bash
   open /Users/katykate/Desktop/projects/Mishwaro/ios/App/App.xcworkspace
   ```
   **Open `.xcworkspace`, NOT `.xcodeproj`**.

2. In Xcode's menu bar: **File → Add Package Dependencies...**

3. In the dialog's search bar (top-right):
   ```
   https://github.com/firebase/firebase-ios-sdk
   ```
   Press Enter. Xcode takes ~30 seconds to fetch the package list.

4. Once "firebase-ios-sdk" appears in the left panel of the dialog,
   keep "Dependency Rule" = "Up to Next Major Version" (the default).
   Click **Add Package** (top-right).

5. A new dialog appears: "Choose Package Products for firebase-ios-sdk".
   This is a long list. Check **ONLY**:

   - ✅ `FirebaseMessaging`
   - ✅ `FirebaseAnalytics` (Xcode auto-checks this — leave checked)

   **Uncheck everything else** if Xcode pre-selected any. Adding
   unused Firebase products bloats the app bundle by 50+ MB and
   triggers App Store review warnings.

6. Make sure the dropdown next to FirebaseMessaging says "App" (not
   "None"). This adds it to your main target.

7. Click **Add Package**. Xcode indexes for ~1 minute.

8. Quit and reopen Xcode if it gets stuck.

**Done check:** In the Project Navigator (left sidebar), expand
**Package Dependencies**. You should see `firebase-ios-sdk` listed.

---

## ▼ STEP 5 — Add iOS Capabilities

iOS requires explicit entitlements for push notifications.

1. In Xcode, click the **project name** at the very top of the left
   sidebar (the blue project icon)
2. In the center pane, select the **App** target (under "TARGETS")
3. Click the **Signing & Capabilities** tab at the top
4. Click **+ Capability** (top-left of the capabilities list)
5. Search for and double-click **Push Notifications** → it's added
6. Click **+ Capability** again
7. Search for and double-click **Background Modes** → it's added
8. In the Background Modes section, check **☑ Remote notifications**

**Done check:** The Signing & Capabilities tab shows three boxes:

- Signing
- Push Notifications
- Background Modes (with "Remote notifications" checked)

---

## ▼ STEP 6 — Sync Capacitor + build

Now that all the native config is in place, sync the JS bundle to
native:

```bash
cd /Users/katykate/Desktop/projects/Mishwaro
npm install            # in case any plugin updates landed
npm run build          # builds the web bundle
npx cap sync ios       # copies web → iOS, regenerates Pods/SPM
npx cap sync android   # copies web → Android, regenerates Gradle
```

`cap sync ios` will regenerate `CapApp-SPM/Package.swift`. **This is
expected** — the Firebase SDK you added in Xcode lives in the project
file, not in `Package.swift`, so it survives.

**Done check:**

```bash
ls ios/App/App/public/index.html
ls android/app/src/main/assets/public/index.html
```

Both should exist and have today's date.

---

## ▼ STEP 7 — Test on a real iOS device

iOS push **CANNOT** be tested in the Simulator. Apple disabled APNS
there. You need a physical iPhone.

1. Plug your iPhone into your Mac with a USB cable
2. Open Xcode → top toolbar → select your iPhone as the target device
   (next to the play button). If your iPhone isn't listed:
   - Unlock the phone
   - Trust the computer ("Trust this computer?" prompt)
   - Wait for Xcode to finish "Preparing for development"
3. Click the **Play button** (▶) in Xcode to build + install + launch

The app installs on your phone and launches. **On first launch when
you log in**, you should see an iOS permission prompt:

> "Mishwaro" Would Like to Send You Notifications
> Notifications may include alerts, sounds, and icon badges.
> [Don't Allow] [Allow]

Tap **Allow**.

### Trigger a test push

Easiest way: in Supabase SQL editor, run:

```sql
INSERT INTO public.notifications (user_email, type, title, message, link)
VALUES (
  'YOUR_TEST_USER_EMAIL@example.com',
  'admin',
  'Test push',
  'This is a test of the push notification system. If you see this on your phone, the pipeline works end-to-end!',
  '/dashboard'
);
```

Replace `YOUR_TEST_USER_EMAIL@example.com` with the email of the
account you logged into on the phone.

**Within 5-10 seconds**, you should see a banner on your iPhone:

```
مشوارو
إشعار من الإدارة
This is a test of the push notification system...
```

(The title is "إشعار من الإدارة" because the trigger maps `type =
'admin'` to that Arabic title.)

---

## ▼ STEP 8 — Test on a real Android device

Less ceremonial than iOS, but still needs a real device with Google
Play Services (any modern Android phone has this — emulators with
Play Services also work).

1. Enable USB Debugging on the phone:
   - Settings → About Phone → tap "Build number" 7 times until
     "Developer mode enabled"
   - Settings → Developer options → enable "USB debugging"
2. Plug in USB. Accept the "Allow USB debugging from this computer"
   prompt on the phone.
3. In Android Studio (open `android/` folder), select your device in
   the top toolbar and click ▶.

   Or via command line:
   ```bash
   npx cap run android
   ```

4. On first login, Android 13+ shows a runtime permission prompt:

   > Allow Mishwaro to send you notifications?
   > [Don't allow] [Allow]

   Tap **Allow**.

5. Trigger a push the same way as Step 7 (INSERT a row into
   `notifications` via SQL editor, with the Android user's email).

Within ~5 seconds, an Android notification banner appears.

---

## Troubleshooting matrix

If push doesn't arrive, work down this list in order.

### A. Did the row insert succeed?

```sql
SELECT id, user_email, type, title, message, created_at
  FROM public.notifications
 ORDER BY created_at DESC
 LIMIT 5;
```

If your row is missing, the INSERT itself failed — go check
permissions / column types.

### B. Did the trigger fire?

```sql
-- Look for log entries from pg_net within the last 5 minutes
SELECT status_code, content, created
  FROM net._http_response
 ORDER BY created DESC
 LIMIT 10;
```

| What you see | What it means |
|---|---|
| Rows with `status_code = 200` | Trigger fired AND Edge Function returned success. Push delivery is downstream (FCM / device). |
| Rows with `status_code = 401` | Edge Function rejected the auth. Vault `service_role_key` is wrong/expired. |
| Rows with `status_code = 500` | Edge Function crashed. Check Edge Function logs (see C). |
| No rows at all | Trigger didn't fire OR pg_net isn't enabled. Check vault secrets are set (Step 2). |

### C. Edge Function logs

Supabase Dashboard → Edge Functions → `send-push-notification` →
**Logs** tab. Filter by last 1 hour.

| Log line | Diagnosis |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT secret not configured` | Secret missing — set it. |
| `OAuth token exchange failed: 401` | Service account JSON is invalid OR the key has been revoked. Generate a fresh one + re-paste. |
| `FCM send failed: ... code=UNREGISTERED` | The device's token is stale (user uninstalled). Token gets auto-deleted from `device_tokens` — re-register by reopening the app. |
| `FCM send failed: ... code=SENDER_ID_MISMATCH` | Token was issued for a different Firebase project. Wipe `device_tokens` for that user, have them reopen the app. |
| `{ sent: 0, failed: 0, removed_tokens: 0, reason: "no_devices" }` | The user has no rows in `device_tokens` — they haven't opened the app on a real device since the push pipeline went live. |

### D. Is the device registered?

```sql
SELECT user_email, platform, app_version, last_seen_at
  FROM public.device_tokens
 WHERE user_email = 'YOUR_TEST_USER@example.com';
```

If this returns 0 rows, the device hasn't successfully registered.
Most common cause on iOS: missing one of:

- Firebase iOS SDK not added in Xcode (Step 4)
- Push Notifications / Background Modes capability missing (Step 5)
- Running in the iOS Simulator (which silently swallows APNS)

On Android, most common cause:

- POST_NOTIFICATIONS permission denied by the user — go to Settings →
  Apps → Mishwaro → Notifications → Allow.

### E. Token registered but push doesn't arrive

If you have a row in `device_tokens` AND the Edge Function logs show
`{ sent: 1, failed: 0 }`, then the push left our system successfully
and either Apple or Google didn't deliver to the device. Reasons:

- **iOS**: app was force-quit by the user via swipe-up. APNS still
  delivers in this case, but it can take longer (~30 sec).
- **iOS**: Do Not Disturb / Focus mode is on.
- **iOS**: Notification settings → Mishwaro → Notifications is off
  in the iOS Settings app.
- **Android**: Battery optimization is restricting the app. Settings
  → Apps → Mishwaro → Battery → "Unrestricted".
- **Android**: Notification channel for "mishwaro_default" was
  disabled by the user.

---

## Smoke test checklist (do this before App Store submission)

- [ ] Migration 060 applied, trigger exists
- [ ] Vault secrets `project_functions_url` + `service_role_key` set
- [ ] Edge Function `send-push-notification` deployed and Active
- [ ] iOS: Firebase SDK added in Xcode, Push capability + Background Modes capability enabled
- [ ] Android: `google-services.json` in `android/app/`
- [ ] `npx cap sync ios` + `npx cap sync android` ran without errors
- [ ] iOS real device: permission prompt appeared, user tapped Allow
- [ ] iOS real device: row exists in `device_tokens` with platform='ios'
- [ ] iOS real device: test push delivered within 10 seconds
- [ ] Android real device: permission prompt appeared (Android 13+)
- [ ] Android real device: row in `device_tokens` with platform='android'
- [ ] Android real device: test push delivered within 10 seconds
- [ ] Logout from app → row deleted from `device_tokens`
- [ ] Re-login → row re-created in `device_tokens`

---

## Security recap

These are sensitive credentials that must NEVER be committed,
screenshotted, pasted in chat, or shared:

| Credential | Where it lives now |
|---|---|
| Firebase Admin service account JSON (`3c75f800b389...`) | Supabase Edge Function secret `FIREBASE_SERVICE_ACCOUNT` |
| APNS Auth Key (`AuthKey_8NVYX93HK7.p8`) | Uploaded to Firebase (dev + prod slots) |
| Supabase `service_role` JWT | Supabase Vault secret `service_role_key` |

If any of these gets exposed (committed to git, screenshotted, etc.):
1. Immediately revoke at the source (Firebase / Apple / Supabase)
2. Re-issue
3. Update the corresponding secret

The leaked key from earlier today (`45fd7c60fe...`) has been
auto-disabled by Google. Confirmed inactive.

---

## When you need me back

Reply with:

- **"step 1 done"** through **"step 8 done"** as you complete each
- **"failed at step N"** + paste of any errors if something breaks
- **"all clear"** when the full smoke test passes

I'll pick up from wherever you are.
