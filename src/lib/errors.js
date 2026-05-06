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
  [/not authenticated/i,                                   "يرجى تسجيل الدخول"],
  [/unauthorized/i,                                        "ليس لديك صلاحية لهذه العملية"],

  // Network and standard HTTP
  [/network|fetch|failed to fetch/i,                       "تحقق من اتصالك بالإنترنت"],
  [/timeout|timed out/i,                                   "استغرقت العملية وقتاً أطول من المتوقع. حاول مجدداً"],
  [/rate limit|too many/i,                                 "طلبات كثيرة — يرجى الانتظار قليلاً"],

  // Common Supabase Auth messages
  [/invalid login credentials/i,                           "البريد الإلكتروني أو كلمة المرور غير صحيحة"],
  [/email not confirmed/i,                                 "يرجى تأكيد بريدك الإلكتروني أولاً"],
  [/user already registered/i,                             "هذا البريد مسجل بالفعل"],
  [/email rate limit exceeded/i,                           "تم إرسال عدد كبير من الرسائل. حاول لاحقاً"],
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
 * @param {unknown} err          — error object, string, or anything throw-y
 * @param {string}  fallback     — message to use if nothing else matches
 */
export function friendlyError(err, fallback = "حدث خطأ. حاول مجدداً") {
  if (!err) return fallback;

  // PostgREST + Supabase errors expose .code and .message
  const code = (err && typeof err === "object" && "code" in err) ? String(err.code || "") : "";
  if (code && PG_CODE_MAP[code]) return PG_CODE_MAP[code];

  const message = String(
    (err && typeof err === "object" && "message" in err && err.message) ||
    (typeof err === "string" ? err : "")
  );

  for (const [pattern, friendly] of KNOWN_PATTERNS) {
    if (pattern.test(message)) return friendly;
  }

  // If the message is short and clearly already in Arabic, surface it.
  // Heuristic: contains any Arabic char and is < 120 chars.
  if (message.length < 120 && /[\u0600-\u06FF]/.test(message)) {
    return message;
  }

  return fallback;
}
