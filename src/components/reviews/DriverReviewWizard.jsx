import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { notifyUser } from "@/lib/notifyUser";
import { Button } from "@/components/ui/button";
import { Star, ChevronLeft, ChevronRight, Check, X, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { logAudit } from "@/lib/adminAudit";

// ── Star picker ───────────────────────────────────────────────────────────────
function StarPicker({ value, onChange }) {
  return (
    <div className="flex gap-1 justify-center">
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => onChange(n)} className="p-1 transition-transform active:scale-90">
          <Star className={`w-8 h-8 ${n <= value ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
        </button>
      ))}
    </div>
  );
}

const RATING_LABELS = { 0:"اختر تقييماً", 1:"سيء جداً 😞", 2:"سيء 😕", 3:"مقبول 😐", 4:"جيد 😊", 5:"ممتاز! 🌟" };

// ── Main Wizard ───────────────────────────────────────────────────────────────
export default function DriverReviewWizard({ trip, passengers, driverUser, onClose }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1); // 1=showup 2=stars 3=review 4=confirm 5=done
  const [submitting, setSubmitting] = useState(false);

  // Per-passenger state
  const [data, setData] = useState(() =>
    passengers.map(p => ({
      email: p.passenger_email,
      name: p.passenger_name || p.passenger_email?.split("@")[0] || "راكب",
      showed_up: true,
      rating: 5,
      public_review: "",
      private_message: "",
    }))
  );

  const update = (idx, field, val) =>
    setData(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));

  const handleSubmit = async () => {
    setSubmitting(true);
    // ── Phase 1: AUTHORITATIVE — booking.no_show flag + review row
    //    per passenger. allSettled so a single passenger failing
    //    doesn't block the others. Collect per-passenger results
    //    so we can give the driver an accurate toast if some
    //    rows failed.
    //
    //    Previously this whole block was a single Promise.all
    //    wrapping booking-update + review-create + 2 awaited
    //    notifyUser calls. ANY notifyUser rejection (RLS edge
    //    case, network blip on the notifications path) failed the
    //    whole batch — driver saw 'تعذر إرسال التقييم' and
    //    retried, creating DUPLICATE reviews for every passenger
    //    whose rows were already saved before the failing one.
    const writeResults = await Promise.allSettled(
      data.map(async (p) => {
        // 1a. Mark no_show on booking (authoritative for both
        //     showed-up and didn't-show paths)
        const { error: bErr } = await supabase
          .from("bookings")
          .update({ no_show: !p.showed_up })
          .eq("trip_id", trip.id)
          .eq("passenger_email", p.email);
        if (bErr) throw bErr;

        // 1b. Create review record (only if they showed up)
        if (p.showed_up) {
          await api.entities.Review.create({
            trip_id: trip.id,
            reviewer_name: driverUser?.full_name || "سائق",
            reviewer_email: driverUser?.email,
            driver_email: driverUser?.email,
            rated_user_email: p.email,
            review_type: "driver_rates_passenger",
            reviewer_role: "driver",
            rating: p.rating,
            comment: p.public_review,
            public_review: p.public_review,
            private_message: p.private_message,
            is_anonymous: true,
          });
        }
        return p;
      })
    );

    const succeeded = writeResults
      .map((r, i) => (r.status === "fulfilled" ? data[i] : null))
      .filter(Boolean);
    const failedCount = writeResults.length - succeeded.length;

    if (succeeded.length === 0) {
      // Nothing got saved — first failure surfaces as the toast.
      const firstReason = writeResults.find(r => r.status === "rejected")?.reason;
      toast.error(friendlyError(firstReason, "تعذر إرسال التقييم"));
      setSubmitting(false);
      return;
    }

    // ── Phase 2: BEST-EFFORT side-effects. Notifications + audit
    //    for every passenger whose DB write succeeded. Each call
    //    has its own .catch — one failure doesn't block any other.
    //    The success transition does NOT depend on these — driver
    //    sees step=5 even if every notification fails.
    const sideEffects = [];
    for (const p of succeeded) {
      if (p.showed_up) {
        if (p.public_review) {
          sideEffects.push(
            notifyUser({
              user_email: p.email,
              title: "تقييم جديد على ملفك ⭐",
              message: `كتب السائق تقييماً عن رحلتك من ${trip.from_city} إلى ${trip.to_city}`,
              type: "system",
              trip_id: trip.id,
              link: "/my-trips?tab=completed",
            }).catch(() => { /* non-fatal */ })
          );
        }
        if (p.private_message) {
          sideEffects.push(
            notifyUser({
              user_email: p.email,
              title: "رسالة خاصة من السائق 📩",
              message: p.private_message,
              type: "system",
              trip_id: trip.id,
              link: "/notifications",
            }).catch(() => { /* non-fatal */ })
          );
        }
      }
      // Audit log — one row per passenger rated, showed-up or not.
      try {
        logAudit("driver_review_submitted", "review", trip.id, {
          driver_email:    driverUser?.email,
          passenger_email: p.email,
          trip_id:         trip.id,
          rating:          p.showed_up ? p.rating : null,
          no_show:         !p.showed_up,
          has_public_text: !!p.public_review,
          has_private_msg: !!p.private_message,
        });
      } catch { /* non-fatal */ }
    }
    // Don't block the success transition on the side-effects.
    Promise.allSettled(sideEffects);

    if (failedCount > 0) {
      toast.warning(`تم حفظ ${succeeded.length} من ${data.length} تقييمات. حاول مجدداً لاحقاً للباقي.`);
    }
    setStep(5);
    setSubmitting(false);
  };

  const TOTAL = 4;
  const progress = ((step - 1) / TOTAL) * 100;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end sm:items-center justify-center" dir="rtl">
      <div className="bg-background w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden" style={{ maxHeight: "90vh" }}>

        {/* Progress bar */}
        {step < 5 && (
          <div className="h-1 bg-muted">
            <div className="h-1 bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Close button */}
        {step < 5 && (
          <button onClick={onClose} className="absolute top-4 left-4 p-2 rounded-full hover:bg-muted z-10" aria-label="إغلاق نموذج التقييم">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}

        <div className="p-6 overflow-y-auto" style={{ maxHeight: "85vh" }}>

          {/* ── Step 1: Show up? ── */}
          {step === 1 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">الخطوة 1 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">هل حضر الركاب؟</h2>
              <p className="text-sm text-muted-foreground mb-6">إذا لم يحضر الراكب، سيتم تسجيل ذلك وسيعلم المجتمع</p>
              <div className="space-y-3">
                {data.map((p, i) => (
                  <div key={p.email} className="flex items-center justify-between bg-muted/40 rounded-2xl px-4 py-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                      {p.name?.[0]?.toUpperCase()}
                    </div>
                    <span className="font-medium text-foreground flex-1 mx-3">{p.name}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => update(i, "showed_up", true)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${p.showed_up ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}
                      >
                        <UserCheck className="w-3.5 h-3.5" /> حضر
                      </button>
                      <button
                        onClick={() => update(i, "showed_up", false)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${!p.showed_up ? "bg-destructive text-white" : "bg-muted text-muted-foreground"}`}
                      >
                        <UserX className="w-3.5 h-3.5" /> لم يحضر
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Anonymous stars ── */}
          {step === 2 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">الخطوة 2 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">قيّم كل راكب</h2>
              <p className="text-sm text-muted-foreground mb-6">تقييمك مجهول — لن يعرف الراكب من قيّمه، فقط متوسط نجومه</p>
              <div className="space-y-5">
                {data.filter(p => p.showed_up).map((p, idx) => {
                  const i = data.findIndex(d => d.email === p.email);
                  return (
                    <div key={p.email} className="bg-muted/40 rounded-2xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">{p.name?.[0]?.toUpperCase()}</div>
                        <span className="font-medium text-foreground">{p.name}</span>
                      </div>
                      <StarPicker value={p.rating} onChange={v => update(i, "rating", v)} />
                      <p className="text-center text-sm text-muted-foreground mt-2">{RATING_LABELS[p.rating]}</p>
                    </div>
                  );
                })}
                {data.filter(p => !p.showed_up).length > 0 && (
                  <p className="text-xs text-muted-foreground text-center">الركاب الذين لم يحضروا لن يحتاجون تقييماً</p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Public review + private message ── */}
          {step === 3 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">الخطوة 3 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">اكتب تقييماً عاماً</h2>
              <p className="text-sm text-muted-foreground mb-6">التقييم العام سيظهر على ملف الراكب للجميع</p>
              <div className="space-y-5">
                {data.filter(p => p.showed_up).map((p) => {
                  const i = data.findIndex(d => d.email === p.email);
                  return (
                    <div key={p.email} className="bg-muted/40 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">{p.name?.[0]?.toUpperCase()}</div>
                          <span className="font-medium text-sm text-foreground">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                          <span className="font-bold text-sm">{p.rating}</span>
                        </div>
                      </div>
                      <textarea
                        value={p.public_review}
                        onChange={e => update(i, "public_review", e.target.value)}
                        placeholder={`صف تجربتك مع ${p.name} (سيظهر على ملفه العام)`}
                        rows={3}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">رسالة خاصة (اختياري — فقط {p.name} سيراها)</p>
                        <textarea
                          value={p.private_message}
                          onChange={e => update(i, "private_message", e.target.value)}
                          placeholder="رسالة خاصة..."
                          rows={2}
                          className="w-full rounded-xl border border-dashed border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 4: Confirm ── */}
          {step === 4 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">الخطوة 4 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">تأكيد التقييمات</h2>
              <p className="text-sm text-destructive mb-6 font-medium">⚠️ التقييمات نهائية ولا يمكن تعديلها بعد النشر</p>
              <div className="space-y-3">
                {data.map(p => (
                  <div key={p.email} className="bg-muted/40 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">{p.name?.[0]?.toUpperCase()}</div>
                      <div>
                        <p className="font-medium text-sm text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.showed_up ? "حضر ✓" : "لم يحضر ✗"}</p>
                      </div>
                    </div>
                    {p.showed_up && (
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        <span className="font-bold">{p.rating}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 5: Thank you ── */}
          {step === 5 && (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">🙌</div>
              <h2 className="text-2xl font-bold text-foreground mb-2">شكراً لك!</h2>
              <p className="text-muted-foreground mb-6">تقييماتك تساعد في بناء مجتمع مشواروو وتجعل التجربة أفضل للجميع</p>
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 mb-6">
                <p className="text-sm text-primary font-medium">💚 شارك مشواروو مع أصدقائك في فلسطين</p>
                <p className="text-xs text-muted-foreground mt-1">كل مشارك يساعد في نمو شبكة التنقل الفلسطينية</p>
              </div>
              <Button onClick={onClose} className="w-full rounded-xl bg-primary text-primary-foreground">
                العودة للرئيسية
              </Button>
            </div>
          )}

          {/* ── Navigation ── */}
          {step < 5 && (
            <div className="flex gap-3 mt-6">
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 rounded-xl gap-2">
                  <ChevronRight className="w-4 h-4" /> السابق
                </Button>
              )}
              {step < 4 && (
                <Button onClick={() => setStep(s => s + 1)} className="flex-1 rounded-xl gap-2 bg-primary text-primary-foreground">
                  التالي <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              {step === 4 && (
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 rounded-xl gap-2 bg-primary text-primary-foreground"
                >
                  <Check className="w-4 h-4" />
                  {submitting ? "جاري النشر..." : "تأكيد ونشر التقييمات"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
