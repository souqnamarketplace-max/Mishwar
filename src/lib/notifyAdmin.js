/**
 * notifyAdmin — single helper for sending notifications to the admin's
 * inbox. Centralizes the admin email constant so changing it later is
 * a one-line edit, and wraps the create call in try/catch so a failed
 * notification never breaks the user-facing action that triggered it.
 *
 * Usage:
 *   import { notifyAdmin } from "@/lib/notifyAdmin";
 *   await notifyAdmin({
 *     title: "بلاغ جديد من مستخدم 🚩",
 *     message: "تفاصيل البلاغ...",
 *     trip_id: trip?.id,        // optional — links the bell entry to a row
 *   });
 *
 * Why a helper instead of inline create() everywhere:
 *  - Single source of truth for the admin email (souqnamarketplace@gmail.com).
 *  - Consistent type='system' so admin filtering by type works cleanly.
 *  - Consistent error handling — admin notification failures are swallowed
 *    and logged, never bubbled. A user who reports another user shouldn't
 *    see a "report failed" toast just because the admin notification failed.
 *  - One place to add things later (rate-limiting, dedup, push fan-out).
 */

import { base44 } from "@/api/base44Client";

export const ADMIN_EMAIL = "souqnamarketplace@gmail.com";

export async function notifyAdmin({
  title,
  message,
  trip_id = null,
  // Reserved for future categorization. Currently all admin notifs are
  // type='system' so the bell + filtering work uniformly.
  type = "system",
}) {
  if (!title || !message) {
    console.warn("[notifyAdmin] missing title or message", { title, message });
    return null;
  }
  try {
    return await base44.entities.Notification.create({
      user_email: ADMIN_EMAIL,
      title,
      message,
      type,
      trip_id,
      is_read: false,
    });
  } catch (err) {
    // Swallow — admin notification failures should NEVER break the
    // user-facing action that triggered them. Log so we can see it
    // in dev console, but don't bubble.
    console.warn("[notifyAdmin] failed to deliver:", err?.message || err);
    return null;
  }
}
