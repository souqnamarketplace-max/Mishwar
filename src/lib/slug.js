/**
 * src/lib/slug.js
 *
 * Trip URL slug system.
 *
 * Purpose
 * ───────
 * Converts UUID-based trip URLs into human-readable, SEO-friendly slugs:
 *
 *   /trip/e30e8388-4207-4026-bb01-f9cd74cd1d25
 *     → /trip/qasra-kafr-al-laymun-may13-aB3xK9
 *
 * The slug has three parts joined by hyphens:
 *
 *   {from-latin}-{to-latin}-{date}-{shortCode}
 *
 *  - from/to: Latin transliteration of the city names. Uses the curated
 *             ARABIC_TO_LATIN map for common Palestinian cities; falls
 *             back to a phonetic auto-transliteration for cities the
 *             map doesn't cover.
 *  - date:    "{monShort}{day}" e.g. may13, jun4 — short and unambiguous.
 *  - code:    6-character short code on the trip row (DB column
 *             `trips.short_code`, populated by migration 022 trigger).
 *             Uses Crockford base32 alphabet (no 0/O/I/L confusion).
 *
 * Design rationale
 * ────────────────
 * 1. Latin slugs not Arabic. URL-encoded Arabic looks like
 *    `%D9%82%D8%B5%D8%B1%D8%A9` when copied/pasted, breaks SMS, ugly in
 *    analytics, and trips up some chat apps' link-preview. Arabic stays
 *    in <title>, OG tags, JSON-LD, page H1 — every place users see it.
 *
 * 2. Short code is the source of truth. We look up trips by `short_code`,
 *    not by parsing the city/date prefix. The prefix is decorative and
 *    SEO-helpful but if a driver edits the route or date, the slug
 *    visually mismatches — that's fine; the code still resolves the
 *    right row, and we redirect to the new canonical slug.
 *
 * 3. Old UUID URLs keep working forever. Anyone visiting
 *    /trip/{uuid} gets a 301 to /trip/{slug} — preserves SEO equity from
 *    existing shared links, indexed pages, and screenshots.
 */

// ─── Curated Arabic → Latin transliteration map ──────────────────────
// 30+ most-trafficked Palestinian cities, hand-curated for accuracy.
// These match what appears on the world map (e.g. Bethlehem, not Bayt Lahm)
// and what Palestinians themselves write in Latin script.
//
// For any city NOT in this map, autoTranslit() below produces a
// best-effort phonetic transliteration. Add a city here when you notice
// its auto-version is awkward.
const ARABIC_TO_LATIN = {
  // Major cities — match world-spelled forms
  "رام الله":          "ramallah",
  "نابلس":             "nablus",
  "الخليل":            "hebron",
  "بيت لحم":           "bethlehem",
  "القدس":             "jerusalem",
  "غزة":               "gaza",
  "أريحا":             "jericho",
  "جنين":              "jenin",
  "طولكرم":            "tulkarm",
  "قلقيلية":           "qalqilya",
  "سلفيت":             "salfit",
  "طوباس":             "tubas",

  // Ramallah area
  "البيرة":            "al-bireh",
  "بيتونيا":           "beitunia",
  "بيرزيت":            "birzeit",
  "العيزرية":          "al-eizariya",
  "أبو ديس":           "abu-dis",
  "الطيبة":            "taybeh",
  "كفر مالك":          "kafr-malik",

  // Nablus area
  "حوّارة":            "huwara",
  "بيتا":              "beita",
  "بيت فوريك":         "beit-furik",
  "سبسطية":            "sebastia",
  "عقربا":             "aqraba",

  // Bethlehem area
  "بيت جالا":          "beit-jala",
  "بيت ساحور":         "beit-sahour",

  // Hebron area
  "دورا":              "dura",
  "يطا":               "yatta",
  "حلحول":             "halhul",
  "بيت أمر":           "beit-ummar",

  // Jenin area
  "يعبد":              "yaabad",
  "قبّاطية":           "qabatiya",
  "عرابة":             "arraba",

  // Tulkarm / Qalqilya area
  "عنبتا":             "anabta",
  "عزون":              "azzun",

  // Common villages frequently appearing in posted trips
  "قصرة":              "qasra",
  "كفر الليمون":       "kafr-al-laymun",
  "كفر اللبد":         "kafr-al-labad",
  "السواية":           "al-sawiya",
};

/**
 * Auto-transliterate Arabic to Latin using a phonetic map.
 *
 * This is a fallback when ARABIC_TO_LATIN doesn't have the city.
 * Output is best-effort — strips diacritics, maps each Arabic letter
 * to its closest Latin equivalent, lowercase. Good enough for URL
 * slugs (which only need to be unique + readable, not perfectly
 * pronounceable).
 *
 * Examples:
 *   "بيت إيبا" → "byt-ayba"     (auto)
 *   vs "بيت إيبا" → "beit-iba"  (if curated, would prefer that)
 */
