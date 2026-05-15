/**
 * BecomeDriver — 5-step wizard for the passenger → driver upgrade.
 *
 * Replaces the previous flow where a passenger had to:
 *   1. Navigate to /settings
 *   2. Scroll past 8 unrelated sections to find the upgrade card
 *   3. Click "تفعيل حساب السائق الآن" — page reloads (jarring 800ms)
 *   4. Scroll down to the now-visible 10-field driver license form
 *   5. Fill 10 fields all at once + submit
 *
 * The new flow:
 *   - One linear wizard at /become-driver
 *   - 5 focused screens, each with 2-4 fields max
 *   - Per-step validation (can't advance until current step complete)
 *   - One submit at the end does account_type→both AND license-row write
 *   - Resumes from any partial DriverLicense row (status: incomplete)
 *   - No window.location.reload — React Query invalidation only
 *
 * All 9 fields preserved verbatim from the old flow:
 *   license_number, expiry_date, car_registration_expiry_date,
 *   insurance_expiry_date, license_image_url, car_registration_url,
 *   insurance_url, selfie_1_url, selfie_2_url
 */
import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, Image as ImageIcon, Upload, AlertCircle, Sparkles, Car, Shield, IdCard, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DateInput from "@/components/shared/DateInput";
import { useSEO } from "@/hooks/useSEO";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { useAuth } from "@/lib/AuthContext";
import { compressImage } from "@/lib/compressImage";
import { resolveDocumentUrl, isPublicHttpUrl } from "@/lib/licenseUrls";

