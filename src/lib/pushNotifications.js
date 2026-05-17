/**
 * pushNotifications.js — unified push notifications layer.
 *
 * Three audiences, three paths:
 *
 *   1. Native iOS (Capacitor)     → APNS via Firebase → wakes the app
 *   2. Native Android (Capacitor) → FCM → wakes the app
 *   3. Web browsers               → browser Notification API + toast
 *                                    fallback (works for open tabs only)
 *
 * The native path is the production path post-launch. The web path
 * keeps mishwaro.com (the marketing/PWA URL) functional for users who
 * haven't installed the app yet.
 *
 * ═══ HOW THE NATIVE PATH WORKS ═══
 *
 * 1. App launches.
 * 2. AuthContext sees the user is signed in.
 * 3. AuthContext calls registerNativePush().
 * 4. We ask iOS/Android for permission via Capacitor.
 * 5. If granted, the OS sends back a "registration" event with a
 *    device token (FCM token on Android, APNS-via-FCM token on iOS
 *    since Firebase relays).
 * 6. We POST the token to Supabase via the upsert_device_token RPC.
 * 7. From now on, when a notifications row is INSERTed for this user,
 *    the Postgres trigger calls the Edge Function which calls FCM,
 *    which delivers via APNS/FCM to this device. The OS shows a
 *    banner whether the app is foreground, backgrounded, or killed.
 *
 * On logout, AuthContext calls unregisterNativePush() which deletes
 * the token from device_tokens (so a subsequent user signing in on
 * the same phone doesn't get notifications meant for the previous
 * user).
 *
 * ═══ WHY WE KEEP THE WEB PATH ═══
 *
 * Browser Notification API doesn't work backgrounded on mobile web,
 * but it DOES work in an open tab on desktop — useful for admins who
 * leave the dashboard open. The 'toast'-only fallback at minimum
 * pops a sonner toast for foreground tab notifications.
 *
 * ═══ FUNCTIONS EXPORTED ═══
 *
 * Web path (existing, callers unchanged):
 *   isNotificationSupported() : boolean
 *   getPermission()           : "granted" | "denied" | "default" | "unsupported"
 *   ensurePermission()        : Promise<above>
 *   showIncomingNotification(notif, { onClick })
 *
 * Native path (new):
 *   registerNativePush()      : Promise<void>   — call on login
 *   unregisterNativePush()    : Promise<void>   — call on logout
 *   getNativePermission()     : Promise<string> — for UI status display
 */

import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/sentry";

const PERMISSION_ASK_KEY = "mishwar:push:asked";
const PERMISSION_OK_KEY  = "mishwar:push:granted";
const LAST_TOKEN_KEY     = "mishwar:push:last_token";

// ════════════════════════════════════════════════════════════════════
// WEB PATH (unchanged — kept for browser users)
// ════════════════════════════════════════════════════════════════════

export function isNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getPermission() {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Ask for permission if we haven't yet. Idempotent — never double-prompts.
 * Returns the resulting permission state.
 */
export async function ensurePermission() {
  if (!isNotificationSupported()) return "unsupported";
  if (Notification.permission === "granted") {
    try { localStorage.setItem(PERMISSION_OK_KEY, "1"); } catch {}
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    if (localStorage.getItem(PERMISSION_ASK_KEY) === "1") {
      return "default";
    }
    localStorage.setItem(PERMISSION_ASK_KEY, "1");
  } catch {}
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      try { localStorage.setItem(PERMISSION_OK_KEY, "1"); } catch {}
    }
    return result;
  } catch {
    return "default";
  }
}

/**
 * Show a notification for an incoming row from the notifications table.
 *
 * ON WEB: toasts always; additionally fires a system Notification banner
 * when permission is granted and the tab is hidden/blurred.
 *
 * ON NATIVE iOS/ANDROID (Capacitor): returns early — does NOT toast.
 * Reason: the same notifications-table INSERT that triggered this function
 * via the realtime channel ALSO triggers migration 060's push pipeline,
 * which delivers via APNS/FCM, which lands either as an OS banner (when
 * app is backgrounded) or as a Capacitor `pushNotificationReceived`
 * event (when app is foregrounded). The Capacitor event listener in
 * registerNativePush() emits its OWN sonner toast on foreground. So if
 * we ALSO toasted here, every notification on a native foregrounded
 * device would show TWO toasts — once from realtime, once from FCM
 * delivery. Native push is authoritative on native; let it handle the
 * user-visible alert. The badge update (via qc.invalidateQueries) is
 * UNAFFECTED — it still happens in NotificationBell on every realtime
 * INSERT event regardless of platform.
 */
export function showIncomingNotification(notif, { onClick } = {}) {
  if (!notif) return;
  // Native devices: defer to the Capacitor push pipeline. See docstring.
  if (Capacitor.isNativePlatform()) return;

  const title = notif.title || "إشعار جديد";
  const body  = notif.message || "";

  toast(title, {
    description: body,
    action: onClick
      ? { label: "فتح", onClick: () => onClick(notif) }
      : undefined,
    duration: 6000,
  });

  const tabHidden = typeof document !== "undefined" && document.visibilityState !== "visible";
  if (!tabHidden) return;

  if (!isNotificationSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "/logo.png",
      badge: "/logo.png",
      tag: notif.id || `notif-${Date.now()}`,
      lang: "ar",
      dir: "rtl",
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      try { n.close(); } catch {}
      if (onClick) onClick(notif);
    };
  } catch {}
}

// ════════════════════════════════════════════════════════════════════
// NATIVE PATH (Capacitor — iOS APNS + Android FCM)
// ════════════════════════════════════════════════════════════════════

