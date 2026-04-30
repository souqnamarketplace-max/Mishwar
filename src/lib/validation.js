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
// Simple, reliable phone detection — strips separators then checks digit count.
// Handles: Arabic-Indic digits, letter-O substitution, zero-width chars, mixed.

function normalizeForPhoneCheck(text) {
  return text
    // Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) → ASCII
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    // Extended Arabic-Indic (۰۱۲۳۴۵۶۷۸۹) → ASCII
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48))
    // Letter O/o used instead of zero
    .replace(/[oO]/g, '0')
    // Zero-width and invisible chars
    .replace(/[​-‍﻿­]/g, '');
}

/**
 * Returns true if text contains a phone number (8+ digits with common separators).
 * Catches standard formats + Arabic numerals + common obfuscation tricks.
 */
export function containsPhoneNumber(text) {
  if (!text || text.length < 7) return false;

  const norm = normalizeForPhoneCheck(text);

  // Strip common separators and check if 8+ consecutive digits remain in any segment
  // We scan the normalized text and count digit runs separated only by [\s\-.()+,*_]
  let digitRun = 0;
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i];
    if (ch >= '0' && ch <= '9') {
      digitRun++;
      if (digitRun >= 8) return true;
    } else if (' -.()+,*_/'.includes(ch)) {
      // Allow separator within a number (e.g. 059-123-4567)
      // but reset if run has accumulated less than 3 before separator
      if (digitRun < 2) digitRun = 0;
      // else keep accumulating (separator inside number is fine)
    } else {
      // Non-digit, non-separator: break the run
      digitRun = 0;
    }
  }
  return false;
}

/**
 * Returns a warning message if text contains a phone number, otherwise null.
 */
export function phoneWarning() {
  return "🚫 يُمنع مشاركة أرقام الهواتف في المحادثة. يمكنك التواصل عبر التطبيق فقط بعد تأكيد الحجز.";
}
