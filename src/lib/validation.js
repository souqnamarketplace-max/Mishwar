// Palestinian phone number validation
// Accepts: 0599-xxx-xxx, 0599xxxxxx, +97059xxxxxxx, 97059xxxxxxx

export function isValidPalestinianPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s\-()]/g, "");
  // Palestinian mobile: 059x, 056x, 057x with 7 more digits
  const patterns = [
    /^05[6-9]\d{7}$/,         // local format: 0598xxxxxxx
    /^\+9705[6-9]\d{7}$/,     // intl: +9705xxxxxxxx
    /^9705[6-9]\d{7}$/,       // without +
    /^972[5][6-9]\d{7}$/,     // Israeli format also used in Palestine
  ];
  return patterns.some(p => p.test(cleaned));
}

export function normalizePhone(phone) {
  if (!phone) return "";
  let p = phone.replace(/[\s\-()]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("970")) return "+" + p;
  if (p.startsWith("972")) return "+" + p;
  if (p.startsWith("0")) return "+970" + p.slice(1);
  return p;
}

export function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function passwordStrength(password) {
  if (!password) return { score: 0, label: "ضعيفة", color: "bg-destructive" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: "ضعيفة", color: "bg-destructive" };
  if (score === 2) return { score, label: "متوسطة", color: "bg-yellow-500" };
  if (score === 3) return { score, label: "جيدة", color: "bg-blue-500" };
  return { score, label: "قوية", color: "bg-green-500" };
}

// Sanitize text input to prevent XSS in trip notes / messages
export function sanitizeText(text, maxLength = 500) {
  if (!text) return "";
  return String(text)
    .slice(0, maxLength)
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");
}
