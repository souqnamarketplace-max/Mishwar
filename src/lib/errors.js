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
  // The deleted_at protection from migration 002. After migration 035
  // the deletion RPC bypasses the trigger via the
  // mishwar.deleting_account session-var handshake, so this should
  // not fire on the normal delete-account flow. It can still surface
  // if (a) a legacy direct-UPDATE path is somehow re-introduced, or
  // (b) an admin tool hits this column without going through an RPC.
  // Friendly message keeps that case from looking like the unrelated
  // email error (which was the original prod bug — migration 002's
  // pattern came up first in friendlyError when the trigger fired and
  // its message didn't have a more specific match).
  [/modifying deleted_at requires admin or rpc/i,          "لا يمكن حذف الحساب بهذه الطريقة. يرجى إعادة المحاولة، وإن استمرت المشكلة تواصل مع الدعم"],
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
  [/booking blocked due to strikes/i,                      "تم تعليق إمكانية الحجز مؤقتاً بسبب إلغاءات متكررة في وقت متأخر. حاول مجدداً بعد 30 يوماً من آخر إلغاء"],
  [/admin only/i,                                          "هذه العملية متاحة للمشرفين فقط"],
  // Trip-request error patterns (migration 019)
  [/too many active requests/i,                            "وصلت إلى الحد الأقصى من الطلبات النشطة (3). ألغِ أحدها قبل إنشاء جديد"],
  [/passenger not verified/i,                              "يجب توثيق هويتك أولاً قبل نشر طلب رحلة"],
  [/already verified/i,                                    "حسابك موثّق بالفعل"],
  [/rejection reason required/i,                           "يرجى كتابة سبب الرفض"],
  [/full_name_on_id required/i,                            "يرجى كتابة الاسم كما يظهر على الهوية"],
  [/id_front and selfie photos are required/i,             "صورة الهوية والصورة الشخصية مطلوبتان"],
  [/verification not found/i,                              "طلب التوثيق غير موجود"],
  [/request date is in the past/i,                         "لا يمكن إنشاء طلب لتاريخ ماضٍ"],
  [/request not found/i,                                   "الطلب غير موجود"],
  [/request already closed/i,                              "هذا الطلب مغلق بالفعل"],
  [/request not open/i,                                    "هذا الطلب لم يعد مفتوحاً"],
  [/unauthorized to cancel this request/i,                 "ليس لديك صلاحية لإلغاء هذا الطلب"],
  [/only the passenger can mark a request matched/i,       "هذا الإجراء متاح للراكب فقط"],
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
  //
  // IMPORTANT: more-specific RAISE EXCEPTION patterns from our own RPCs
  // come FIRST — they need to match before the generic
  // 'violates check constraint' fallback below catches every 23514.

  // book_seat (migrations 003, 017, 018, 034, 037)
  [/profile incomplete|finish onboarding|onboarding/i,
                                                           "يرجى إكمال إعداد حسابك أولاً قبل الحجز"],
  [/cannot book your own trip/i,                           "لا يمكنك حجز رحلتك أنت"],
  [/not enough seats/i,                                    "لا توجد مقاعد كافية متاحة في هذه الرحلة"],
  [/trip is in the past/i,                                 "هذه الرحلة قد انتهت بالفعل"],
  [/trip not bookable.*status/i,                           "هذه الرحلة غير متاحة للحجز حالياً"],
  [/trip not found/i,                                      "الرحلة المطلوبة غير موجودة"],
  [/booking blocked due to strikes/i,                      "حسابك معلق مؤقتاً بسبب تجاوزات سابقة — تواصل مع الدعم"],
  [/block exists between passenger and driver/i,           "لا يمكن إتمام الحجز — يوجد حظر بينك وبين السائق"],
  [/invalid seat count/i,                                  "عدد المقاعد غير صحيح"],
  [/passenger has.*conflict|booking conflict|overlap.*booking|conflict.*booking/i,
                                                           "لديك حجز آخر في نفس الوقت — ألغِ الحجز السابق أولاً"],
  // Driver trip conflict — raised by prevent_driver_trip_conflict
  // trigger (migration 062) when a driver tries to publish a second
  // trip on a day they already have an active trip. Same-day rule
  // mirrors the passenger booking guard. Wording mirrors the HINT
  // text the trigger emits ("Cancel it first or pick another day").
  [/trip conflict.*driver already has an active trip on/i,
                                                           "لديك رحلة منشورة في نفس اليوم — ألغِها أولاً أو اختر يوماً آخر"],

  // Trip lifecycle RPCs (migration 048 — start_trip / complete_trip /
  // change_trip_time). The RPCs use English exception text by design
  // (postgres logs stay searchable); the friendlier Arabic patterns
  // are mapped here.
  [/too early.*departure is in (\d+) minutes/i,
   (m) => `لا يمكن بدء الرحلة الآن — تبقى ${m[1]} دقيقة على موعد الانطلاق (يمكنك البدء قبل 30 دقيقة من الموعد)`],
  [/too late.*departure was (\d+) minutes ago/i,
   (m) => `فات موعد الرحلة بـ ${m[1]} دقيقة — يرجى التواصل مع الدعم`],
  [/cannot start trip from status (.+)/i,
   (m) => `لا يمكن بدء الرحلة — الحالة الحالية: ${m[1]}`],
  [/cannot complete trip from status (.+)/i,
   (m) => `لا يمكن إنهاء الرحلة — الحالة الحالية: ${m[1]}. يجب أن تكون "جارية"`],
  [/not your trip/i,                                       "لا يمكنك تعديل رحلة شخص آخر"],
  [/can only change time of confirmed trips/i,             "لا يمكن تعديل وقت رحلة جارية أو منتهية"],
  [/trip date is in the past/i,                            "لا يمكن تعديل وقت رحلة قد مضت"],
  [/time change too large.*(\d+) minutes/i,
   (m) => `الفرق ${m[1]} دقيقة كبير جداً — يجب أن يكون 60 دقيقة أو أقل. للتغييرات الأكبر يجب إلغاء الرحلة وإعادة نشرها`],
  [/new time is identical/i,                               "الوقت الجديد مطابق للوقت الحالي"],
  [/new time is required/i,                                "يرجى اختيار الوقت الجديد"],

  // Trip creation / update (migration 002 + business triggers)
  [/cannot change (passenger_email|driver_email|sender_email|receiver_email)/i,
                                                           "تعذر التحديث — لا يمكن تغيير بيانات تعريف الحساب"],
  [/passengers cannot change|drivers cannot change/i,      "ليس لديك صلاحية تغيير هذا الحقل"],
  [/passengers can only cancel/i,                          "يمكنك فقط إلغاء الحجز"],

  // Generic Postgres errors (must come AFTER the specific patterns above)
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
    const match = pattern.exec(message);
    if (match) {
      // Patterns can be either a static Arabic string OR a function
      // taking the match array and returning the Arabic string.
      // Function form lets the translation include captured groups
      // (e.g. minute counts from time-gate rejections in migration
      // 048's RPCs).
      return typeof friendly === "function" ? friendly(match) : friendly;
    }
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
