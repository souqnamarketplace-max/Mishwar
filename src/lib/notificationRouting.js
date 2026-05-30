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
//   5. null — caller decides the safety net (was previously /notifications
//      which was a no-op when tapped from the list page itself).

export function getNotifTarget(notif) {
  if (!notif) return null;

  const t    = notif.title || "";
  const type = notif.type || "system";

  // Private thank-you messages from passengers (PassengerReviewWizard).
  // Producer sets link="/notifications", but tapping the card on that
  // page used to do nothing (target === current path). Now we route
  // with ?msg=<id> so the Notifications page auto-opens the
  // thank-you modal on mount. Detection mirrors the helper in
  // src/pages/Notifications.jsx — title-based, no schema change.
  if (t.includes("رسالة خاصة") && notif.id) {
    return `/notifications?msg=${encodeURIComponent(notif.id)}`;
  }

  // 1. Explicit deep-link wins
  if (notif.link) return notif.link;

  // 2. Trip-bound notifications
  if (notif.trip_id) {
    // Booking requests → driver dashboard's passengers tab
    if (t.includes("حجز جديد") || t.includes("طلب حجز")) return "/driver?tab=passengers";
    // A passenger cancelled / their pending booking auto-expired —
    // driver is the recipient. Send them to passenger-management for
    // remaining riders. Catches:
    //   - migration 036 cascade title 'تم إلغاء حجز معلق'
    //   - any legacy variant
    if (t.includes("إلغاء حجز") && t.includes("معلق")) return "/driver?tab=passengers";
    // Driver notified to rate their passengers
    if (t.includes("قيّم ركابك") || (notif.link || "").includes("rate-passengers")) return "/driver?tab=rate-passengers";
    if (t.includes("انطلقت") || t.includes("اكتملت") || t.includes("قيّم السائق")) return "/my-trips?tab=completed";
    // Review request ("كيف كانت رحلتك؟") — send directly to completed tab
    // with the trip highlighted so passenger can tap and rate immediately
    if (t.includes("كيف كانت") || t.includes("قيّم تجربتك")) {
      return notif.trip_id
        ? `/my-trips?tab=completed&trip=${notif.trip_id}`
        : "/my-trips?tab=completed";
    }
    // New trip match → trip details
    if (type === "new_trip") return `/trip/${notif.trip_id}`;
    // Rating received → driver's ratings tab. The tab id is 'my-ratings'
    // (per DriverDashboard.jsx TABS list); 'ratings' was the historical
    // name and is the bug we keep hitting — fixed once and for all here.
    if (t.includes("تقييم جديد")) return "/driver?tab=my-ratings";
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
  //    024). Has no specific destination — return null so the caller
  //    can decide (e.g. expand inline instead of navigating).
  if (type === "admin_broadcast") return null;

  // 4. Title-based fallback for legacy rows with no link, no trip_id,
  //    and a generic type='system'
  if (t.includes("تقييم")) return "/driver?tab=my-ratings";
  // Subscription warning — title pattern from migration 010 (pre-047
  // these rows had no link). Driver lands on subscription renewal tab.
  if (t.includes("ينتهي اشتراكك")) return "/driver?tab=subscription";
  if (t.includes("حجز"))   return "/my-trips";

  // 5. No actionable destination — let caller decide whether to navigate
  //    at all. Surfaces showing notifications shouldn't navigate the
  //    user to /notifications when they're already there.
  return null;
}

