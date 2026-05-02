import React, { useState } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Star, ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { toast } from "sonner";

function StarPicker({ value, onChange }) {
  return (
    <div className="flex gap-1 justify-center">
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => onChange(n)} className="p-1 transition-transform active:scale-90">
          <Star className={`w-9 h-9 ${n <= value ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
        </button>
      ))}
    </div>
  );
}

const RATING_LABELS = { 0:"اختر تقييماً", 1:"سيء جداً 😞", 2:"سيء 😕", 3:"مقبول 😐", 4:"جيد 😊", 5:"ممتاز! 🌟" };

export default function PassengerReviewWizard({ trip, driverEmail, driverName, passengerUser, onClose }) {
  const [step, setStep] = useState(1); // 1=arrived? 2=stars 3=review 4=confirm 5=done
  const [arrived, setArrived] = useState(true);
  const [rating, setRating] = useState(5);
  const [publicReview, setPublicReview] = useState("");
  const [privateMsg, setPrivateMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const TOTAL = 4;
  const progress = ((step - 1) / TOTAL) * 100;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await base44.entities.Review.create({
        trip_id: trip.id,
        reviewer_name: passengerUser?.full_name || "راكب",
        reviewer_email: passengerUser?.email,
        driver_email: driverEmail,
        rated_user_email: driverEmail,
        review_type: "passenger_rates_driver",
        reviewer_role: "passenger",
        rating,
        comment: publicReview,
        public_review: publicReview,
        private_message: privateMsg,
        is_anonymous: false,
      });

      // Notify driver
      if (publicReview) {
        await base44.entities.Notification.create({
          user_email: driverEmail,
          title: `تقييم جديد من ${passengerUser?.full_name || "راكب"} ⭐`,
          message: `حصلت على ${rating} نجوم للرحلة من ${trip.from_city} إلى ${trip.to_city}${publicReview ? `: "${publicReview}"` : ""}`,
          type: "system", trip_id: trip.id, is_read: false,
        });
      }
      if (privateMsg) {
        await base44.entities.Notification.create({
          user_email: driverEmail,
          title: "رسالة خاصة من راكب 📩",
          message: privateMsg,
          type: "system", trip_id: trip.id, is_read: false,
        });
      }
      setStep(5);
    } catch {
      toast.error("حدث خطأ أثناء الإرسال");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end sm:items-center justify-center" dir="rtl">
      <div className="bg-background w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden" style={{ maxHeight: "90vh" }}>

        {step < 5 && (
          <div className="h-1 bg-muted">
            <div className="h-1 bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        )}
        {step < 5 && (
          <button onClick={onClose} className="absolute top-4 left-4 p-2 rounded-full hover:bg-muted z-10">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}

        <div className="p-6 overflow-y-auto" style={{ maxHeight: "85vh" }}>

          {/* Step 1: Did you arrive? */}
          {step === 1 && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">الخطوة 1 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">هل وصلت بسلامة؟</h2>
              <p className="text-sm text-muted-foreground mb-8">
                رحلتك من <strong>{trip.from_city}</strong> إلى <strong>{trip.to_city}</strong> مع {driverName} اكتملت
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setArrived(true)}
                  className={`flex-1 py-4 rounded-2xl text-sm font-medium transition-colors ${arrived ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}
                >
                  ✅ نعم، وصلت
                </button>
                <button
                  onClick={() => setArrived(false)}
                  className={`flex-1 py-4 rounded-2xl text-sm font-medium transition-colors ${!arrived ? "bg-destructive text-white" : "bg-muted text-muted-foreground"}`}
                >
                  ❌ لا، واجهت مشكلة
                </button>
              </div>
              {!arrived && (
                <p className="text-xs text-muted-foreground mt-4">يمكنك التواصل مع الإدارة عبر الإعدادات لرفع شكوى</p>
              )}
            </div>
          )}

          {/* Step 2: Rate driver */}
          {step === 2 && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">الخطوة 2 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">قيّم السائق</h2>
              <p className="text-sm text-muted-foreground mb-2">تقييمك سيظهر على ملف {driverName} العام</p>
              <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-2xl mx-auto mb-5">
                {driverName?.[0]?.toUpperCase()}
              </div>
              <StarPicker value={rating} onChange={setRating} />
              <p className="text-muted-foreground text-sm mt-3">{RATING_LABELS[rating]}</p>
            </div>
          )}

          {/* Step 3: Written review */}
          {step === 3 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">الخطوة 3 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">اكتب تقييماً للسائق</h2>
              <p className="text-sm text-muted-foreground mb-5">تقييمك العام سيظهر على ملف {driverName} للجميع</p>
              <div className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-2 mb-4">
                <span className="text-sm font-medium text-foreground">{driverName}</span>
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                  <span className="font-bold text-sm">{rating}</span>
                </div>
              </div>
              <textarea
                value={publicReview}
                onChange={e => setPublicReview(e.target.value)}
                placeholder={`صف تجربتك مع ${driverName}... (سيظهر على ملفه العام)`}
                rows={4}
                className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring mb-4"
              />
              <p className="text-xs font-medium text-muted-foreground mb-2">رسالة خاصة (اختياري — فقط {driverName} سيراها)</p>
              <textarea
                value={privateMsg}
                onChange={e => setPrivateMsg(e.target.value)}
                placeholder="رسالة خاصة للسائق..."
                rows={2}
                className="w-full rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 4 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">الخطوة 4 من {TOTAL}</p>
              <h2 className="text-xl font-bold text-foreground mb-1">تأكيد تقييمك</h2>
              <p className="text-sm text-destructive mb-5 font-medium">⚠️ التقييم نهائي ولا يمكن تعديله بعد النشر</p>
              <div className="bg-muted/40 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">{driverName?.[0]?.toUpperCase()}</div>
                    <span className="font-medium">{driverName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    <span className="font-bold">{rating}</span>
                  </div>
                </div>
                {publicReview && <p className="text-sm text-muted-foreground border-t border-border pt-2">"{publicReview}"</p>}
              </div>
            </div>
          )}

          {/* Step 5: Thank you */}
          {step === 5 && (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">🙌</div>
              <h2 className="text-2xl font-bold text-foreground mb-2">شكراً لك!</h2>
              <p className="text-muted-foreground mb-6">تقييمك يساعد في بناء مجتمع مِشوارو ويجعل التنقل أفضل في فلسطين</p>
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 mb-6">
                <p className="text-sm text-primary font-medium">💚 شارك مِشوارو مع أصدقائك</p>
                <p className="text-xs text-muted-foreground mt-1">كل مشارك يقوّي شبكة التنقل الفلسطينية</p>
              </div>
              <Button onClick={onClose} className="w-full rounded-xl bg-primary text-primary-foreground">
                العودة للرئيسية
              </Button>
            </div>
          )}

          {/* Navigation */}
          {step < 5 && (
            <div className="flex gap-3 mt-6">
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 rounded-xl gap-2">
                  <ChevronRight className="w-4 h-4" /> السابق
                </Button>
              )}
              {step < 4 && (
                <Button
                  onClick={() => setStep(s => s + 1)}
                  disabled={step === 2 && rating === 0}
                  className="flex-1 rounded-xl gap-2 bg-primary text-primary-foreground"
                >
                  التالي <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              {step === 4 && (
                <Button onClick={handleSubmit} disabled={submitting} className="flex-1 rounded-xl gap-2 bg-primary text-primary-foreground">
                  <Check className="w-4 h-4" />
                  {submitting ? "جاري النشر..." : "تأكيد ونشر التقييم"}
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
