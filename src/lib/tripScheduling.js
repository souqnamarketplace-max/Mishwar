// ═══════════════════════════════════════════════════════════════════════════
// Trip scheduling — conflict detection (frontend layer)
// ═══════════════════════════════════════════════════════════════════════════
// Mirrors the SQL trigger logic so users get instant feedback before they hit
// "Save". The SQL triggers are the source of truth (defense in depth).
//
// RELAXED IN MIG 087 (2026-05-18):
//   The old rule blocked any same-day trip AND required cities to match
//   within a 4-hour gap. That was too strict for real Palestinian
//   rideshare patterns (return trips, multi-route drivers).
//
//   New rule (SQL trigger + this file in sync):
//     - Two trips conflict only when they're within 1 HOUR of each other
//     - Different cities are fine — drivers can do Ramallah→Nablus then
//       Bethlehem→Hebron the same day, as long as the start times are
//       60+ minutes apart
//     - Past-trip block remains
//
// Constants:
//   - TRIP_WINDOW_MINUTES = 60   (was 30 — match SQL trigger's 1-hour rule)
// ═══════════════════════════════════════════════════════════════════════════

// 60-minute conflict window. New trip must start ≥60 min before OR after
// every other active trip by the same driver on the same day. Matches the
// `< 3600 seconds` check in migration 087's check_driver_trip_conflict().
export const TRIP_WINDOW_MINUTES = 60;
// 4-hour geographic-continuity window for PASSENGER booking conflict only.
// This is INTERNAL — not exported — because the driver-side check was
// relaxed in mig 087 and no longer uses this rule. Passengers genuinely
// can't be in two cities at once, so the geographic constraint still
// applies to bookings.
const GEO_GAP_HOURS = 4;
const TZ = "Asia/Jerusalem";

/**
 * Convert a trip's date + time strings into a Date object representing the
 * absolute UTC instant. Treats the input as Asia/Jerusalem local time.
 *
 * Uses Intl.DateTimeFormat to compute the offset reliably (handles DST).
 */
export function getTripStartUTC(trip) {
  if (!trip?.date || !trip?.time) return null;

  // Parse "HH:MM" or "HH:MM:SS"
  const [hh, mm] = trip.time.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  // Build a date object as if the user is in UTC, then adjust by the TZ offset
  // for the *given* date (handles DST transitions correctly).
  const [yy, mo, dd] = trip.date.split("-").map((n) => parseInt(n, 10));
  if (!yy || !mo || !dd) return null;

  // Create a "wall clock" timestamp as UTC
  const utcAsLocal = Date.UTC(yy, mo - 1, dd, hh, mm, 0, 0);

  // Compute Asia/Jerusalem offset for this date
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcAsLocal));
  const o = {};
  parts.forEach((p) => { if (p.type !== "literal") o[p.type] = p.value; });
  const tzAsUTC = Date.UTC(
    parseInt(o.year, 10),
    parseInt(o.month, 10) - 1,
    parseInt(o.day, 10),
    parseInt(o.hour, 10),
    parseInt(o.minute, 10),
    0, 0
  );
  // Difference between what the TZ thinks the wall time is, vs what we wanted
  const offsetMs = utcAsLocal - tzAsUTC;
  return new Date(utcAsLocal + offsetMs);
}

/** Returns { start, end } as Date objects (end = start + 30min) */
export function getTripWindow(trip) {
  const start = getTripStartUTC(trip);
  if (!start) return null;
  const end = new Date(start.getTime() + TRIP_WINDOW_MINUTES * 60_000);
  return { start, end };
}

/** True if [a.start, a.end) and [b.start, b.end) overlap */
export function windowsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/** True if a trip's start time has already passed (it should be hidden from search). */
export function isTripExpired(trip) {
  const start = getTripStartUTC(trip);
  if (!start) return false;
  return start.getTime() <= Date.now();
}

/** True if a trip is completed — either the driver marked it done (status='completed')
 *  OR the departure window has passed (time-based fallback for trips never explicitly completed). */
export function isTripCompleted(trip) {
  if (!trip) return false;
  // Driver explicitly completed the trip — most reliable signal
  if (trip.status === "completed") return true;
  // Time-based fallback: window has passed
  const w = getTripWindow(trip);
  if (!w) return false;
  return w.end.getTime() <= Date.now();
}

/**
 * Check if a new/edited trip conflicts with the driver's other active trips.
 *
 * @param {object} newTrip - The trip being created or edited (must have id?, from_city, to_city, date, time).
 * @param {Array<object>} existingTrips - All other trips this driver has.
 * @returns {{valid: boolean, conflictingTrip?: object, reason?: string, message?: string}}
 */
