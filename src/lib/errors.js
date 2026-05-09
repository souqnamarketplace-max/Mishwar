/**
 * Translate raw Supabase / Postgres / network errors into user-facing
 * Arabic strings.
 *
 * The previous pattern across the codebase was `toast.error(err?.message
 * || 'فشل')` — which shows raw schema error text to the user. That leaks
 * column names, constraint names, and table structure to anyone who can
 * trigger an error path. This helper:
 *   1. Maps known DB error codes to friendly Arabic messages
 *   2. Recognizes our own RAISE EXCEPTION strings from RLS guard triggers
 *   3. Falls back to a generic message rather than echoing raw English
 *
 * Use it like:
 *   toast.error(friendlyError(err, 'حدث خطأ، حاول مجدداً'));
 *
 * ─── Postgres error codes Supabase commonly returns ───
 *   23505  unique_violation
 *   23514  check_violation
 *   23503  foreign_key_violation
 *   42501  insufficient_privilege   (our guard triggers raise this)
 *   PGRST301  row not found
 *   PGRST116  zero rows returned by single()
 *   PGRST202  function not found
 *   PGRST204  column not found in schema cache
 */

const KNOWN_PATTERNS = [
  // Our own RAISE EXCEPTION strings from migration triggers
  [/modifying role requires admin/i,                       "هذه العملية تتطلب صلاحيات إدارية"],
  [/modifying email requires admin/i,                      "لا يمكن تعديل البريد الإلكتروني من هنا"],
  [/passengers cannot change/i,                            "هذه العملية مسموحة للسائق فقط"],
  [/drivers cannot change/i,                               "هذه العملية مسموحة للراكب فقط"],
  [/cannot change.*after first booking/i,                  "لا يمكن تعديل تفاصيل رحلة بعد بدء الحجوزات"],
  [/cannot book your own trip/i,                           "لا يمكنك حجز رحلتك الخاصة"],
  // Block-pair errors from migration 017 — both for booking RPC and the
  // RESTRICTIVE messages_no_blocked_insert RLS policy. The RLS policy
  // surfaces as "new row violates row-level security policy" in PostgREST,
  // so we match that too and route it to the same friendly message
  // (since the only RESTRICTIVE policy on messages INSERT is the block one).
  [/cannot book.*block exists/i,                           "لا يمكنك حجز رحلة هذا السائق — أحدكما حظر الآخر"],
  [/new row violates row-level security policy.*messages|messages.*new row violates row-level security/i,
                                                           "لا يمكنك مراسلة هذا المستخدم — أحدكما حظر الآخر"],
  [/not enough seats/i,                                    "لم يتبقَ عدد كافٍ من المقاعد"],
  [/trip not bookable/i,                                   "الرحلة غير متاحة للحجز حالياً"],
  [/trip is in the past/i,                                 "هذه الرحلة قد انتهت"],
  [/trip not found/i,                                      "الرحلة غير موجودة"],
  [/booking not found/i,                                   "الحجز غير موجود"],
  [/booking already cancelled/i,                           "هذا الحجز ملغى بالفعل"],
  [/cannot edit message content/i,                         "لا يمكن تعديل محتوى رسالة من شخص آخر"],
  [/reviewer must have a completed booking/i,              "يمكنك تقييم السائقين الذين سافرت معهم فقط"],
  [/review already submitted/i,                            "لقد قمت بتقييم هذه الرحلة من قبل"],
  [/cannot delete:.+upcoming trips/i,                      "لا يمكن حذف الحساب — لديك رحلات قادمة. ألغها أولاً"],
  [/cannot delete:.+upcoming bookings/i,                   "لا يمكن حذف الحساب — لديك حجوزات قادمة. ألغها أولاً"],
  [/not authenticated|jwt expired|jwt is invalid|missing.*authorization/i,
                                                           "انتهت الجلسة — يرجى تسجيل الدخول مجدداً"],
  [/unauthorized/i,                                        "ليس لديك صلاحية لهذه العملية"],

  // Network and standard HTTP — give the user actionable info
  [/network[_ ]?error|networkerror|failed to fetch|fetch.*failed/i,
                                                           "لا يوجد اتصال بالإنترنت — تحقق من شبكتك وحاول مجدداً"],
  [/timeout|timed out|aborted/i,                           "استغرقت العملية وقتاً أطول من المتوقع. تحقق من الإنترنت وحاول مجدداً"],
  [/rate limit|too many requests|429/i,                    "طلبات كثيرة من حسابك — انتظر دقيقة وحاول مجدداً"],
  [/^5\d\d|internal server error|service unavailable|bad gateway/i,
                                                           "الخادم لا يستجيب حالياً — حاول بعد دقيقة"],
  [/cors|blocked by cors/i,                                "تعذر الاتصال بالخادم — يرجى تحديث الصفحة"],

  // Common Supabase Auth messages
  [/invalid login credentials/i,                           "البريد الإلكتروني أو كلمة المرور غير صحيحة"],
  [/email not confirmed/i,                                 "يرجى تأكيد بريدك الإلكتروني أولاً"],
  [/user already registered|user already exists/i,         "هذا البريد مسجل بالفعل — جرب تسجيل الدخول"],
  [/email rate limit exceeded/i,                           "تم إرسال عدد كبير من رسائل التأكيد لهذا البريد — انتظر ساعة"],
  [/password should contain at least one character|weak[_ ]?password/i,
                                                           "كلمة المرور ضعيفة. يجب أن تحتوي على حرف كبير وحرف صغير ورقم"],
  [/password.*at least.*characters/i,                      "كلمة المرور قصيرة جداً — استخدم 8 أحرف على الأقل"],
  [/for security purposes.*request this after (\d+)\s*seconds?/i,
                                                           "أرسلت طلب من قبل قريباً — حاول مجدداً بعد دقيقة"],
  [/database error saving new user/i,                      "تعذر إنشاء الحساب بسبب خطأ في النظام — يرجى التواصل مع الدعم"],
  [/email address.*invalid|invalid email/i,                "صيغة البريد الإلكتروني غير صحيحة"],
  [/signup.*disabled|signups disabled/i,                   "إنشاء الحسابات الجديدة معطل حالياً"],
  [/captcha/i,                                             "يرجى التحقق من خانة Captcha"],
  [/already.*confirmed/i,                                  "بريدك مؤكد بالفعل — حاول تسجيل الدخول"],
  [/user not found|no user found/i,                        "لا يوجد حساب بهذا البريد الإلكتروني"],
  [/password.*reset.*expired|otp.*expired|token.*expired/i,
                                                           "انتهت صلاحية الرابط — اطلب رابطاً جديداً"],

  // Storage errors (file uploads)
  [/payload too large|file size|too large/i,               "حجم الملف كبير جداً — استخدم ملفاً أصغر"],
  [/invalid mime type|invalid file type|not allowed.*type/i,
                                                           "نوع الملف غير مدعوم — استخدم صورة أو PDF"],
  [/storage.*quota|quota exceeded/i,                       "تم تجاوز سعة التخزين — تواصل مع الدعم"],
  [/duplicate.*storage|object already exists/i,            "ملف بنفس الاسم موجود — جرب اسماً آخر"],
  [/storage.*not found|object not found/i,                 "الملف غير موجود — قد يكون قد حُذف"],
  [/bucket not found/i,                                    "تعذر الوصول لمجلد التخزين"],

  // Common Postgres/PostgREST messages without a clean .code
  [/violates check constraint/i,                           "البيانات لا تطابق الشروط المطلوبة"],
  [/violates foreign key constraint/i,                     "البيانات المرتبطة غير موجودة أو محذوفة"],
  [/violates unique constraint|duplicate key/i,            "هذه القيمة موجودة بالفعل"],
  [/null value in column.+violates not-null/i,             "حقل مطلوب ناقص — تأكد من ملء جميع الحقول"],
  [/permission denied|new row violates row-level security/i,
                                                           "ليس لديك صلاحية لهذه العملية"],
  [/value too long.*character varying/i,                   "أحد الحقول يحتوي على نص طويل جداً"],
  [/invalid input syntax/i,                                "صيغة البيانات غير صحيحة — تحقق من المدخلات"],
];

