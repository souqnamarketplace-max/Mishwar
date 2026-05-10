// Notification routing — single source of truth for "where does tapping
// THIS notification take the user?"
//
// Used by:
//   - NotificationBell.jsx (bell-popup row tap)
//   - Notifications.jsx (full-page list row tap)
//   - any future surface that lists notifications
//
// Both surfaces previously had their own routing logic — bell used
// title-based heuristics ("حجز جديد" → driver dashboard), list used
// a switch on notif.type with type values (booking_received,
// booking_cancelled, license_approved, etc.) that NOTHING in the
// producer side actually emits — every notification insert in the
// codebase uses type='system' and differentiates by title or
// trip_id. The list-page switch was effectively unreachable code,
// and identical notifications routed to different destinations
// depending on which surface the user tapped.
//
// Priority order:
//   1. notif.link — explicit deep-link set by the producer
//      (verification requests, subscription decisions, license review,
//      report status, trip-request contact). Set everywhere a precise
//      destination is needed that title-matching can't infer reliably.
//   2. notif.trip_id — booking/trip family. Title-matched into the
//      right driver/passenger surface; falls back to trip details.
//   3. notif.type for explicit broadcasts/system messages with no
//      trip context.
//   4. Title-based fallback for legacy rows.
//   5. /notifications as the safety net so a tap is never a no-op.

export function getNotifTarget(notif) {
  if (!notif) return "/notifications";

  const t    = notif.title || "";
  const type = notif.type || "system";

  // 1. Explicit deep-link wins
  if (notif.link) return notif.link;

  // 2. Trip-bound notifications
  if (notif.trip_id) {
    // Booking requests → driver dashboard's passengers tab
    if (t.includes("حجز جديد") || t.includes("طلب حجز")) return "/driver?tab=passengers";
    // Trip started/completed for passenger → my trips
    if (t.includes("انطلقت") || t.includes("اكتملت") || t.includes("قيّم السائق")) return "/my-trips";
    // New trip match → trip details
    if (type === "new_trip") return `/trip/${notif.trip_id}`;
    // Rating received → driver ratings
    if (t.includes("تقييم جديد")) return "/driver?tab=ratings";
    // Default with trip_id → trip details
    return `/trip/${notif.trip_id}`;
  }

  // 3. Type-based for non-trip notifications
  //    request_contact: driver tapped تواصل on a passenger request.
  //    Notification was inserted by notify_request_contact RPC
  //    (migration 021). The link field is set by the RPC, so this
  //    branch is normally unreachable — kept as defensive fallback
  //    if a row is somehow inserted without the link.
  if (type === "request_contact") return "/messages";
  //    admin_broadcast: from broadcast_notification RPC (migration
  //    024). Has no specific destination — drop user on the
  //    notifications list so they can re-read the message.
  if (type === "admin_broadcast") return "/notifications";

  // 4. Title-based fallback for legacy rows with no link, no trip_id,
  //    and a generic type='system'
  if (t.includes("تقييم")) return "/driver?tab=ratings";
  if (t.includes("حجز"))   return "/my-trips";

  // 5. Safety net
  return "/notifications";
}