function autoTranslit(arabic) {
  if (!arabic) return "";
  const map = {
    "ا":"a","أ":"a","إ":"a","آ":"a","ء":"a","ى":"a",
    "ب":"b","ت":"t","ة":"a","ث":"th",
    "ج":"j","ح":"h","خ":"kh",
    "د":"d","ذ":"dh",
    "ر":"r","ز":"z",
    "س":"s","ش":"sh","ص":"s","ض":"d",
    "ط":"t","ظ":"z",
    "ع":"a","غ":"gh",
    "ف":"f","ق":"q","ك":"k","ل":"l","م":"m","ن":"n",
    "ه":"h","ؤ":"w","و":"w","ي":"y","ئ":"y",
    " ":"-","‎":"-","‏":"-",
    // strip diacritics
    "ً":"","ٌ":"","ٍ":"","َ":"","ُ":"","ِ":"","ّ":"","ْ":"",
  };
  let out = "";
  for (const ch of arabic) {
    out += map[ch] ?? "";
  }
  // Collapse multi-hyphens, trim, lowercase
  return out
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * cityToLatin — public helper. Use this whenever you need a city's
 * Latin form (slug, OG image text, anywhere URL-safe matters).
 *
 * Behavior:
 *   1. Exact match in ARABIC_TO_LATIN → use curated value
 *   2. Trim/normalize input and re-check curated
 *   3. Fall back to autoTranslit
 */
export function cityToLatin(arabicCity) {
  if (!arabicCity) return "";
  const trimmed = String(arabicCity).trim();
  if (ARABIC_TO_LATIN[trimmed]) return ARABIC_TO_LATIN[trimmed];
  // Try without ZW joiner / direction markers
  const stripped = trimmed.replace(/[\u200c\u200e\u200f]/g, "");
  if (ARABIC_TO_LATIN[stripped]) return ARABIC_TO_LATIN[stripped];
  return autoTranslit(trimmed);
}

// ─── Date formatting for slug ────────────────────────────────────────
// "may13", "jun4" — month-3-letters + day-of-month. Compact and unambiguous
// in Arab/Palestinian context (no year for forward-dated trips; year
// disambiguation comes from the short code).
const MONTH_SHORT = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

export function formatTripDate(dateStr) {
  if (!dateStr) return "";
  // Accepts ISO YYYY-MM-DD or full ISO timestamp
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const m = MONTH_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  return `${m}${day}`;
}

// ─── Trip slug builders/parsers ──────────────────────────────────────

/**
 * Build a canonical slug for a trip.
 *
 *   buildTripSlug({
 *     from_city: "قصرة",
 *     to_city:   "كفر الليمون",
 *     date:      "2026-05-13",
 *     short_code:"aB3xK9",
 *   })
 *   → "qasra-kafr-al-laymun-may13-aB3xK9"
 *
 * If short_code is missing (legacy trip not yet backfilled), returns
 * just the UUID — caller still uses /trip/:id and we don't pretend
 * we have a slug we don't.
 */
export function buildTripSlug(trip) {
  if (!trip) return "";
  if (!trip.short_code) {
    // No short code yet. Caller should fall back to UUID.
    return null;
  }
  const from = cityToLatin(trip.from_city);
  const to   = cityToLatin(trip.to_city);
  const date = formatTripDate(trip.date);
  const parts = [from, to, date, trip.short_code].filter(Boolean);
  return parts.join("-");
}

/**
 * Extract the short code from a slug or UUID.
 *
 *   parseTripIdFromSlug("qasra-kafr-al-laymun-may13-aB3xK9")
 *     → { kind: "slug", code: "aB3xK9" }
 *   parseTripIdFromSlug("e30e8388-4207-4026-bb01-f9cd74cd1d25")
 *     → { kind: "uuid", uuid: "e30e8388-4207-4026-bb01-f9cd74cd1d25" }
 *
 * Strategy:
 *   - UUID detection: 8-4-4-4-12 hex pattern. Distinct from slugs because
 *     slugs always have multiple "words" (city names) before the code.
 *   - Slug detection: take the LAST hyphen-separated segment as the code.
 *     The 6-char code is alphanumeric (Crockford base32) so it won't
 *     collide with city Latin segments which are all-lowercase ASCII.
 *
 * Returns { kind: "uuid"|"slug"|"invalid", uuid?, code? }
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[0-9A-Za-z]{6}$/; // Crockford-ish 6-char

export function parseTripIdFromSlug(idOrSlug) {
  if (!idOrSlug) return { kind: "invalid" };
  if (UUID_RE.test(idOrSlug)) return { kind: "uuid", uuid: idOrSlug.toLowerCase() };
  // Otherwise treat as slug — last segment is the code.
  const segs = idOrSlug.split("-");
  const last = segs[segs.length - 1];
  if (last && CODE_RE.test(last)) {
    return { kind: "slug", code: last };
  }
  return { kind: "invalid" };
}