// Hook that resolves a stored document value to a renderable URL for
// in-form previews. After migration moved sensitive uploads from the
// public bucket to uploads-private, the stored value is now a path
// (e.g. "<uid>/<timestamp>-<rand>.jpg") rather than a public URL.
// resolveDocumentUrl signs the path via the storage API for ~60 seconds.
// Legacy rows where the column still holds a full https://... URL pass
// through unchanged via the isPublicHttpUrl branch inside the helper.
function usePreviewUrl(stored) {
  const [url, setUrl] = useState(() => (isPublicHttpUrl(stored) ? stored : null));
  useEffect(() => {
    if (!stored) { setUrl(null); return; }
    if (isPublicHttpUrl(stored)) { setUrl(stored); return; }
    let cancelled = false;
    resolveDocumentUrl(stored).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [stored]);
  return url;
}

const STEPS = [
  { id: 0, title: "البداية",         icon: Sparkles },
  { id: 1, title: "رخصة القيادة",   icon: IdCard },
  { id: 2, title: "وثائق المركبة",  icon: Car },
  { id: 3, title: "صور الهوية",     icon: Shield },
  { id: 4, title: "المراجعة",        icon: Check },
];

const TODAY_ISO = () => new Date().toISOString().split("T")[0];

export default function BecomeDriver() {
  useSEO({ title: "كن سائقاً في مشوارو", description: "تفعيل حساب السائق في 5 خطوات سهلة" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, refreshUser } = useAuth();

  // Already a driver? Send them home — there's nothing to do here.
  // Mid-verification (status: incomplete/pending) drivers can stay
  // and continue editing.
  useEffect(() => {
    if (user?.account_type === "driver" || user?.account_type === "both") {
      // Allow them to view if they have a rejected license (re-submission)
      // but otherwise redirect to dashboard
    }
  }, [user, navigate]);

  // Pull existing license row so we can resume from a previous attempt.
  const { data: licenses = [] } = useQuery({
    queryKey: ["driver-license", user?.email],
    queryFn: () => user?.email
      ? api.entities.DriverLicense.filter({ driver_email: user.email }, "-created_date", 1)
      : [],
    enabled: !!user?.email,
  });
  const existingLicense = licenses[0] || null;

  // Form state — initialized from existing license if any
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Per-field uploading state — keys are field names. Multiple uploads
  // can run concurrently without one blocking the others. The previous
  // single boolean made every UploadField look 'uploading' as soon as
  // any one of them started, and disabled their tap targets — users
  // had to upload docs strictly sequentially even though Supabase
  // can handle parallel uploads to UUID-prefixed paths just fine.
  const [uploadingMap, setUploadingMap] = useState({});
  const [form, setForm] = useState({
    license_number: "",
    expiry_date: "",
    car_registration_expiry_date: "",
    insurance_expiry_date: "",
    license_image_url: "",
    car_registration_url: "",
    insurance_url: "",
    selfie_1_url: "",
    selfie_2_url: "",
  });

  // Hydrate form from server state once it arrives
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (existingLicense && !hydrated) {
      setForm({
        license_number: existingLicense.license_number || "",
        expiry_date: existingLicense.expiry_date || "",
        car_registration_expiry_date: existingLicense.car_registration_expiry_date || "",
        insurance_expiry_date: existingLicense.insurance_expiry_date || "",
        license_image_url: existingLicense.license_image_url || "",
        car_registration_url: existingLicense.car_registration_url || "",
        insurance_url: existingLicense.insurance_url || "",
        selfie_1_url: existingLicense.selfie_1_url || "",
        selfie_2_url: existingLicense.selfie_2_url || "",
      });
      setHydrated(true);
    }
  }, [existingLicense, hydrated]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── File upload helper ────────────────────────────────────────────────────
  // Per-field uploading state lets multiple uploads run concurrently.
  // We compress images client-side before upload (canvas API, no extra
  // dep) so an 8 MB phone-camera photo becomes ~500 KB before it goes
  // over the wire — typical 10× speedup on mobile networks. PDFs pass
  // through uncompressed.
  const setFieldUploading = (key, isUploading) => {
    setUploadingMap((prev) => {
      const next = { ...prev };
      if (isUploading) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  const uploadFile = async (file, fieldKey, label) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { toast.error("حجم الملف يجب أن يكون أقل من 12 MB"); return; }
    if (!file.type.startsWith("image/") && !file.type.includes("pdf")) {
      toast.error("يرجى رفع صورة أو ملف PDF فقط"); return;
    }
    setFieldUploading(fieldKey, true);
    try {
      // Compress images before upload — drops a typical phone-camera
      // shot from ~6-8 MB down to ~500 KB. PDFs pass through.
      const compressed = await compressImage(file).catch(() => file);

      const ext = (compressed.name || file.name).split(".").pop();
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      // Upload to the PRIVATE bucket. Driver license, car registration,
      // insurance documents, and selfies are identity-grade PII — license
      // numbers, ID photos, addresses. Previously these went to 'uploads'
      // (the public-read bucket) and the column stored the full publicUrl,
      // which meant anyone with the URL — admins reviewing a license,
      // support staff with screenshots, anyone who later got hold of an
      // audit log entry — had permanent unauthenticated read access to
      // the document. The private bucket gates reads through createSignedUrl
      // (60s TTL) plus the owner-or-admin RLS policy from migration 004.
      const { error: upErr } = await supabase.storage
        .from("uploads-private")
        .upload(path, compressed, { upsert: true });
      if (upErr) throw upErr;
      // Store the PATH (not a publicUrl). Display sites — the admin
      // license review modal, the AccountSettings driver-license card,
      // anything else that renders these — already use resolveDocumentUrl
      // (src/lib/licenseUrls.js) which signs paths transparently and
      // continues to handle legacy public-URL values for older rows.
      set(fieldKey, path);
      toast.success(`✅ تم رفع ${label}`);
    } catch (err) {
      toast.error(`خطأ في رفع ${label}: ${friendlyError(err, "حاول مجدداً")}`);
    } finally {
      setFieldUploading(fieldKey, false);
    }
  };

  // True if ANY field is currently uploading — used only for the
  // wizard-level "next/submit" buttons so the user can't advance
  // mid-upload (and lose progress to a step-change unmount).
  const anyUploading = Object.keys(uploadingMap).length > 0;

  // ── Per-step validation ────────────────────────────────────────────────────
  // Past-date guard helper — input min={today} blocks the picker but
  // not typed values. We re-check at step-validation time so a typed-in
  // expired date can't pass the wizard.
  const dateOK = (d) => !!d && d >= TODAY_ISO();

  const stepValid = (s) => {
    switch (s) {
      case 0: return true; // intro is always valid
      case 1: return !!(form.license_number && dateOK(form.expiry_date) && form.license_image_url);
      case 2: return !!(dateOK(form.car_registration_expiry_date) && form.car_registration_url
                     && dateOK(form.insurance_expiry_date) && form.insurance_url);
      case 3: return !!(form.selfie_1_url && form.selfie_2_url);
      case 4: return [1,2,3].every(stepValid);
      default: return false;
    }
  };

  const canAdvance = stepValid(step);

  // ── Final submit: account_type flip + license create/update + status=pending
  const submit = async () => {
    if (!stepValid(4)) {
      toast.error("يرجى ملء جميع البيانات قبل الإرسال");
      return;
    }
    setSubmitting(true);
    try {
      const licensePayload = {
        ...form,
        status: "pending",
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
      };

      // 1) Write/update the driver_license row
      if (existingLicense) {
        await api.entities.DriverLicense.update(existingLicense.id, licensePayload);
      } else {
        await api.entities.DriverLicense.create({
          driver_email: user.email,
          driver_name: user.full_name,
          ...licensePayload,
        });
      }

      // 2) Promote account_type → "both" (or leave as "driver" if already)
      const targetType = user.account_type === "driver" ? "driver" : "both";
      if (user.account_type !== targetType) {
        await api.auth.updateMe({ account_type: targetType });
      }

      // 3) Invalidate queries so home page / navbar / hub all reflect the
      //    new state without a hard reload
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["driver-license", user.email] });
      if (typeof refreshUser === "function") {
        await refreshUser();
      }

      toast.success("🎉 تم إرسال طلبك! ستصلك إشعار خلال 1-3 أيام عمل");
      navigate("/account-settings/profile#license", { replace: true });
    } catch (err) {
      toast.error(friendlyError(err, "فشل الإرسال. حاول مجدداً"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center" dir="rtl">
        <p className="text-muted-foreground">يرجى تسجيل الدخول للمتابعة</p>
      </div>
    );
  }

  // If license already approved, send them away — they're done
  if (existingLicense?.status === "approved") {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">تم توثيق حسابك ✓</h2>
        <p className="text-sm text-muted-foreground mb-6">يمكنك الآن نشر الرحلات.</p>
        <Link to="/create-trip" className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm">
          أنشر رحلتك الأولى
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
      {/* Back link */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </button>

      {/* Step indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="font-bold text-foreground">خطوة {step + 1} من {STEPS.length}</span>
          <span className="text-muted-foreground">{STEPS[step].title}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        {/* Step pills (clickable for completed steps) */}
        <div className="flex items-center gap-1.5 mt-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isComplete = i < step || (i > 0 && stepValid(i));
            const isActive = i === step;
            return (
              <button
                key={s.id}
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
                className={`flex-1 h-8 rounded-lg flex items-center justify-center transition-colors text-xs ${
                  isActive ? "bg-primary text-primary-foreground"
                  : isComplete ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="bg-card rounded-2xl border border-border p-5 sm:p-6"
        >
          {step === 0 && <StepIntro existingLicense={existingLicense} />}
          {step === 1 && <StepLicense form={form} set={set} uploadFile={uploadFile} uploadingMap={uploadingMap} />}
          {step === 2 && <StepVehicle form={form} set={set} uploadFile={uploadFile} uploadingMap={uploadingMap} />}
          {step === 3 && <StepIdentity form={form} set={set} uploadFile={uploadFile} uploadingMap={uploadingMap} />}
          {step === 4 && <StepReview form={form} />}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3 mt-5">
        <Button
          variant="outline"
          onClick={() => step === 0 ? navigate(-1) : setStep(step - 1)}
          className="rounded-xl gap-1"
          disabled={submitting}
        >
          <ChevronRight className="w-4 h-4" />
          {step === 0 ? "إلغاء" : "السابق"}
        </Button>

        {step < STEPS.length - 1 ? (
          <Button
            onClick={() => canAdvance && setStep(step + 1)}
            disabled={!canAdvance || anyUploading}
            className="rounded-xl gap-1 flex-1 sm:flex-initial"
          >
            {step === 0 ? "ابدأ" : "التالي"}
            <ChevronLeft className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            onClick={submit}
            disabled={!canAdvance || submitting || anyUploading}
            className="rounded-xl gap-2 flex-1 sm:flex-initial bg-primary"
          >
            {submitting ? "جاري الإرسال..." : <><Check className="w-4 h-4" />إرسال للمراجعة</>}
          </Button>
        )}
      </div>

      {existingLicense?.status === "rejected" && existingLicense?.rejection_reason && (
        <div className="mt-5 bg-destructive/5 border border-destructive/20 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">تم رفض طلبك السابق</p>
              <p className="text-xs text-muted-foreground mt-1">السبب: {existingLicense.rejection_reason}</p>
              <p className="text-xs text-muted-foreground mt-1">يرجى تصحيح المشكلة وإعادة الإرسال.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

function StepIntro({ existingLicense }) {
  return (
    <div className="text-center py-4">
      <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-4 text-4xl">
        🚗
      </div>
      <h2 className="text-2xl font-black text-foreground mb-2">كن سائقاً في مشوارو</h2>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed max-w-md mx-auto">
        التحقق من الوثائق يستغرق 3-5 دقائق فقط. سنحتاج صور رخصتك ومستندات سيارتك وسيلفي للهوية.
      </p>

      <div className="bg-muted/30 rounded-xl p-4 text-right space-y-3 max-w-md mx-auto">
        <Benefit text="انشر رحلاتك بين المدن الفلسطينية" />
        <Benefit text="اربح دخلاً إضافياً من المقاعد الفارغة في طريقك اليومي" />
        <Benefit text="تحكم كامل بالسعر، عدد المقاعد، وأسلوب الدفع" />
        <Benefit text="إلغاء مجاني، حماية كاملة، وتقييمات حقيقية" />
      </div>

      {existingLicense?.status === "incomplete" && (
        <div className="mt-5 bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-300">
          📋 سنكمل من حيث توقفت — تم استرجاع بياناتك السابقة
        </div>
      )}
      {existingLicense?.status === "pending" && (
        <div className="mt-5 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-700 dark:text-yellow-300">
          ⏳ طلبك السابق قيد المراجعة — يمكنك تعديل البيانات هنا إذا كنت تريد
        </div>
      )}
    </div>
  );
}

function Benefit({ text }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-primary mt-0.5">✓</span>
      <span className="text-sm text-foreground/80 flex-1">{text}</span>
    </div>
  );
}

// ── STEP 1: License (3 fields) ────────────────────────────────────────────────
function StepLicense({ form, set, uploadFile, uploadingMap }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-foreground mb-1">رخصة القيادة</h2>
      <p className="text-xs text-muted-foreground mb-5">أدخل بيانات الرخصة وارفع صورة واضحة لها</p>

      <div className="space-y-4">
        <div>
          <Label className="text-sm">رقم الرخصة <span className="text-destructive">*</span></Label>
          <Input
            value={form.license_number}
            onChange={(e) => set("license_number", e.target.value)}
            placeholder="مثال: 123456789"
            className="rounded-xl h-11 mt-1.5"
          />
        </div>

        <div>
          <Label className="text-sm">تاريخ انتهاء الرخصة <span className="text-destructive">*</span></Label>
          <DateInput
            value={form.expiry_date}
            onChange={(e) => set("expiry_date", e.target.value)}
            min={TODAY_ISO()}
            className="rounded-xl h-11 mt-1.5"
          />
        </div>

        <UploadField
          label="صورة الرخصة (الجهة الأمامية)"
          value={form.license_image_url}
          onUpload={(file) => uploadFile(file, "license_image_url", "صورة الرخصة")}
          uploading={!!uploadingMap.license_image_url}
          fieldId="license-img"
        />
      </div>
    </div>
  );
}

// ── STEP 2: Vehicle (4 fields) ───────────────────────────────────────────────
function StepVehicle({ form, set, uploadFile, uploadingMap }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-foreground mb-1">وثائق المركبة</h2>
      <p className="text-xs text-muted-foreground mb-5">تسجيل المركبة والتأمين الساري</p>

      <div className="space-y-5">
        <div className="space-y-3 pb-5 border-b border-border">
          <p className="font-bold text-sm text-foreground flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">1</span>
            تسجيل المركبة
          </p>
          <div>
            <Label className="text-xs text-muted-foreground">تاريخ انتهاء التسجيل <span className="text-destructive">*</span></Label>
            <DateInput
              value={form.car_registration_expiry_date}
              onChange={(e) => set("car_registration_expiry_date", e.target.value)}
              min={TODAY_ISO()}
              className="rounded-xl h-11 mt-1"
            />
          </div>
          <UploadField
            label="صورة تسجيل المركبة"
            value={form.car_registration_url}
            onUpload={(file) => uploadFile(file, "car_registration_url", "تسجيل المركبة")}
            uploading={!!uploadingMap.car_registration_url}
            fieldId="reg-img"
          />
        </div>

        <div className="space-y-3">
          <p className="font-bold text-sm text-foreground flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">2</span>
            التأمين
          </p>
          <div>
            <Label className="text-xs text-muted-foreground">تاريخ انتهاء التأمين <span className="text-destructive">*</span></Label>
            <DateInput
              value={form.insurance_expiry_date}
              onChange={(e) => set("insurance_expiry_date", e.target.value)}
              min={TODAY_ISO()}
              className="rounded-xl h-11 mt-1"
            />
          </div>
          <UploadField
            label="صورة التأمين"
            value={form.insurance_url}
            onUpload={(file) => uploadFile(file, "insurance_url", "التأمين")}
            uploading={!!uploadingMap.insurance_url}
            fieldId="ins-img"
          />
        </div>
      </div>
    </div>
  );
}

// ── STEP 3: Identity (2 selfies) ─────────────────────────────────────────────
function StepIdentity({ form, set, uploadFile, uploadingMap }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-foreground mb-1">صور الهوية</h2>
      <p className="text-xs text-muted-foreground mb-5">للتحقق من أن الحساب لك أنت — لن نشاركها مع أحد</p>

      <div className="space-y-5">
        <UploadField
          label="سيلفي مع الهوية (وجهك ظاهر مع بطاقة الهوية بجانبه)"
          value={form.selfie_1_url}
          onUpload={(file) => uploadFile(file, "selfie_1_url", "سيلفي الهوية")}
          uploading={!!uploadingMap.selfie_1_url}
          fieldId="selfie1"
          hint="تأكد أن الوجه والبطاقة كلاهما واضحان في نفس الصورة"
        />
        <UploadField
          label="سيلفي إضافي (الوجه واضحاً، بدون نظارة شمسية أو قبعة)"
          value={form.selfie_2_url}
          onUpload={(file) => uploadFile(file, "selfie_2_url", "السيلفي الإضافي")}
          uploading={!!uploadingMap.selfie_2_url}
          fieldId="selfie2"
        />
      </div>

      <div className="mt-5 bg-muted/30 rounded-xl p-3 text-xs text-muted-foreground">
        🔒 صورك محفوظة بشكل آمن ولا تُعرض إلا للمراجع المختص. بعد القبول، تبقى مشفّرة.
      </div>
    </div>
  );
}

// ── STEP 4: Review ───────────────────────────────────────────────────────────
function StepReview({ form }) {
  const items = [
    { label: "رقم الرخصة", value: form.license_number },
    { label: "تاريخ انتهاء الرخصة", value: form.expiry_date },
    { label: "تاريخ انتهاء تسجيل المركبة", value: form.car_registration_expiry_date },
    { label: "تاريخ انتهاء التأمين", value: form.insurance_expiry_date },
  ];
  const docs = [
    { label: "صورة الرخصة", url: form.license_image_url },
    { label: "تسجيل المركبة", url: form.car_registration_url },
    { label: "التأمين", url: form.insurance_url },
    { label: "سيلفي مع الهوية", url: form.selfie_1_url },
    { label: "سيلفي إضافي", url: form.selfie_2_url },
  ];
  return (
    <div>
      <h2 className="text-xl font-bold text-foreground mb-1">المراجعة النهائية</h2>
      <p className="text-xs text-muted-foreground mb-5">تأكد من المعلومات قبل الإرسال</p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <span className="text-xs text-muted-foreground">{it.label}</span>
              <span className="text-sm font-medium">{it.value || "—"}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {docs.map((d) => (
            <DocPreviewTile key={d.label} label={d.label} stored={d.url} />
          ))}
        </div>

        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-900 dark:text-yellow-200">
          ⏳ بعد الإرسال، سيراجع فريقنا وثائقك خلال <strong>1-3 أيام عمل</strong>. ستصلك إشعار بالقبول أو طلب توضيح.
        </div>
      </div>
    </div>
  );
}

// ── Document preview tile for the final review step ────────────────────────
// Uses the same path-or-URL resolution as UploadField so the review grid
// works regardless of whether the stored value is a private-bucket path
// (post-migration uploads) or a legacy public URL (pre-migration uploads).
function DocPreviewTile({ label, stored }) {
  const url = usePreviewUrl(stored);
  return (
    <div className="text-center">
      <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-1 flex items-center justify-center">
        {url
          ? <img src={url} alt={label} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          : stored
            ? <div className="w-full h-full bg-muted flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
              </div>
            : <ImageIcon className="w-6 h-6 text-muted-foreground/40" />}
      </div>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      {stored && <Check className="w-3 h-3 text-primary mx-auto mt-0.5" />}
    </div>
  );
}

// ── Reusable upload field with thumbnail preview ────────────────────────────
function UploadField({ label, value, onUpload, uploading, fieldId, hint }) {
  // value is a stored path or legacy URL — resolve to a signed URL for the
  // preview img. Reverts to null while resolving (or on resolve failure),
  // matching the "no value yet" branch below.
  const previewUrl = usePreviewUrl(value);
  return (
    <div>
      <Label className="text-sm">{label} <span className="text-destructive">*</span></Label>
      {hint && <p className="text-[11px] text-muted-foreground mt-1 mb-1.5">{hint}</p>}
      <input
        id={fieldId}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => onUpload(e.target.files?.[0])}
        disabled={uploading}
      />
      {value ? (
        <div className="mt-1.5 flex items-center gap-3 p-2 bg-green-500/5 border border-green-500/20 rounded-xl">
          {previewUrl
            ? <img src={previewUrl} alt="" className="w-14 h-14 rounded-lg object-cover" loading="lazy" decoding="async" />
            : <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
              </div>}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> تم الرفع
            </p>
            <button
              onClick={() => document.getElementById(fieldId).click()}
              disabled={uploading}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              {uploading ? "جاري الرفع..." : "تغيير الصورة"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => document.getElementById(fieldId).click()}
          disabled={uploading}
          className={`w-full mt-1.5 border-2 border-dashed rounded-xl py-6 text-center transition-colors disabled:opacity-60 ${
            uploading
              ? "border-primary/40 bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          {uploading ? (
            <>
              <div className="w-5 h-5 mx-auto mb-1 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-primary font-medium">جاري الرفع...</p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">قد يستغرق بضع ثوانٍ</p>
            </>
          ) : (
            <>
              <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
              <p className="text-sm text-muted-foreground">اضغط لرفع صورة</p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">صورة أو PDF — حتى 12 ميجابايت</p>
            </>
          )}
        </button>
      )}
    </div>
  );
}
