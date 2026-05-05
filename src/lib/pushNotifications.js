/**
 * pushNotifications.js — best-effort browser notifications layered on top of
 * the existing in-app notifications table + realtime channel.
 *
 * Why no service worker / FCM yet: that's a multi-week project (push server,
 * VAPID keys, iOS PWA install flow, background sync). What we ship here works
 * today on every modern browser when the tab is open or in another tab —
 * which covers the bulk of the "I want to see new bookings pop up" UX.
 * Closed-tab background pushes need a service worker; that's a follow-up.
 *
 * Behaviours:
 *   - Foreground tab: a sonner toast with click-to-navigate (always)
 *   - Background tab WITH permission granted: native OS notification banner
 *   - Permission denied / unsupported: just the toast
 *
 * Permission is requested LAZILY the first time the user does something
 * that implies they want notifications (opens the bell, lands on /notifications,
 * or finishes onboarding) — never on first page load, which is the iOS/Android
 * anti-pattern that gets every PWA blocklisted.
 */

import { toast } from "sonner";

const PERMISSION_ASK_KEY = "mishwar:push:asked";
const PERMISSION_OK_KEY  = "mishwar:push:granted";

export function isNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getPermission() {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
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
  // "default" — we may ask
  try {
    if (localStorage.getItem(PERMISSION_ASK_KEY) === "1") {
      // The user already saw the prompt and dismissed it without choosing.
      // Don't pester. They can re-enable from browser settings.
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
 * Always toasts; additionally fires a system banner when permission is granted
 * and the tab is hidden/blurred (no point of double-ringing if the user is
 * looking at the page).
 */
export function showIncomingNotification(notif, { onClick } = {}) {
  if (!notif) return;
  const title = notif.title || "إشعار جديد";
  const body  = notif.message || "";

  // Always show a toast for foreground tabs — sonner is already mounted globally.
  toast(title, {
    description: body,
    action: onClick
      ? { label: "فتح", onClick: () => onClick(notif) }
      : undefined,
    duration: 6000,
  });

  // Native banner only when the page is hidden — otherwise the toast is enough
  // and we avoid the double-popup feel.
  const tabHidden = typeof document !== "undefined" && document.visibilityState !== "visible";
  if (!tabHidden) return;

  if (!isNotificationSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "/logo.png",
      badge: "/logo.png",
      tag: notif.id || `notif-${Date.now()}`, // collapses duplicates
      lang: "ar",
      dir: "rtl",
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      try { n.close(); } catch {}
      if (onClick) onClick(notif);
    };
  } catch {
    // Some browsers throw if called from a non-secure context — silent fallback
  }
}
