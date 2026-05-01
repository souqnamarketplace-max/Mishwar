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
    return "🚫 يُمنع مشاركة أرقام الهواتف في المحادثة. التواصل يتم عبر مِشوار فقط.";
  }
  if (containsContactRequest(text)) {
    return "🚫 يُمنع طلب أو مشاركة معلومات التواصل الخارجية. استخدم مِشوار للتواصل مع السائقين والركاب.";
  }
  return null;
}

// Legacy alias
export function phoneWarning() {
  return "🚫 يُمنع مشاركة أرقام الهواتف في المحادثة. يمكنك التواصل عبر التطبيق فقط بعد تأكيد الحجز.";
}