export function checkDriverConflict(newTrip, existingTrips) {
  if (!newTrip?.date || !newTrip?.time || !newTrip?.from_city || !newTrip?.to_city) {
    return { valid: true };
  }

  const newWindow = getTripWindow(newTrip);
  if (!newWindow) return { valid: true };
  const newStart = newWindow.start;

  // Block past trips
  if (newStart.getTime() <= Date.now()) {
    return {
      valid: false,
      reason: "past_trip",
      message: "لا يمكن نشر رحلة في الماضي. يرجى اختيار وقت مستقبلي.",
    };
  }

  for (const existing of existingTrips || []) {
    // Skip self when editing
    if (newTrip.id && existing.id === newTrip.id) continue;
    // Only active trips block the schedule
    if (!["confirmed", "in_progress"].includes(existing.status)) continue;
    if (!existing.date || !existing.time) continue;

    const existingWindow = getTripWindow(existing);
    if (!existingWindow) continue;

    // (a) Time overlap — the only driver-side conflict rule after mig 087.
    // Two trips conflict when they start within 60 minutes of each other.
    // Geographic continuity (the old 4-hour city-must-match check) was
    // removed because drivers genuinely can do non-continuous routes
    // (e.g. Ramallah→Nablus at 9 AM then Bethlehem→Hebron at 2 PM) — they
    // drive between bases off-platform.
    if (windowsOverlap(newWindow, existingWindow)) {
      return {
        valid: false,
        conflictingTrip: existing,
        reason: "time_overlap",
        message: `يتعارض هذا الموعد مع رحلتك من ${existing.from_city} إلى ${existing.to_city} الساعة ${existing.time}. اختر وقتاً يبعد ساعة واحدة على الأقل.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Check if booking a target trip would conflict with the passenger's other bookings.
 *
 * @param {object} targetTrip - The trip the passenger wants to book.
 * @param {Array<object>} existingBookings - All this passenger's bookings (any status).
 * @param {Array<object>} allTrips - The full trip pool to look up trip details by id.
 * @returns {{valid: boolean, conflictingBooking?: object, conflictingTrip?: object, reason?: string, message?: string}}
 */
export function checkPassengerConflict(targetTrip, existingBookings, allTrips) {
  if (!targetTrip?.id || !targetTrip?.date || !targetTrip?.time) return { valid: true };

  const tripsById = new Map((allTrips || []).map((t) => [t.id, t]));
  const targetWindow = getTripWindow(targetTrip);
  if (!targetWindow) return { valid: true };
  const targetStart = targetWindow.start;

  // Block past trips
  if (targetStart.getTime() <= Date.now()) {
    return {
      valid: false,
      reason: "past_trip",
      message: "لا يمكن حجز رحلة بدأت بالفعل.",
    };
  }

  for (const booking of existingBookings || []) {
    // Skip cancelled (frees the slot) or completed
    if (!["pending", "confirmed"].includes(booking.status)) continue;
    // Skip self (re-booking same trip)
    if (booking.trip_id === targetTrip.id) continue;

    const existingTrip = tripsById.get(booking.trip_id);
    if (!existingTrip || !existingTrip.date || !existingTrip.time) continue;

    const existingWindow = getTripWindow(existingTrip);
    if (!existingWindow) continue;

    // (a) Time overlap?
    if (windowsOverlap(targetWindow, existingWindow)) {
      return {
        valid: false,
        conflictingBooking: booking,
        conflictingTrip: existingTrip,
        reason: "time_overlap",
        message: `لديك حجز آخر في نفس التوقيت — رحلة من ${existingTrip.from_city} إلى ${existingTrip.to_city} الساعة ${existingTrip.time}`,
      };
    }

    // (b) Geographic continuity (within 4 hours)
    const gapHours = Math.abs(targetStart.getTime() - existingWindow.start.getTime()) / 3_600_000;
    if (gapHours < GEO_GAP_HOURS) {
      if (targetStart > existingWindow.start) {
        if (targetTrip.from_city !== existingTrip.to_city) {
          return {
            valid: false,
            conflictingBooking: booking,
            conflictingTrip: existingTrip,
            reason: "geographic_mismatch_after",
            message: `مكان انطلاق هذه الرحلة (${targetTrip.from_city}) لا يطابق وجهة حجزك السابق في ${existingTrip.to_city}. الفجوة أقل من 4 ساعات.`,
          };
        }
      } else {
        if (targetTrip.to_city !== existingTrip.from_city) {
          return {
            valid: false,
            conflictingBooking: booking,
            conflictingTrip: existingTrip,
            reason: "geographic_mismatch_before",
            message: `وجهة هذه الرحلة (${targetTrip.to_city}) لا تطابق مكان انطلاق حجزك التالي من ${existingTrip.from_city}. الفجوة أقل من 4 ساعات.`,
          };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Filter a list of trips to only those bookable by the public (confirmed + future).
 * Use this in SearchTrips/Home for instant filtering before the cron has run.
 */
export function filterBookableTrips(trips) {
  if (!Array.isArray(trips)) return [];
  return trips.filter((t) => t.status === "confirmed" && !isTripExpired(t));
}

/**
 * Returns how many minutes until the trip departs (negative = already departed).
 */
export function minutesUntilTrip(trip) {
  const start = getTripStartUTC(trip);
  if (!start) return null;
  return Math.round((start.getTime() - Date.now()) / 60_000);
}

/**
 * "Last chance" = trip departs within 2 hours.
 * Passengers should be warned to book quickly.
 */
export function isLastChance(trip) {
  const mins = minutesUntilTrip(trip);
  if (mins === null) return false;
  return mins > 0 && mins <= 120;
}

/**
 * Booking cutoff: passengers cannot book after 60 minutes past departure.
 * Booking stays open right up to and 60 minutes after the trip departs.
 */
export function isBookingClosed(trip) {
  const mins = minutesUntilTrip(trip);
  if (mins === null) return true;
  return mins <= -60; // close 60 minutes AFTER departure
}
