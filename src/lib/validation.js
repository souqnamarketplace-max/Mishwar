// ═══════════════════════════════════════════════════════════════════════════
// Validation & sanitization utilities for مشوارو
// ═══════════════════════════════════════════════════════════════════════════

// ─── PHONE: accepts any valid international phone number (7–15 digits)
// Preferred formats for Palestinian users:
//   Local:         0501234567, 0591234567 (Palestinian)
//   International: +970501234567, +972501234567, +1 555 123 4567, etc.
//
// We intentionally accept any format with 7–15 digits so users from
// any region (family abroad, international contacts) can register.

export function isValidPalestinianPhone(phone) {
  if (!phone) return false;
  // Strip spaces, dashes, dots, parentheses, and leading +
  const cleaned = phone.replace(/[\s\-().+]/g, "");
  // Must be purely digits and between 7–15 digits (ITU-T E.164 range)
  return /^\d{7,15}$/.test(cleaned);
}

// Backward-compat alias
export const isValidPhone = isValidPalestinianPhone;

// ─── DETAILED PHONE COMPLIANCE
// Returns granular pass/fail flags so the UI can show a live indicator
// next to the phone input (same pattern as password requirements).
// `reason` (when present) is a specific Arabic message explaining what
// the user needs to fix — never a generic "invalid phone".
//
// Recognized "good" formats (any of these passes):
//   - Palestinian local:   05XXXXXXXX (10 digits, starts with 05)
//   - Palestinian intl:    +970 5XXXXXXXX
//   - International format:  +972 5XXXXXXXX
//   - Other international: +CCNNNNNNN... (7–15 digits total)
//
// We don't reject non-Palestinian numbers (family-abroad use case is
// real) but we DO highlight the common Palestinian patterns since that's
// the primary user base.
export function validatePhone(phone) {
  const result = {
    nonEmpty:        false,
    digitsOnly:      true,    // after stripping +/spaces/dashes
    inLengthRange:   false,   // 7–15 total digits
    looksPalestinian: false,  // matches preferred PS format
    reason:          null,
  };
  if (!phone || phone.trim().length === 0) {
    result.reason = "يرجى إدخال رقم الهاتف";
    return result;
  }
  result.nonEmpty = true;
  // Allowed chars: digits, leading +, separators (space/dash/dot/parens)
  if (/[^\d+\s\-().]/.test(phone)) {
    result.digitsOnly = false;
    result.reason = "الرقم يحتوي على رموز غير مسموحة — استخدم أرقاماً فقط";
    return result;
  }
  const cleaned = phone.replace(/[\s\-().+]/g, "");
  if (cleaned.length === 0) {
    result.reason = "يرجى إدخال أرقام الهاتف";
    return result;
  }
  if (cleaned.length < 7) {
    result.reason = "الرقم قصير جداً — يجب أن يحتوي على 7 أرقام على الأقل";
    return result;
  }
  if (cleaned.length > 15) {
    result.reason = "الرقم طويل جداً — الحد الأقصى 15 رقماً";
    return result;
  }
  result.inLengthRange = true;
  // Palestinian format detection
  result.looksPalestinian =
    /^(?:\+?970|\+?972|0)5[02-9]\d{7}$/.test(cleaned) ||
    /^05[02-9]\d{7}$/.test(cleaned);
  return result;
}

