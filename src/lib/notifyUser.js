/**
 * notifyUser — send a notification to another user (or yourself) via the
 * SECURITY DEFINER `create_notification` RPC introduced in migration 027.
 *
 * Use this for ANY cross-user notification (driver→passenger booking
 * accept/reject, passenger→driver review submitted, etc.). DO NOT use
 * base44.entities.Notification.create directly for cross-user inserts —
 * the migration 002 RLS policy on notifications_insert silently rejects
 * them, and the failure was historically swallowed in try/catch blocks
 * across the codebase, leaving notifications undelivered without surfacing
 * the bug.
 *
 * The RPC enforces an authorization check server-side: caller must be the
 * target, an admin, or have a legitimate booking/messaging relationship
 * with the target. See migration 027 for the full rule list.
 *
 * Self-targeted notifications (user_email = caller) also work through the
 * RPC — Rule A allows them. So callers don't need to branch on whether
 * the target is themselves.
 *
 * Errors:
 *   - Returns the inserted notification UUID on success.
 *   - Returns null on failure. Reason is logged to Sentry (or console as
 *     fallback) but never thrown — failed notifications must never break
 *     the user-facing action that triggered them. Match the notifyAdmin
 *     pattern exactly.
 *
 * Why not just throw on failure: bell pings are nice-to-have, not load-
 * bearing. A driver approving a booking should still see "تم قبول الحجز"
 * succeed even if the passenger notification couldn't be queued — they
 * can see the status flip on /my-trips next visit. Surfacing the
 * notification failure as an error to the driver would block UX on a
 * non-essential operation.
 */

import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/sentry";

export async function notifyUser({
  user_email,
  title,
  message,
  trip_id = null,
  link    = null,
  type    = "system",
}) {
  if (!user_email || !title || !message) {
    console.warn("[notifyUser] missing user_email/title/message", {
      user_email, title, message,
    });
    return null;
  }
  try {
    const { data, error } = await supabase.rpc("create_notification", {
      p_user_email: user_email,
      p_title:      title,
      p_message:    message,
      p_type:       type,
      p_trip_id:    trip_id,
      p_link:       link,
    });
    if (error) throw error;
    return data; // notification UUID
  } catch (err) {
    captureException(err, {
      msg: "[notifyUser] failed to create notification",
      extra: { user_email, title },
    });
    return null;
  }
}
