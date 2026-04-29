// Phone validation — accepts both Palestinian and Israeli mobile numbers.
// Both regions use 05X-XXXXXXX format locally (10 digits).
// International: +970 (Palestine) or +972 (Israel) followed by 9 digits starting with 5.
//
// Accepted formats:
//   Local:        0501234567, 0521234567, 0531234567, 0541234567, 0551234567,
//                 0561234567, 0571234567, 0581234567, 0591234567
//   Spaced/dashed: 050-123-4567, 050 123 4567, 050.123.4567
//   International (Palestine): +970501234567, +970591234567, 970591234567
//   International (Israel):    +972501234567, +972541234567, 972501234567

export function isValidPalestinianPhone(phone) {
  if (!phone) return false;
  // Strip spaces, dashes, dots, parentheses
  const cleaned = phone.replace(/[\s\-().]/g, "");

  const validFormats = [
    /^05\d{8}$/,            // local 05X-XXXXXXX (any X 0-9) — covers all PS + IL mobiles
    /^\+9705\d{8}$/,        // intl +970 5X XXXXXXX (Palestine)
    /^\+9725\d{8}$/,        // intl +972 5X XXXXXXX (Israel)
    /^9705\d{8}$/,          // 970 without +
    /^9725\d{8}$/,          // 972 without +
  ];

  return validFormats.some(re => re.test(cleaned));
}

// Backward-compat alias — same function, more accurate name
export const isValidPhone = isValidPalestinianPhone;

export function normalizePhone(phone) {
  if (!phone) return "";
  let p = phone.replace(/[\s\-().]/g, "");
  // Add + if it's a known international format without the plus
  if (p.startsWith("970")) return "+" + p;
  if (p.startsWith("972")) return "+" + p;
  // Convert local 05X to +970 5X (Palestinian default)
  if (p.startsWith("0")) return "+970" + p.slice(1);
  return p;
}

// Format for display: +970 59 123 4567 or +972 50 123 4567
export function formatPhone(phone) {
  if (!phone) return "";
  const p = normalizePhone(phone);
  // +970/+972 followed by 9 digits → +XXX XX XXX XXXX
  const m = p.match(/^(\+97[02])(\d{2})(\d{3})(\d{4})$/);
  if (m) return `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return p;
}

export function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
