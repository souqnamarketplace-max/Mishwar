import React, { useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { notifyAdmin } from "@/lib/notifyAdmin";
import { logAudit } from "@/lib/adminAudit";
import { toast } from "sonner";

/**
 * SuggestCityModal — shown when a user types a city that isn't in the
 * autocomplete and they tap "اقتراح إضافة [name]".
 *
 * Two stages:
 *   1. Form: user can refine the spelling, optionally add a landmark/notes
 *      to help the admin identify the place.
 *   2. Success: a thank-you screen confirming the suggestion was sent.
 *
 * Calls the suggest_city RPC (migration 015) which:
 *   - Returns the existing suggestion id if this name is already pending
 *     (and bumps duplicate_count internally) — user gets the same "thanks!"
 *     experience either way, but the admin queue stays clean.
 *   - Returns NULL if this name already exists in admin_cities — we then
 *     show a different success-ish state pointing them back to the
 *     autocomplete.
 *   - Throws if the input is empty or too long — UI toast handles it.
 *
 * Rendered via createPortal so it escapes any parent transform stacking
 * context (the existing pattern across this codebase).
 */
export default function SuggestCityModal({ initialName, onClose }) {
  const [name, setName]   = useState(initialName || "");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState("form"); // "form" | "success" | "already_exists"
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error("يرجى كتابة اسم القرية أو المدينة");
      return;
    }
    if (cleanName.length > 100) {
      toast.error("الاسم طويل جداً (الحد الأقصى 100 حرف)");
      return;
    }
    setSubmitting(true);

    // ── Phase 1: AUTHORITATIVE — the suggest_city RPC.
    // RPC has built-in idempotency (dedupes by name, returns existing
    // id and bumps duplicate_count) so retries on transient failures
    // are safe. Errors here surface to the user.
    let data;
    try {
      const result = await supabase.rpc("suggest_city", {
        p_name: cleanName,
        p_notes: notes.trim() || null,
      });
      if (result.error) throw result.error;
      data = result.data;
    } catch (err) {
      const msg = err?.message || "فشل إرسال الطلب";
      // Most likely cause: user is not authenticated. Be specific.
      if (/permission|policy|denied|jwt/i.test(msg)) {
        toast.error("يرجى تسجيل الدخول لاقتراح إضافة مدينة جديدة");
      } else {
        toast.error(msg);
      }
      setSubmitting(false);
      return;
    }

    // RPC returns NULL if the city already exists in admin_cities.
    if (data === null) {
      setStage("already_exists");
      setSubmitting(false);
      return;
    }

    // ── Phase 2: BEST-EFFORT side-effects. Suggestion is saved; do
    //    not let admin-notification / audit failures surface a
    //    misleading "failed" toast (this is the same defect we fixed
    //    in PassengerReviewWizard, DriverReviewWizard, and Feedback —
    //    when best-effort calls are awaited inside the same try as
    //    the authoritative write, their failure looks like total
    //    failure to the user).
    notifyAdmin({
      title: "🗺️ اقتراح مدينة جديدة",
      message: `اقترح مستخدم إضافة "${cleanName}"${notes.trim() ? ` — ${notes.trim().slice(0, 120)}` : ""}`,
      link: "/dashboard?tab=cities",
    }).catch(() => { /* non-fatal — suggestion is already saved */ });

    try {
      // Audit log — city suggestions were unaudited. The
      // city_suggestion_approved / _rejected events were logged
      // when admin acted on them (DashboardCities.jsx), but the
      // initial submission wasn't, leaving a gap from 'user
      // suggested X' to 'admin approved X'. Now the trail is
      // continuous.
      logAudit("city_suggested", "city_suggestion", data?.id || null, {
        city_name: cleanName,
        has_notes: !!notes.trim(),
      });
    } catch { /* non-fatal */ }

    setStage("success");
    setSubmitting(false);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-card rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === "form" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-primary" />
                </div>
                <h3 className="font-bold text-lg">اقتراح إضافة مدينة</h3>
              </div>
              <button
                onClick={onClose}
                className="p-1 hover:bg-muted rounded-lg"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              لم نجد المدينة أو القرية في القائمة. أرسل اقتراحاً وستراجع الإدارة الطلب
              وتضيفها قريباً مع موقعها على الخريطة.
            </p>

            <label className="block mb-3">
              <span className="text-xs text-muted-foreground mb-1 block">
                اسم المدينة أو القرية *
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="مثال: قرية ميثلون"
                className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary"
                autoFocus
              />
            </label>

            <label className="block mb-4">
              <span className="text-xs text-muted-foreground mb-1 block">
                ملاحظة للإدارة (اختياري)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="مثلاً: بجانب رام الله، شرق طريق نابلس، أقرب نقطة معروفة..."
                className="w-full bg-muted/40 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary resize-none"
              />
              <span className="text-[10px] text-muted-foreground mt-1 block">
                هذا يساعد الإدارة على تحديد موقعها بدقة على الخريطة
              </span>
            </label>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 rounded-xl"
              >
                إلغاء
              </Button>
              <Button
                onClick={submit}
                disabled={submitting || !name.trim()}
                className="flex-1 bg-primary text-primary-foreground rounded-xl"
              >
                {submitting ? "جاري الإرسال..." : "إرسال الاقتراح"}
              </Button>
            </div>
          </>
        )}

        {stage === "success" && (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-green-500/10 mx-auto mb-3 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <h3 className="font-bold text-lg mb-1">تم إرسال اقتراحك ✓</h3>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              ستراجع الإدارة طلب إضافة <span className="font-bold text-foreground">"{name.trim()}"</span> وتضيفها مع موقعها على الخريطة قريباً. شكراً لمساعدتنا!
            </p>
            <Button onClick={onClose} className="w-full rounded-xl">
              حسناً
            </Button>
          </div>
        )}

        {stage === "already_exists" && (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-blue-500/10 mx-auto mb-3 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-blue-600" />
            </div>
            <h3 className="font-bold text-lg mb-1">هذه المدينة موجودة بالفعل</h3>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              يبدو أن <span className="font-bold text-foreground">"{name.trim()}"</span> موجودة في القائمة. حاول البحث مرة أخرى — قد تكون الكتابة مختلفة قليلاً.
            </p>
            <Button onClick={onClose} className="w-full rounded-xl">
              حسناً
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