// ─── FULL NAME COMPLIANCE
// Returns granular pass/fail flags for live indicator. Rules tuned for
// real-world Arabic + English names without being too permissive:
//   - At least 2 characters (after trimming)
//   - At most 100 characters
//   - At least one letter (Arabic or Latin) — rejects all-numbers/symbols
//   - No emojis or symbols beyond letters/spaces/hyphens/apostrophes/dots
//
// Allows: محمد أحمد / Mohammed Ahmed / O'Brien / Saint-Denis / Dr. Smith
// Rejects: 12345 / "" / "@@@" / "Mohamed 🚀"
export function validateFullName(name) {
  const result = {
    nonEmpty:    false,
    longEnough:  false,   // >= 2 trimmed chars
    notTooLong:  false,   // <= 100 chars
    hasLetter:   false,   // contains an Arabic or Latin letter
    cleanChars:  false,   // only allowed character classes
    reason:      null,
  };
  if (!name || name.trim().length === 0) {
    result.reason = "يرجى إدخال الاسم الكامل";
    return result;
  }
  result.nonEmpty = true;
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    result.reason = "الاسم قصير جداً — استخدم حرفين على الأقل";
    return result;
  }
  result.longEnough = true;
  if (trimmed.length > 100) {
    result.reason = "الاسم طويل جداً — الحد الأقصى 100 حرف";
    return result;
  }
  result.notTooLong = true;
  // Latin letters OR Arabic letters
  result.hasLetter = /[A-Za-z\u0600-\u06FF]/.test(trimmed);
  if (!result.hasLetter) {
    result.reason = "الاسم يجب أن يحتوي على أحرف";
    return result;
  }
  // Allowed: Arabic letters + diacritics, Latin letters, spaces, hyphens,
  // apostrophes (O'Brien), dots (Dr.), and digits between (rare but valid
  // in some legal names like "John 3rd")
  const allowedPattern = /^[A-Za-z\u0600-\u06FF0-9\s\-'.\u064B-\u065F\u0670]+$/;
  if (!allowedPattern.test(trimmed)) {
    result.cleanChars = false;
    result.reason = "الاسم يحتوي على رموز غير مسموحة — استخدم أحرفاً فقط";
    return result;
  }
  result.cleanChars = true;
  return result;
}

export function normalizePhone(phone) {
  if (!phone) return "";
  let p = phone.replace(/[\s\-().]/g, "");
  if (p.startsWith("970")) return "+" + p;
  if (p.startsWith("972")) return "+" + p;
  if (p.startsWith("0")) return "+970" + p.slice(1);
  return p;
}

