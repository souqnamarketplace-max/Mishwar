// ═══════════════════════════════════════════════════════════════════════════
// Validation & sanitization utilities for مِشوار
// ═══════════════════════════════════════════════════════════════════════════

// ─── PHONE: accepts both Palestinian (+970) and Israeli (+972) mobile numbers
// Both regions use 05X-XXXXXXX format locally (10 digits).
//
// Accepted formats:
//   Local:        0501234567, 0521234567, 0531234567, 0541234567, 0551234567,
//                 0561234567, 0571234567, 0581234567, 0591234567
//   Spaced/dashed: 050-123-4567, 050 123 4567, 050.123.4567
//   International (Palestine): +970501234567, +970591234567, 970591234567
//   International (Israel):    +972501234567, +972541234567, 972501234567

export function isValidPalestinianPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-().]/g, "");
  const validFormats = [
    /^05\d{8}$/,            // local 05X-XXXXXXX (covers all PS + IL mobiles)
    /^\+9705\d{8}$/,        // intl +970 5X XXXXXXX (Palestine)
    /^\+9725\d{8}$/,        // intl +972 5X XXXXXXX (Israel)
    /^9705\d{8}$/,
    /^9725\d{8}$/,
  ];
  return validFormats.some((re) => re.test(cleaned));
}

// Backward-compat alias — same function, more accurate name
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
