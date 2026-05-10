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
 *     trip_id: trip?.id,        // optional — links the bell entry to a trip
 *     link: "/dashboard?tab=reports",  // optional — explicit deep-link in admin
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

import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/sentry";

export const ADMIN_EMAIL = "souqnamarketplace@gmail.com";

export async function notifyAdmin({
  title,
  message,
  trip_id = null,
  // Deep-link inside the app the admin should land on when they tap
  // the notification. Notifications.jsx routes by notif.link first,
  // falling back to type-based defaults. Without this, admin-targeted
  // notifications about non-trip entities (verification queue, reports
  // queue, etc.) had no way to express "open the relevant tab" — they
  // just opened /notifications and stopped there.
  link = null,
  // Reserved for future categorization. Currently all admin notifs are
  // type='system' so the bell + filtering work uniformly.
  type = "system",
}) {
  if (!title || !message) {
    console.warn("[notifyAdmin] missing title or message", { title, message });
    return null;
  }
  try {
    // Route through the create_notification RPC (migration 027) instead of
    // a direct Notification.create. Rationale:
    //
    // The notifications_insert RLS policy from migration 002 only admits
    // self-targeted writes OR admin-role writes. Regular users pinging the
    // admin (city suggestions, reports, verification queue, license queue,
    // subscription requests, review flags) failed the WITH CHECK silently —
    // the previous direct create call here triggered an RLS rejection that
    // the catch block below swallowed. Net effect: the admin (you) was
    // never getting bell pings about user activity. The admin dashboard's
    // tab queues (which poll directly) showed the items, but the
    // notification badge never lit up.
    //
    // The RPC has Rule C: any authenticated user can ping admins. The
    // admin-target check is server-side via profiles.role. So this works
    // for the ADMIN_EMAIL constant AND would continue to work if the admin
    // role is ever granted to a different account.
    const { data, error } = await supabase.rpc("create_notification", {
      p_user_email: ADMIN_EMAIL,
      p_title:      title,
      p_message:    message,
      p_type:       type,
      p_trip_id:    trip_id,
      p_link:       link,
    });
    if (error) throw error;
    return data; // returns the new notification's UUID
  } catch (err) {
    // Swallow — admin notification failures should NEVER break the
    // user-facing action that triggered them. Log so we can see it
    // in Sentry without disrupting the user.
    captureException(err, { msg: "[notifyAdmin] failed to create admin notification" });
    return null;
  }
}
