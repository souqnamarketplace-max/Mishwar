// Notification routing — single source of truth for "where does tapping
// THIS notification take the user?"
//
// Priority order:
//   1. notif.link — explicit deep-link set by producer (always wins)
//   2. notif.trip_id — title-matched into the right driver/passenger surface
//   3. notif.type for non-trip notifications
//   4. Title-based fallback for legacy rows
//   5. null — caller decides

export function getNotifTarget(notif) {
  if (!notif) return null;

  const t    = notif.title || "";
  const type = notif.type  || "system";
  const tid  = notif.trip_id;

  // Private thank-you messages — route to notifications page with modal open
  if (t.includes("رسالة خاصة") && notif.id) {
    return `/notifications?msg=${encodeURIComponent(notif.id)}`;
  }

  // 1. Explicit deep-link always wins — producers set this when they know
  //    the exact destination (trip ID, tab, section, etc.)
  if (notif.link) return notif.link;

  // 2. Trip-bound notifications — route based on title context
  if (tid) {
    // ── Passenger-facing ──────────────────────────────────────────────
    // Booking confirmed/accepted → my confirmed trips, highlight this trip
    if (t.includes("تم قبول حجزك") || t.includes("تأكيد الحجز")) {
      return `/my-trips?tab=confirmed&trip=${tid}`;
    }
    // Booking rejected / cancelled by driver
    if (t.includes("تم رفض حجزك") || t.includes("ألغى حجزك") || t.includes("السائق ألغى")) {
      return `/my-trips?tab=cancelled&trip=${tid}`;
    }
    // Trip started — passenger goes to in-progress view
    if (t.includes("انطلقت") || t.includes("في الطريق") || t.includes("رحلتك انطلقت")) {
      return `/my-trips?tab=in_progress&trip=${tid}`;
    }
    // Driver arrived at pickup point
    if (t.includes("السائق وصل") || t.includes("وصل!")) {
      return `/trip/${tid}`;
    }
    // Trip completed — open completed tab, auto-trigger review wizard
    if (t.includes("اكتملت") || t.includes("قيّم السائق") || t.includes("كيف كانت") || t.includes("قيّم تجربتك")) {
      return `/my-trips?tab=completed&trip=${tid}`;
    }
    // New rating received — passenger goes to their completed trips to see review
    if (t.includes("تقييم جديد على ملفك") || t.includes("تقييم جديد من")) {
      return `/my-trips?tab=completed&trip=${tid}`;
    }

    // ── Driver-facing ─────────────────────────────────────────────────
    // New booking / payment notification → driver's passenger management
    if (t.includes("حجز جديد") || t.includes("طلب حجز") || t.includes("راكب أرسل") || t.includes("الدفع عبر")) {
      return `/driver?tab=passengers&trip=${tid}`;
    }
    // A passenger cancelled → driver's passenger list for this trip
    if (t.includes("تم إلغاء حجز") || t.includes("ألغى حجزه")) {
      return `/driver?tab=passengers&trip=${tid}`;
    }
    // Rate passengers after trip
    if (t.includes("قيّم ركابك")) {
      return "/driver?tab=rate-passengers";
    }
    // New rating received by driver → their ratings tab
    if (t.includes("تقييم جديد")) {
      return "/driver?tab=my-ratings";
    }

    // Default with trip_id → trip details page
    return `/trip/${tid}`;
  }

  // 3. Type-based for non-trip notifications
  if (type === "request_contact") return "/messages";
  if (type === "admin_broadcast") return null;

  // 4. Title-based fallback for legacy rows with no link, no trip_id
  if (t.includes("اشتراك") || t.includes("ينتهي اشتراكك")) return "/driver?tab=subscription";
  if (t.includes("توثيق") || t.includes("الوثائق") || t.includes("مطلوب: تحديث")) return "/account-settings";
  if (t.includes("تقييم"))    return "/driver?tab=my-ratings";
  if (t.includes("حجز"))      return "/my-trips";
  if (t.includes("رحلة"))     return "/my-trips";

  // 5. No actionable destination
  return null;
}
