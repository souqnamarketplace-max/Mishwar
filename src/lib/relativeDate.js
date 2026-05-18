// ═══════════════════════════════════════════════════════════════════════════
// Relative date formatting — Arabic, future-aware
// ═══════════════════════════════════════════════════════════════════════════
//
// Extracted from src/components/shared/TripCard.jsx (commit a68c5fb and
// before) so the same formatter can be reused across:
//   - TripCard (passenger-facing trip list, search results)
//   - MyTrips (where it was previously broken — calling .split(" ")
//     on ISO strings → showed "2026-05-16" as the weekday label)
//   - RecurringTrips template-instances preview
//   - Anywhere else a near-future date is shown
//
// Format ladder, from "very near" to "far away":
//   diff =  0    → "اليوم 📅"
//   diff =  1    → "غداً"
//   diff =  2    → "بعد غد"
//   diff = 3..6  → weekday name (الأحد, الإثنين, ...)
//   diff = -1    → "أمس"
//   diff < -1    → "DD MonthName" (Palestinian Arabic months)
//   diff > 6     → "DD MonthName"
//
// Why this ladder:
//   - For trip lists, users mostly care about "is this soon?"
//   - "اليوم"/"غداً" reads 3x faster than full dates
//   - Weekday names are the natural human reference for 3-6 days out
//   - Beyond a week, exact month/day matters
//
// Why "بعد غد" (day-after-tomorrow) but not "بعد يومين":
//   Palestinians use بعد غد in everyday speech. "بعد يومين" (in two
//   days) is a measurement; بعد غد is a fixed reference (= today + 2).
//   For diff=2 specifically, بعد غد is more idiomatic.

const PS_MONTHS = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"
];

const WEEKDAYS_AR = [
  "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"
];

/**
 * Parse a date string into a Date object at noon (avoids DST/timezone
 * issues at midnight boundaries). Accepts:
 *   - ISO date: "2026-05-16"
 *   - ISO datetime: "2026-05-16T08:30:00"
 *   - Any other format Date() can parse
 * Returns null if unparseable.
 *
 * Why noon: when a user posts a trip for "2026-05-16", we want today's
 * comparison to work even if the user's clock is in a different timezone
 * from UTC. Noon-local consistently lands on the calendar day everyone
 * sees on their phone, avoiding off-by-one bugs at midnight.
 */
function parseToNoonLocal(dateStr) {
  if (!dateStr) return null;
  // If already pre-formatted in Arabic or with slashes, return null so
  // the caller can fall through to display the input as-is (see fmt
  // below). This guards against double-formatting.
  if (/[؀-ۿ]/.test(dateStr) || dateStr.includes("/")) return null;
  // ISO-date case: append noon. ISO-datetime case: leave alone (the
  // existing time component dominates).
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? `${dateStr}T12:00:00`
    : dateStr;
  const d = new Date(candidate);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Main formatter — returns a short Arabic label for a date string.
 * Used by trip cards, listings, and anywhere a near-future date needs
 * a human-friendly rendering.
 *
 * Pass-through behavior:
 *   - Empty input → empty string
 *   - Arabic input (contains Arabic chars) → returned unchanged
 *     (caller already formatted it; don't double-format)
 *   - "DD/MM/YYYY" → returned unchanged (same reasoning)
 *
 * Examples (assuming today = 2026-05-18):
 *   formatRelativeDate("2026-05-18") → "اليوم 📅"
 *   formatRelativeDate("2026-05-19") → "غداً"
 *   formatRelativeDate("2026-05-20") → "بعد غد"
 *   formatRelativeDate("2026-05-22") → "الجمعة"  (within 6 days)
 *   formatRelativeDate("2026-06-05") → "5 حزيران"
 *   formatRelativeDate("2026-05-17") → "أمس"
 *   formatRelativeDate("2026-05-01") → "1 أيار"
 */
export function formatRelativeDate(dateStr) {
  if (!dateStr) return "";
  const d = parseToNoonLocal(dateStr);
  if (!d) return dateStr; // pre-formatted or unparseable — pass through

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);

  if (diff === 0) return "اليوم 📅";
  if (diff === 1) return "غداً";
  if (diff === 2) return "بعد غد";
  if (diff === -1) return "أمس";
  if (diff > 2 && diff <= 6) return WEEKDAYS_AR[d.getDay()];

  // Far past or far future — show DD MonthName (no year since Mishwaro
  // trips are usually current-year). Callers who need year disambiguation
  // can use formatRelativeDateWithYear() below.
  return `${d.getDate()} ${PS_MONTHS[d.getMonth()]}`;
}

/**
 * Like formatRelativeDate but always includes the year for dates not
 * in the current calendar year. Useful for archived trip lists, where
 * a 2024 trip and a 2025 trip on the same day-of-year would otherwise
 * read identically.
 */
export function formatRelativeDateWithYear(dateStr) {
  if (!dateStr) return "";
  const d = parseToNoonLocal(dateStr);
  if (!d) return dateStr;

  const base = formatRelativeDate(dateStr);
  // Near-future labels (اليوم/غداً/بعد غد/أمس/weekday) implicitly mean
  // "this week" — no year needed. Only the "DD MonthName" branch
  // benefits from a year suffix on cross-year dates.
  if (!base.match(/^\d+ /)) return base;

  const currentYear = new Date().getFullYear();
  return d.getFullYear() === currentYear ? base : `${base} ${d.getFullYear()}`;
}

/**
 * Component-friendly version that returns a structured object instead
 * of a string. Useful when the UI wants to render the weekday and
 * day-number in separate visual slots (e.g. MyTrips' date-tile card
 * shows weekday in small text above a large day number).
 *
 * Returns:
 *   {
 *     weekday: "الجمعة",      // weekday name (or relative label)
 *     day: 22,                 // numeric day-of-month
 *     month: "أيار",            // Palestinian month name
 *     isRelative: false,       // true for اليوم/غداً/بعد غد/أمس
 *     relativeLabel: ""        // populated only when isRelative is true
 *   }
 *
 * If parsing fails, returns null so the caller can render a safe
 * fallback rather than mis-rendering an unparseable input.
 */
export function getDateTileParts(dateStr) {
  if (!dateStr) return null;
  const d = parseToNoonLocal(dateStr);
  if (!d) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);

  const day = d.getDate();
  const month = PS_MONTHS[d.getMonth()];

  if (diff === 0) {
    return { weekday: "اليوم", day, month, isRelative: true, relativeLabel: "اليوم" };
  }
  if (diff === 1) {
    return { weekday: "غداً", day, month, isRelative: true, relativeLabel: "غداً" };
  }
  if (diff === 2) {
    return { weekday: "بعد غد", day, month, isRelative: true, relativeLabel: "بعد غد" };
  }
  if (diff === -1) {
    return { weekday: "أمس", day, month, isRelative: true, relativeLabel: "أمس" };
  }
  return {
    weekday: WEEKDAYS_AR[d.getDay()],
    day,
    month,
    isRelative: false,
    relativeLabel: "",
  };
}