// Lazy-import the plugin only when we're on a native platform. Avoids
// shipping the plugin's stub to the web bundle (small win, but cleaner).
async function getPushPlugin() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import("@capacitor/push-notifications");
    return mod.PushNotifications;
  } catch (e) {
    captureException(e, { msg: "Failed to import @capacitor/push-notifications" });
    return null;
  }
}

/**
 * Permission state on native, for UI display.
 * Returns one of: "granted", "denied", "prompt", "prompt-with-rationale",
 * "unsupported".
 */
export async function getNativePermission() {
  const Push = await getPushPlugin();
  if (!Push) return "unsupported";
  try {
    const result = await Push.checkPermissions();
    return result.receive || "prompt";
  } catch {
    return "unsupported";
  }
}

let listenersAttached = false;
let cachedRegisteredToken = null;

/**
 * Register for push notifications on iOS/Android. Idempotent — safe to
 * call multiple times (e.g. on every app foreground).
 *
 * Flow:
 *   1. Request permission (no-op if already granted).
 *   2. Attach the 'registration' / 'registrationError' / 'pushNotificationReceived'
 *      / 'pushNotificationActionPerformed' listeners (once per app session).
 *   3. Call Push.register() to ask the OS for a token.
 *   4. The 'registration' listener fires asynchronously with the token,
 *      which we then UPSERT into device_tokens via the RPC.
 *
 * Call from AuthContext.jsx after the user signs in. The Capacitor
 * plugin handles iOS APNS + Firebase Cloud Messaging automatically as
 * long as GoogleService-Info.plist (iOS) and google-services.json
 * (Android) are in place — both verified.
 */
export async function registerNativePush() {
  const Push = await getPushPlugin();
  if (!Push) return;  // web platform — no-op

  try {
    // 1. Check / request permission.
    let perm = await Push.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await Push.requestPermissions();
    }
    if (perm.receive !== "granted") {
      // User denied or system blocked. We respect the choice and don't
      // re-prompt — the system won't let us anyway. UI in
      // NotificationPrefsSection should show "go to Settings to enable".
      return;
    }

    // 2. Attach listeners ONCE per app session. addListener returns a
    // handle; we don't currently remove them (the app lifecycle handles
    // that on unload).
    if (!listenersAttached) {
      listenersAttached = true;

      // Fired by the OS when a token is issued (or refreshed).
      await Push.addListener("registration", async (tokenInfo) => {
        const token = tokenInfo?.value;
        if (!token) return;

        // Cache so we know what to delete on logout.
        cachedRegisteredToken = token;
        try { localStorage.setItem(LAST_TOKEN_KEY, token); } catch {}

        // Upsert into device_tokens. Platform comes from Capacitor.
        const platform = Capacitor.getPlatform();  // 'ios' | 'android' | 'web'
        if (platform !== "ios" && platform !== "android") return;

        const appVersion = (typeof import.meta.env !== "undefined" && import.meta.env.VITE_APP_VERSION) || null;

        const { error } = await supabase.rpc("upsert_device_token", {
          p_platform: platform,
          p_token: token,
          p_device_id: null,        // could pull via @capacitor/device; not critical
          p_app_version: appVersion,
        });
        if (error) {
          captureException(error, { msg: "upsert_device_token RPC failed" });
        }
      });

      // Fired if Apple/Google rejects the registration. Usually means
      // misconfigured certs / project ID.
      await Push.addListener("registrationError", (err) => {
        captureException(new Error(err?.error || "Push registration error"), {
          msg: "PushNotifications registrationError",
        });
      });

      // Fired when a push arrives while the app is foregrounded. The
      // OS does NOT show a banner in this case — it's up to us. We
      // show a sonner toast so the user sees something happened.
      await Push.addListener("pushNotificationReceived", (notification) => {
        const title = notification.title || notification.data?.title || "إشعار جديد";
        const body  = notification.body  || notification.data?.body  || "";
        toast(title, { description: body, duration: 6000 });
      });

      // Fired when the user taps a push (foreground OR background).
      // The 'notification' object has the original data payload — we
      // route based on 'type' to take them to the right screen.
      await Push.addListener("pushNotificationActionPerformed", (action) => {
        const data = action?.notification?.data || {};
        // Deep-link routing — minimal version. Expand as needed.
        const link = data.link;
        if (link && typeof window !== "undefined") {
          try {
            // Hash routing not used; the app uses BrowserRouter, so
            // a simple pushState works in Capacitor WebView.
            window.history.pushState({}, "", link);
            // Dispatch a popstate so React Router picks it up.
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch {
            // Fallback: full reload to the link.
            window.location.href = link;
          }
        }
      });
    }

    // 3. Ask the OS for a token. Fires the 'registration' listener
    // above asynchronously.
    await Push.register();
  } catch (e) {
    captureException(e, { msg: "registerNativePush failed" });
  }
}

/**
 * Delete the current device's token from device_tokens. Call on logout
 * so the next user signing in on the same phone doesn't get pushes
 * intended for the previous user.
 */
export async function unregisterNativePush() {
  // We need a token to delete. Try the in-memory cache first, then
  // localStorage as a fallback.
  let token = cachedRegisteredToken;
  if (!token) {
    try { token = localStorage.getItem(LAST_TOKEN_KEY); } catch {}
  }
  if (!token) return;

  try {
    const { error } = await supabase.rpc("delete_my_device_token", {
      p_token: token,
    });
    if (error) {
      // Don't blow up logout if the RPC fails. We tried.
      captureException(error, { msg: "delete_my_device_token RPC failed" });
    }
  } catch (e) {
    captureException(e, { msg: "unregisterNativePush threw" });
  } finally {
    cachedRegisteredToken = null;
    try { localStorage.removeItem(LAST_TOKEN_KEY); } catch {}
  }
}