const PG_CODE_MAP = {
  "23505": "هذه القيمة موجودة بالفعل",
  "23514": "البيانات لا تطابق الشروط المطلوبة",
  "23503": "البيانات المرتبطة غير موجودة",
  "42501": "ليس لديك صلاحية لهذه العملية",
  PGRST116: "السجل غير موجود",
  PGRST202: "هذه العملية غير متاحة حالياً", // function not found — usually means migration not applied
  PGRST204: "البيانات غير متاحة حالياً",
  PGRST301: "السجل غير موجود",
};

/**
 * Resolve a user-friendly error message from any error-like value.
 *
 * The goal: every toast.error in the app should give the user a real
 * REASON, not just "حدث خطأ". This function does its best to extract
 * one by:
 *   1. Mapping known PG/PostgREST codes to specific Arabic messages
 *   2. Pattern-matching English error text (Supabase/network/etc) to
 *      specific Arabic messages
 *   3. Surfacing already-Arabic messages from the server directly
 *   4. Surfacing short English messages with an Arabic prefix so the
 *      user at least knows the actual reason
 *   5. Falling back to the caller's `fallback` only as last resort
 *
 * Use it like:
 *   toast.error(friendlyError(err, 'حدث خطأ، حاول مجدداً'));
 *
 * @param {unknown} err          — error object, string, or anything throw-y
 * @param {string}  fallback     — message to use if nothing else matches
 */
export function friendlyError(err, fallback = "حدث خطأ. حاول مجدداً") {
  if (!err) return fallback;

  // PostgREST + Supabase errors expose .code and .message
  const code = (err && typeof err === "object" && "code" in err) ? String(err.code || "") : "";
  if (code && PG_CODE_MAP[code]) return PG_CODE_MAP[code];

  // Extract the most specific message available. Supabase errors can
  // have nested .error_description / .msg fields, plus PostgREST puts
  // the SQL detail in .details and .hint.
  const message = String(
    (err && typeof err === "object" && (
      err.error_description ||
      err.message ||
      err.msg ||
      err.error ||
      ""
    )) ||
    (typeof err === "string" ? err : "")
  );

  for (const [pattern, friendly] of KNOWN_PATTERNS) {
    if (pattern.test(message)) return friendly;
  }

  // If the message is short and already in Arabic, surface it directly.
  // Heuristic: contains any Arabic char and is < 200 chars.
  if (message && message.length < 200 && /[\u0600-\u06FF]/.test(message)) {
    return message;
  }

  // English message that didn't match a pattern — surface it with a
  // localized prefix so users at least see the reason. Most Supabase
  // errors are < 150 chars and informative if read literally.
  if (message && message.length > 0 && message.length < 200 &&
      !/^\[object|^undefined|^null/i.test(message)) {
    return `${fallback}: ${message}`;
  }

  return fallback;
}