export function formatPhone(phone) {
  if (!phone) return "";
  const p = normalizePhone(phone);
  const m = p.match(/^(\+97[02])(\d{2})(\d{3})(\d{4})$/);
  if (m) return `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return p;
}

// ─── EMAIL
export function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── TEXT SANITIZATION
// Removes control characters, strips dangerous HTML, normalizes whitespace,
// and optionally caps length. Use this for any user-supplied text that will be
// stored or displayed (trip descriptions, messages, profile bios, etc.).
export function sanitizeText(input, maxLength = 2000) {
  if (input == null) return "";
  let s = String(input);
  // Remove HTML tags (basic XSS protection — server should also escape on render)
  s = s.replace(/<\/?[^>]+(>|$)/g, "");
  // Strip control chars except newline (\n) and tab (\t)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Collapse runs of whitespace (but preserve newlines)
  s = s.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n");
  // Trim leading/trailing newlines
  s = s.replace(/^\n+|\n+$/g, "");
  // Cap length
  if (typeof maxLength === "number" && maxLength > 0 && s.length > maxLength) {
    s = s.slice(0, maxLength);
  }
  return s;
}


// ─── PASSWORD STRENGTH
// Returns { score: 0..4, label: 'weak'|'fair'|'good'|'strong' }
// Used by signup forms to gate weak passwords.
//
// Minimum acceptable score for new accounts is 3 (raised from 2 in audit
// H-04). Combined with the 8-char minimum length check at the form level,
// this rejects passwords like "Abc123" that previously squeaked through.
export function passwordStrength(password) {
  if (!password || typeof password !== "string") {
    return { score: 0, label: "empty" };
  }
  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  // Cap at 4
  score = Math.min(score, 4);
  const labels = ["very-weak", "weak", "fair", "good", "strong"];
  return { score, label: labels[score] };
}

// Minimum password configuration. Centralized so all forms agree.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MIN_SCORE  = 3;

// ─── PASSWORD COMPLIANCE
// Mirrors Supabase Auth's server-side password policy, which requires
// at least one of each: lowercase letter, uppercase letter, digit.
// Without this client-side check, users hit Supabase's HTTP 422
// `weak_password` error and see a generic "failure" toast — the most
// common signup failure mode in production. By validating client-side
// FIRST with specific Arabic feedback, we tell users exactly what's
// missing before they hit submit.
//
// Returns an object describing what (if anything) is missing. An empty
// `missing` array means the password is acceptable to Supabase.
export function validatePasswordCompliance(password) {
  const result = { missing: [], hasLower: false, hasUpper: false, hasDigit: false, longEnough: false };
  if (!password || typeof password !== "string") {
    result.missing.push("length", "lower", "upper", "digit");
    return result;
  }
  result.longEnough = password.length >= PASSWORD_MIN_LENGTH;
  result.hasLower   = /[a-z]/.test(password);
  result.hasUpper   = /[A-Z]/.test(password);
  result.hasDigit   = /\d/.test(password);
  if (!result.longEnough) result.missing.push("length");
  if (!result.hasLower)   result.missing.push("lower");
  if (!result.hasUpper)   result.missing.push("upper");
  if (!result.hasDigit)   result.missing.push("digit");
  return result;
}

// Build a human-readable Arabic message listing missing requirements.
// Used by the signup toast to tell the user EXACTLY what's wrong, not
// the generic "weak password" we used to show.
export function passwordComplianceMessage(check) {
  const parts = [];
  if (check.missing.includes("length")) parts.push(`${PASSWORD_MIN_LENGTH} أحرف على الأقل`);
  if (check.missing.includes("upper"))  parts.push("حرف كبير (A-Z)");
  if (check.missing.includes("lower"))  parts.push("حرف صغير (a-z)");
  if (check.missing.includes("digit"))  parts.push("رقم (0-9)");
  if (parts.length === 0) return "";
  return `كلمة المرور يجب أن تحتوي على: ${parts.join("، ")}`;
}

// Minimum age for مشوارو. Stated in Terms section 3 ("يجب أن يكون عمرك
// 18 سنة أو أكثر"). Enforced here client-side AND in the DB via a CHECK
// constraint on profiles.date_of_birth (migration 058) — both layers
// matter: client-side keeps the form honest and shows a helpful Arabic
// toast, server-side stops API-direct signup bypass attempts.
//
// App Store review specifically flags rideshare apps that claim 17+
// rating without an age affirmation. This validator backs the DOB
// field added to the signup form.
export const MIN_AGE_YEARS = 18;

/**
 * Validate a date-of-birth string (ISO yyyy-mm-dd from a <input type="date">).
 *
 * Returns one of:
 *   { ok: false, reason: "..." }       — bad format, future date, too young, etc.
 *   { ok: true,  age: <integer> }      — passed all checks
 *
 * Age is computed against the user's local clock, which is fine for a
 * launch-day check — a user 1 day shy of 18 in their timezone but 1 day
 * past 18 in UTC is an edge case we don't need to hand-craft logic for.
 * The server-side CHECK constraint computes the same way (current_date -
 * date_of_birth) so both layers agree.
 */
export function validateDateOfBirth(dobIso) {
  if (!dobIso || typeof dobIso !== "string") {
    return { ok: false, reason: "يرجى إدخال تاريخ الميلاد" };
  }
  // <input type="date"> always emits yyyy-mm-dd. Anything else is suspect.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) {
    return { ok: false, reason: "صيغة التاريخ غير صحيحة" };
  }
  const dob = new Date(dobIso + "T00:00:00");
  if (isNaN(dob.getTime())) {
    return { ok: false, reason: "تاريخ غير صالح" };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dob > today) {
    return { ok: false, reason: "تاريخ الميلاد لا يمكن أن يكون في المستقبل" };
  }
  // Sanity floor — nobody on the platform is 120+ years old. Catches
  // obvious typos like 1023-04-01.
  const minBirthYear = today.getFullYear() - 120;
  if (dob.getFullYear() < minBirthYear) {
    return { ok: false, reason: "تاريخ الميلاد غير منطقي" };
  }
  // Compute age in completed years (the way humans count).
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  if (age < MIN_AGE_YEARS) {
    return {
      ok: false,
      reason: `يجب أن يكون عمرك ${MIN_AGE_YEARS} سنة أو أكثر لاستخدام مشوارو`,
    };
  }
  return { ok: true, age };
}

// Common-password blocklist (top 50 most-leaked passwords ever; the long
// tail is left to passwordStrength scoring + Supabase Auth's own breach
// detection if enabled). Lowercased for comparison.
const COMMON_PASSWORDS = new Set([
  "password","12345678","123456789","qwerty123","password1","12345678910",
  "1234567890","qwerty1234","password123","welcome1","admin123","letmein1",
  "iloveyou1","football1","monkey123","dragon123","master123","sunshine1",
  "princess1","password!","qwertyuiop","abc12345","11111111","123123123",
  "00000000","baseball1","superman1","trustno11","whatever1","jennifer1",
  "jordan123","michael1","tinkle12","passw0rd","password!1","p@ssw0rd",
  "qazwsxedc","1q2w3e4r5t","zxcvbnm123","asdfghjkl1","qwerty12345",
  "starwars1","princess123","123qweasd","1qaz2wsx","welcome123","admin@123",
]);

export function isCommonPassword(password) {
  if (!password) return false;
  return COMMON_PASSWORDS.has(String(password).toLowerCase());
}

// Alias for forward-compat with possible older imports
export const sanitizeString = sanitizeText;


// ─── CONTACT INFO DETECTION IN CHAT ─────────────────────────────────────────
// Catches phone numbers, contact-sharing requests, and social media handles.
// Handles: Arabic-Indic digits, obfuscation, word-form numbers, multi-language.

// Arabic number words → digit
const AR_WORD_TO_DIGIT = {
  'صفر':'0','واحد':'1','اثنين':'2','اثنان':'2','ثلاثة':'3','ثلاث':'3',
  'أربعة':'4','اربعة':'4','خمسة':'5','ستة':'6','ست':'6',
  'سبعة':'7','ثمانية':'8','تسعة':'9',
  // English words
  'zero':'0','one':'1','two':'2','three':'3','four':'4',
  'five':'5','six':'6','seven':'7','eight':'8','nine':'9',
};

function normalizeForCheck(text) {
  let t = text
    // Arabic-Indic digits → ASCII
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    // Extended Arabic-Indic → ASCII
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
    // Zero-width and invisible chars
    .replace(/[​-‍﻿­]/g, '')
    // Common letter substitutions
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[zZ]/g, '2')
    // Dots/commas between digits that are separators
    .replace(/(\d)[.,·•](\d)/g, '$1$2');

  // Replace Arabic/English number words with digits
  const pattern = new RegExp(Object.keys(AR_WORD_TO_DIGIT).join('|'), 'gi');
  t = t.replace(pattern, m => AR_WORD_TO_DIGIT[m.toLowerCase()] ?? m);

  return t;
}

/**
 * Checks if text contains a phone number (7+ digits with common separators).
 * Catches: Arabic-Indic digits, obfuscation, word-form numbers, mixed scripts.
 */
export function containsPhoneNumber(text) {
  if (!text || text.length < 6) return false;
  const norm = normalizeForCheck(text);

  let digitRun = 0;
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i];
    if (ch >= '0' && ch <= '9') {
      digitRun++;
      if (digitRun >= 7) return true;
    } else if (' \-.()+,*_/'.includes(ch)) {
      if (digitRun < 2) digitRun = 0;
    } else {
      digitRun = 0;
    }
  }
  return false;
}

/**
 * Checks if text contains a contact-sharing request or social media handle.
 * Catches requests in Arabic, English, and common evasion tricks.
 */
export function containsContactRequest(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  // Direct contact platforms
  const platforms = [
    'whatsapp','واتساب','وتساب','واتس اب','ويتساب',
    'telegram','تيليجرام','تيلغرام','تلغرام','تيلجرام',
    'instagram','انستغرام','انستجرام','ايستغرام',
    'snapchat','سناب','سناب شات',
    'tiktok','تيك توك','تيكتوك',
    'facebook','فيسبوك','فيس بوك',
    'twitter','تويتر',
    'signal','سيجنال',
    'imo', 'ايمو',
    'viber','فايبر',
  ];

  // Contact-asking phrases
  const contactPhrases = [
    // Arabic
    'رقمي','رقمك','رقم الهاتف','رقم تلفون','رقم موبايل','رقم جوال',
    'ارسل رقم','ابعث رقم','اعطني رقم','عطني رقم','شاركني رقم',
    'تواصل معي','تواصل معك','تواصل على','تواصلوا','تواصل بـ',
    'اتصل بي','اتصل علي','اتصل معي','كلمني','كلمني على',
    'ارسل لي','ابعث لي','راسلني على','راسلني في',
    'على الواتس','ع الواتس','على التيليجرام',
    'دم اتصال','معلومات التواصل','بيانات التواصل',
    'خارج التطبيق','برا التطبيق','بره التطبيق',
    'ايميلي','ايميلك','بريدي','بريدك','البريد الالكتروني',
    '@gmail','@hotmail','@yahoo','@outlook',
    // English
    'my number','your number','call me','text me','dm me',
    'reach me','contact me','message me on','find me on',
    'outside the app','off the app','off app',
    'my email','your email','send me your',
  ];

  for (const p of platforms) {
    if (t.includes(p)) return true;
  }
  for (const p of contactPhrases) {
    if (t.includes(p)) return true;
  }

  // Detect @handle patterns (social media)
  if (/@[a-z0-9_.]{3,}/i.test(text)) return true;

  // Detect email-like patterns
  if (/[a-zA-Z0-9._%+\-]{3,}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) return true;

  return false;
}

/**
 * Master check — returns a warning string if message violates contact policy, else null.
 */
export function getContactViolation(text) {
  if (containsPhoneNumber(text)) {
    return "🚫 يُمنع مشاركة أرقام الهواتف في المحادثة. التواصل يتم عبر مشوارو فقط.";
  }
  if (containsContactRequest(text)) {
    return "🚫 يُمنع طلب أو مشاركة معلومات التواصل الخارجية. استخدم مشوارو للتواصل مع السائقين والركاب.";
  }
  return null;
}

// Legacy alias
export function phoneWarning() {
  return "🚫 يُمنع مشاركة أرقام الهواتف في المحادثة. يمكنك التواصل عبر التطبيق فقط بعد تأكيد الحجز.";
}

// ─── SOFT WARNING: Pure-digit fragment (anti-evasion) ────────────────
//
// Companion to containsPhoneNumber() which BLOCKS messages with 7+
// consecutive digits. The blocker doesn't catch the evasion pattern
// observed on Poparide screenshots — drivers SPLIT a phone number
// across multiple short messages:
//
//     Message 1: "925"
//     Message 2: "5959"
//
// Each message has < 7 digits, so neither is blocked, but together
// they encode 9255959 (a Palestinian mobile number).
//
// We can't track cross-message state cheaply (the chat store is
// per-conversation and would need a new sliding-window buffer), so
// instead we use a simpler signal: any message whose ENTIRE content
// is just digits (with minor separators) deserves a soft warning.
// Legitimate uses are rare:
//   - Confirming a room/apartment number ("925") — uncommon
//   - Sharing a year ("2026") — uncommon
// Evasion uses are dominant. A WARNING (not block) lets the rare
// legitimate use through while making the evasion intent obvious
// to the sender.
//
// Returns true if:
//   - Message has 3-6 digits (7+ is already blocked elsewhere)
//   - Message contains ONLY digits, optional whitespace, dashes,
//     plus signs, parens, dots
//   - NOT a recognizable date/time/price (contains : or $ or ₪)
//
// False-positive examples we EXCLUDE intentionally:
//   "5:30"  → has colon → time, not warned
//   "₪37"   → has shekel → price, not warned
//   "37$"   → has dollar → price, not warned
//   "9255959" → 7+ digits → BLOCKED by containsPhoneNumber (stronger)
//
// True-positive examples we WARN:
//   "925"      → bare 3 digits
//   "5959"     → bare 4 digits
//   "925 5959" → 7+ across spaces → already blocked by containsPhoneNumber
export function looksLikeDigitFragment(text) {
  if (!text) return false;
  const trimmed = String(text).trim();
  if (trimmed.length === 0) return false;

  // Excludes: time (5:30), price (₪37 / $37 / 37₪), explicit URLs
  if (/[:$₪]|http/i.test(trimmed)) return false;

  // Allowed characters: digits, whitespace, dash, plus, parens, dot
  // Anything else (letters, Arabic, emoji) disqualifies this as a
  // "bare number fragment" — it's a real message with context.
  if (!/^[\d\s\-+().,*_/]+$/.test(trimmed)) return false;

  // Count actual digits
  const digitCount = (trimmed.match(/\d/g) || []).length;

  // 3-6 digits is the suspicious zone. <3 is too short to be a
  // useful phone chunk. 7+ is already blocked by containsPhoneNumber.
  return digitCount >= 3 && digitCount <= 6;
}

// ─── DATE / NUMBER GUARDS ──────────────────────────────────────────────────
// Defensive helpers for form inputs.
//
// <input type="date" min={today}> prevents pickers from offering past
// dates, but does NOT prevent the user from typing/pasting a past
// date directly (especially on iOS Safari and some Android browsers).
//
// <input type="number" min="0"> prevents the up-arrow from going
// below 0, but the user can still TYPE -50 or 0 directly.
//
// These checks must therefore happen at submit-time as well, not
// just on the input attribute. Use these helpers in your validate()
// functions to catch the typed-around case.

/** ISO date string (yyyy-MM-dd) for today, in local time. */
export function todayISO() {
  return new Date().toISOString().split("T")[0];
}

/** True if the given yyyy-MM-dd string is today or later. */
export function isFutureOrToday(dateStr) {
  if (!dateStr) return false;
  // Compare strings — yyyy-MM-dd sorts lexicographically by date when
  // both sides are zero-padded. Avoids time-zone gotchas.
  return dateStr >= todayISO();
}

/** True if dateStr is strictly after today (i.e. tomorrow or later). */
export function isStrictlyFuture(dateStr) {
  if (!dateStr) return false;
  return dateStr > todayISO();
}

// ─── ARABIC DATE FORMATTING ────────────────────────────────────────────────
// Use these instead of `toLocaleDateString("ar-SA", ...)` or bare
// `toLocaleDateString("ar", ...)`. The "ar-SA" locale defaults to the
// Hijri (Islamic) calendar, which is unfamiliar in Palestine where the
// Gregorian calendar with Arabic month names is the standard format used
// in newspapers, government documents, and everyday life.
//
// "ar-EG" gives Gregorian dates with Arabic month names ("٦ مايو ٢٠٢٦"),
// which is the modern Levantine convention. This matches Palestinian
// users' expectations and matches how dates appear elsewhere in the app
// (Blog.jsx already used ar-EG).

export function formatArabicDate(input, options = { day: "numeric", month: "long", year: "numeric" }) {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ar-EG", options);
}

export function formatArabicDateShort(input) {
  return formatArabicDate(input, { day: "numeric", month: "short", year: "numeric" });
}

export function formatArabicDateNumeric(input) {
  // For tables / dense UI — "06/05/2026" with Arabic numerals
  return formatArabicDate(input, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatArabicWeekday(input) {
  return formatArabicDate(input, { weekday: "long" });
}
