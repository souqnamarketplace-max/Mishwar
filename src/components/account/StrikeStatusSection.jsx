import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, CheckCircle2, Info, Clock } from "lucide-react";

/**
 * StrikeStatusSection — shows the user their cancellation strike state.
 *
 * Pulls the relevant columns directly from their profile row:
 *   - strike_count          (rolling 30-day window, may be stale until DB
 *                            recomputes — we apply the same expiry on the
 *                            client for an accurate live view)
 *   - last_cancelled_at     (anchor for the rolling window)
 *   - cancellation_count    (lifetime, informational)
 *   - late_cancellation_count (lifetime, informational)
 *
 * The threshold (3 strikes) and window (30 days) are documented constants
 * matching migration 018.
 */
const STRIKE_THRESHOLD = 3;
const WINDOW_DAYS = 30;

export default function StrikeStatusSection({ user }) {
  const email = user?.email;

  // Pull the live profile row (not the cached `user` prop, since that
  // can be stale by minutes — strikes need to be current).
  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-strike-profile", email],
    queryFn: () => base44.entities.Profile.filter({ email }, "-created_at", 1)
      .then(rows => rows?.[0] || null),
    enabled: !!email,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" dir="rtl">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const lifetimeCancels = profile?.cancellation_count || 0;
  const lifetimeLate    = profile?.late_cancellation_count || 0;
  const storedStrikes   = profile?.strike_count || 0;
  const lastCancelledAt = profile?.last_cancelled_at;

  // Apply the same 30-day rolling expiry the DB does, so the user sees
  // an accurate count even if the DB hasn't been re-touched recently.
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const isExpired = !lastCancelledAt
    || Date.now() - new Date(lastCancelledAt).getTime() > windowMs;
  const effectiveStrikes = isExpired ? 0 : storedStrikes;

  // Days until the rolling window resets (if currently struck)
  const daysUntilReset = lastCancelledAt && !isExpired
    ? Math.max(0, Math.ceil((new Date(lastCancelledAt).getTime() + windowMs - Date.now()) / 86400000))
    : 0;

  const isBlocked = effectiveStrikes >= STRIKE_THRESHOLD;
  const isWarning = effectiveStrikes > 0 && !isBlocked;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Hero status card */}
      <div className={`rounded-2xl border p-5 ${
        isBlocked  ? "bg-destructive/10 border-destructive/40" :
        isWarning  ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800" :
                     "bg-green-50 dark:bg-green-950/20 border-green-300 dark:border-green-800"
      }`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            isBlocked  ? "bg-destructive/20" :
            isWarning  ? "bg-amber-200/60 dark:bg-amber-900/40" :
                         "bg-green-200/60 dark:bg-green-900/40"
          }`}>
            {isBlocked  ? <AlertTriangle className="w-5 h-5 text-destructive" /> :
             isWarning  ? <Info className="w-5 h-5 text-amber-700 dark:text-amber-400" /> :
                          <CheckCircle2 className="w-5 h-5 text-green-700 dark:text-green-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`font-bold text-base mb-1 ${
              isBlocked  ? "text-destructive" :
              isWarning  ? "text-amber-900 dark:text-amber-200" :
                           "text-green-900 dark:text-green-200"
            }`}>
              {isBlocked
                ? "تم تعليق إمكانية الحجز مؤقتاً"
                : isWarning
                  ? `لديك ${effectiveStrikes} ${effectiveStrikes === 1 ? "نقطة سلبية" : "نقاط سلبية"}`
                  : "حسابك بحالة جيدة ✓"}
            </h3>
            <p className={`text-xs leading-relaxed ${
              isBlocked  ? "text-destructive/90" :
              isWarning  ? "text-amber-800 dark:text-amber-300" :
                           "text-green-800 dark:text-green-300"
            }`}>
              {isBlocked
                ? `بسبب ${effectiveStrikes} إلغاءات متأخرة (أقل من ساعتين قبل الرحلة) خلال آخر ${WINDOW_DAYS} يوماً. ستعود إمكانية الحجز تلقائياً بعد ${daysUntilReset} ${daysUntilReset === 1 ? "يوم" : "يوماً"} من آخر إلغاء.`
                : isWarning
                  ? `إلغاء حجزين إضافيين قبل أقل من ساعتين من الرحلة سيؤدي إلى تعليق الحجز مؤقتاً. النقاط تُحذف تلقائياً بعد ${WINDOW_DAYS} يوماً من آخر إلغاء متأخر.`
                  : `استمر في إلغاء الحجوزات قبل أكثر من ساعتين من موعد الرحلة لتحافظ على هذه الحالة.`}
            </p>
          </div>
        </div>

        {/* Visual strike "pips" — 3 dots that fill in red as strikes accumulate.
            Concrete progress visual is more memorable than just a number. */}
        {!isBlocked && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-current/10">
            <span className="text-xs text-muted-foreground shrink-0">النقاط:</span>
            <div className="flex gap-1.5">
              {Array.from({ length: STRIKE_THRESHOLD }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full ${
                    i < effectiveStrikes
                      ? "bg-destructive"
                      : "bg-muted border border-border"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground mr-auto">
              {effectiveStrikes} من {STRIKE_THRESHOLD}
            </span>
          </div>
        )}
      </div>

      {/* Lifetime stats */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <h4 className="text-sm font-bold text-foreground mb-3">إجمالي الإلغاءات</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/40 rounded-xl p-3">
            <p className="text-xl font-bold text-foreground">{lifetimeCancels}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">جميع الإلغاءات</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-3">
            <p className="text-xl font-bold text-amber-600">{lifetimeLate}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">إلغاءات متأخرة</p>
          </div>
        </div>
        {lastCancelledAt && (
          <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            آخر إلغاء: {new Date(lastCancelledAt).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        )}
      </div>

      {/* Educational panel — helps users understand the rules instead of
          discovering them after losing access. */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
        <h4 className="text-sm font-bold text-primary mb-2 flex items-center gap-1.5">
          <Info className="w-4 h-4" />
          كيف يعمل النظام؟
        </h4>
        <ul className="space-y-1.5 text-xs text-foreground/80 leading-relaxed">
          <li>• الإلغاء قبل أكثر من ساعتين من موعد الرحلة لا يضيف أي نقطة سلبية.</li>
          <li>• الإلغاء قبل أقل من ساعتين من الرحلة يضيف <strong>نقطة سلبية واحدة</strong>.</li>
          <li>• تراكم <strong>{STRIKE_THRESHOLD} نقاط</strong> خلال {WINDOW_DAYS} يوماً يعلّق الحجز مؤقتاً.</li>
          <li>• النقاط تُحذف تلقائياً بعد {WINDOW_DAYS} يوماً من آخر إلغاء متأخر.</li>
          <li>• هذا النظام موجود لحماية السائقين من إلغاءات اللحظة الأخيرة المتكررة.</li>
        </ul>
      </div>
    </div>
  );
}
