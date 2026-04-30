// ═══════════════════════════════════════════════════════════════════════════
// Validation & sanitization utilities for مِشوار
// ═══════════════════════════════════════════════════════════════════════════

// ─── PHONE: accepts any valid international phone number (7–15 digits)
// Preferred formats for Palestinian/Israeli users:
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
export function passwordStrength(password) {
  if (!password || typeof password !== "string") {
    return { score: 0, label: "empty" };
  }
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  // Cap at 4
  score = Math.min(score, 4);
  const labels = ["very-weak", "weak", "fair", "good", "strong"];
  return { score, label: labels[score] };
}

// Alias for forward-compat with possible older imports
export const sanitizeString = sanitizeText;

// ─── PHONE NUMBER DETECTION IN CHAT ──────────────────────────────────────────
// Detects phone numbers with various obfuscation tricks used to bypass filters:
//   Standard:      0591234567, +970591234567
//   With spaces:   059 123 4567, 059-123-4567
//   Arabic digits: ٠٥٩١٢٣٤٥٦٧ (Unicode Arabic-Indic: ٠=0x0660 ... ٩=0x0669)
//   Mixed:         0591٢٣٤٥٦٧, 05٩١٢٣٤٥٦٧
//   Emoji digits:  0️⃣5️⃣9️⃣...
//   Letter-o subs: o59, O59, ০59
const PHONE_REGEX = new RegExp(
  // Matches 8+ consecutive digit-like chars (any separator between them)
  '([0-9٠-٩۰-۹]{1}[\s\-./،,_*]{0,2}){7,}' +
  '|' +
  // Palestinian/Israeli mobile starting with 0 or +970/+972
  '(\+?(970|972|0)\s?[\s\-./]*([0-9٠-٩]{1}[\s\-./،,_*]{0,2}){8,})',
  'g'
);

const EMOJI_DIGITS = /[0️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣]{4,}/g;

/**
 * Returns true if the message content contains a phone number.
 * Detects standard formats + Arabic numerals + common obfuscation tricks.
 */
export function containsPhoneNumber(text) {
  if (!text) return false;
  const normalized = text
    // Normalize Arabic-Indic digits to ASCII
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
    // Normalize letter-o/O used in place of zero
    .replace(/[oO]/g, '0')
    // Strip zero-width chars
    .replace(/[​-‍﻿]/g, '');

  // Check for 8+ consecutive digits (allowing common separators)
  const digitOnly = normalized.replace(/[\s\-./،,_*()]/g, '');
  if (/\d{8,}/.test(digitOnly)) return true;

  // Check emoji digits
  if (EMOJI_DIGITS.test(text)) return true;

  return PHONE_REGEX.test(normalized);
}

/**
 * Returns the message with phone numbers replaced by a warning placeholder.
 */
export function maskPhoneNumbers(text) {
  if (!containsPhoneNumber(text)) return text;
  return text + ' [⚠️ تم حجب رقم الهاتف — يُمنع مشاركة الأرقام في المحادثة]';
}
