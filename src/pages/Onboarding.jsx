import { CITIES } from "@/lib/cities";
import { CAR_BRANDS } from "@/lib/carModels";
import { captureException } from "@/lib/sentry";
import { todayISO } from "@/lib/validation";
import CityAutocomplete from "@/components/shared/CityAutocomplete";
import DateInput from "@/components/shared/DateInput";
import { useSEO } from "@/hooks/useSEO";
import { friendlyError } from "@/lib/errors";
import { readSessionUserId } from "@/lib/session";
import React, { useState } from "react";
import { api } from "@/api/apiClient";
import { notifyAdmin } from "@/lib/notifyAdmin";
import { logAudit } from "@/lib/adminAudit";
import { supabase } from "@/lib/supabase";
import DriverPaymentSetupInline from "@/components/driver/DriverPaymentSetup";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient} from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidPalestinianPhone, validatePhone } from "@/lib/validation";
import { Car, Users, CheckCircle, ArrowLeft, ArrowRight, Phone, MapPin, User, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

const STEPS_PASSENGER = ["اختيار الدور", "معلوماتك"];
const STEPS_DRIVER = ["اختيار الدور", "معلوماتك", "بيانات السيارة", "رخصة القيادة"];


// Upload helper. Two buckets used:
//   - 'uploads'         (public-read) for AVATARS only — they're shown to
//                        other users in profile cards, message threads,
//                        notification rows. Public URL caches forever in
//                        the browser/CDN, no per-view signing roundtrip.
//   - 'uploads-private' (owner-or-admin via RLS) for IDENTITY DOCUMENTS —
//                        driver license, car registration, insurance,
//                        selfies. Stored as a path; display sites resolve
//                        via createSignedUrl (60s TTL) through the
//                        licenseUrls.js helper.
//
// Returns a publicUrl string for the public bucket and a path string for
// the private bucket. Callers should treat both as opaque and store as-is.
// Display sites that need to render either kind use resolveDocumentUrl
// (src/lib/licenseUrls.js) which detects http URLs and passes them through
// while signing private paths.
// File-type validation helper. `accept="image/*"` is a UX hint that
// browsers (especially Android WebView / Capacitor) sometimes ignore.
// This server-of-truth check rejects non-image MIME types before we
// even hit Supabase storage. Used by every upload handler in this
// component.
//
// imageOnly=true → image/* only (avatars, selfies)
// imageOnly=false → image/* + application/pdf (license docs)
function isAllowedUpload(file, { imageOnly }) {
  if (!file?.type) return false;
  if (file.type.startsWith("image/")) return true;
  if (!imageOnly && file.type === "application/pdf") return true;
  return false;
}

async function uploadToSupabase(file, { bucket = 'uploads' } = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id || readSessionUserId();
  if (!userId) throw new Error("يجب تسجيل الدخول لرفع الملفات");

  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  if (bucket === 'uploads') {
    // Avatar path — return the public URL so existing display sites
    // (UserProfile, MessageBubble, etc.) work without changes.
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
  }
  // Private bucket — return the path. Stored verbatim in DB; resolved on
  // display via licenseUrls.resolveDocumentUrl.
  return path;
}

export default function Onboarding() {
  const qc = useQueryClient();
  useSEO({ title: "إعداد الحساب", description: "أكمل إعداد حسابك في مشوارو" });

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(0);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [accountType, setAccountType] = useState(null); // "passenger" | "driver" | "both"
  const [customCarModel, setCustomCarModel] = useState(false); // Toggle for custom car model input
  const [form, setForm] = useState({ 
    phone: "", 
    city: "", 
    bio: "",
    gender: "", // Required for all users at step 1
    car_model: "", 
    car_year: "", 
    car_color: "", 
    car_plate: "",
    license_number: "",
    license_expiry: "",
    license_image_url: "",
    // Car registration
    car_reg_expiry: "",
    car_reg_url: "",
    // Insurance
    insurance_expiry: "",
    insurance_url: "",
    // Identity selfie
    selfie_url: "",
  });
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.auth.me(),
  });

  const save = useMutation({
    mutationFn: async () => {
      // Validate driver-specific fields BEFORE any DB writes. The
      // previous order had auth.updateMe (with onboarding_completed:
      // true) running first, then the license fields validation. If
      // the validation threw, the user was left with onboarding_
      // completed=true but no license entry — App.jsx's onboarding
      // redirect would no longer bounce them here, so they'd land on
      // /settings as a half-set-up driver with no license submission.
      // Resubmitting the form redoes updateMe (idempotent) so it
      // worked in practice, but the half-baked state surfaced for
      // anyone who closed the tab between the two writes.
      // Documents are optional. No pre-validation needed here — the
      // post-updateMe block validates if the user partially filled docs.

      await api.auth.updateMe({
        // Always send account_type from local state — the React Query
        // cache for 'user' can be stale at mutation time (especially on
        // first registration), causing account_type to be skipped.
        // The guard_profile_protected_columns trigger allows changes
        // while onboarding_completed=false (mig 132).
        account_type: accountType,
        phone: form.phone,
        city: form.city,
        bio: form.bio,
        avatar_url: avatarUrl,
        gender: form.gender,
        ...(accountType !== "passenger" ? {
          car_model: form.car_model,
          car_year: form.car_year,
          car_color: form.car_color,
          car_plate: form.car_plate,
        } : {}),
        onboarding_completed: true,
      });

      if (accountType === "driver" || accountType === "both") {
        // Documents are always optional — drivers who upload go through
        // admin verification and get the موثّق badge. Drivers who skip
        // join unverified and can upload later from /settings.
        const hasAnyDoc = form.license_number || form.license_image_url || form.selfie_url;
        if (hasAnyDoc) {
          // Partial or full submission — require the minimum (license number + image)
          if (!form.license_number || !form.license_expiry || !form.license_image_url) {
            throw new Error("إذا أردت التحقق، يرجى ملء رقم الرخصة وتاريخ الانتهاء وصورتها على الأقل");
          }
          const { data: authData } = await supabase.auth.getSession();
          const { error: licError } = await supabase.from("driver_licenses").insert({
            user_id:                      user?.id,
            driver_email:                 user?.email,
            driver_name:                  user?.full_name,
            license_number:               form.license_number,
            expiry_date:                  form.license_expiry,
            license_image_url:            form.license_image_url,
            car_registration_expiry_date: form.car_reg_expiry   || null,
            car_registration_url:         form.car_reg_url      || null,
            insurance_expiry_date:        form.insurance_expiry || null,
            insurance_url:                form.insurance_url    || null,
            selfie_1_url:                 form.selfie_url       || null,
            selfie_2_url:                 null,
            status:                       "pending",
            submitted_at:                 new Date().toISOString(),
            created_by:                   user?.email,
          });
          if (licError) throw new Error(licError.message);
          await notifyAdmin({
            title: "🪪 طلب تحقق من رخصة قيادة",
            message: `${user?.full_name || user?.email} قدّم طلب للتحقق من رخصة القيادة`,
            link: "/dashboard?tab=licenses",
          });
        }
        // If nothing uploaded — driver joins as unverified, no license record created.
        // They can upload later from /settings.
      }
    },
    onSuccess: async () => {
      // CRITICAL: refresh AuthContext BEFORE navigating, otherwise the redirect guard
      // in App.jsx still sees onboarding_completed=false and bounces back here (loop bug)
      await refreshUser();

      // Audit log — onboarding completion is the canonical
      // "user joined the platform with a chosen role" event. Captures
      // account_type (passenger / driver / both) so admins can answer
      // "how many drivers signed up this week" without joining
      // multiple tables. Done before navigate so the audit row is
      // committed even if navigation fails for any reason.
      logAudit("onboarding_completed", "user", user?.id || null, {
        user_email: user?.email,
        account_type: accountType,
        has_license: accountType === "driver" || accountType === "both",
      });

      // Honor ?returnTo so users routed here by the onboarding gate
      // (useOnboardingGate, e.g. from Book / Send Message / Post Trip)
      // land back on the page they were trying to act on. Path-safety
      // check: only allow same-origin paths starting with / and not //
      // (same pattern as Login.jsx ~L125-127). Strip the param before
      // navigating so the URL bar doesn't carry it through.
      const rawReturn = searchParams.get("returnTo");
      const safeReturn = rawReturn && rawReturn.startsWith("/") && !rawReturn.startsWith("//")
        ? rawReturn
        : null;

      const isDriver = accountType === "driver" || accountType === "both";
      if (isDriver) {
        const didSubmitDocs = form.license_number && form.license_image_url;
        if (didSubmitDocs) {
          toast.success("مرحباً بك في مشوارو! 🎉 وثائقك قيد المراجعة — ستصلك إشعار عند الاعتماد");
        } else {
          toast.success("مرحباً بك في مشوارو! 🎉 يمكنك رفع وثائق التحقق لاحقاً من الإعدادات");
        }
        navigate(safeReturn || "/", { replace: true });
      } else {
        toast.success("مرحباً بك في مشوارو! 🎉");
        navigate(safeReturn || "/", { replace: true });
      }
    },
    onError: (err) => {
      toast.error(friendlyError(err, "حدث خطأ في الإعداد"));
    },
  });

  // Delete account mutation for users who don't want to complete onboarding
  // Apple 5.1.1 compliance - must allow account deletion without barriers
  const deleteAccount = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_account");
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حذف حسابك بنجاح");
      // Sign out and redirect to home
      await supabase.auth.signOut();
      navigate("/", { replace: true });
    },
    onError: (err) => {
      toast.error(friendlyError(err, "فشل حذف الحساب"));
    },
  });

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // MIME check — accept='image/*' is advisory; some Android WebViews
    // and screen-reader pickers ignore it. Reject non-images here so
    // we don't end up storing PDFs as avatars (or worse).
    if (!isAllowedUpload(file, { imageOnly: true })) {
      toast.error("يجب رفع صورة بصيغة JPG / PNG / WebP");
      return;
    }
    if (file.size > 5 * 1024 * 1024) { toast.error("حجم الصورة يجب أن يكون أقل من 5 MB"); return; }
    setUploading(true);
    try {
      const file_url = await uploadToSupabase(file);
      setAvatarUrl(file_url);
      toast.success("تم رفع الصورة بنجاح ✅");
    } catch (err) {
      captureException(err, { msg: "Avatar upload error:" });
      toast.error(friendlyError(err, "تعذر رفع الصورة — تحقق من الاتصال"));
    } finally {
      setUploading(false);
    }
  };

  const isDriver = accountType === "driver" || accountType === "both";
  // Documents step is always shown for drivers but always optional.
  // Drivers who upload get verified (admin reviews); those who skip join unverified.
  const STEPS_DRIVER_FULL = ["اختيار الدور", "معلوماتك", "بيانات السيارة", "وثائق التحقق (اختياري)"];
  const steps = isDriver ? STEPS_DRIVER_FULL : STEPS_PASSENGER;
  const totalSteps = steps.length;

  const canNext = () => true;

  const validateStep = () => {
    if (step === 0 && !accountType) { toast.error("يرجى اختيار نوع الحساب ⚠️"); return false; }
    if (step === 1) {
      const phoneCheck = validatePhone(form.phone);
      if (phoneCheck.reason) { toast.error(phoneCheck.reason); return false; }
      if (!form.city)   { toast.error("يرجى اختيار مدينتك ⚠️"); return false; }
      // Gender — required for ALL users (moved from driver-only step 2
      // so Google-OAuth passengers also land with their gender set).
      if (!form.gender) { toast.error("يرجى اختيار الجنس ⚠️"); return false; }
    }
    if (step === 2 && isDriver) {
      if (!form.car_model) { toast.error("يرجى إدخال موديل السيارة ⚠️"); return false; }
      if (!form.car_year) { toast.error("يرجى إدخال سنة الصنع ⚠️"); return false; }
      // Validate car year is numeric and reasonable
      const yearNum = parseInt(form.car_year);
      const currentYear = new Date().getFullYear();
      if (isNaN(yearNum) || yearNum < 1950 || yearNum > currentYear) {
        toast.error(`سنة الصنع يجب أن تكون بين 1950 و ${currentYear} ⚠️`);
        return false;
      }
      if (!form.car_color) { toast.error("يرجى إدخال لون السيارة ⚠️"); return false; }
      if (!form.car_plate) { toast.error("يرجى إدخال رقم اللوحة ⚠️"); return false; }
    }
    if (step === 3 && isDriver) {
      // Docs step is optional — only validate if user started filling it
      const hasAnyDoc = form.license_number || form.license_image_url || form.selfie_url;
      if (hasAnyDoc) {
        if (!form.license_number) { toast.error("يرجى إدخال رقم الرخصة ⚠️"); return false; }
        if (!/^[a-zA-Z0-9\s\-]+$/.test(form.license_number)) {
          toast.error("رقم الرخصة يجب أن يحتوي على أحرف وأرقام فقط ⚠️");
          return false;
        }
        if (!form.license_expiry) { toast.error("يرجى تحديد تاريخ انتهاء الرخصة ⚠️"); return false; }
        if (!form.license_image_url) { toast.error("يرجى رفع صورة الرخصة ⚠️"); return false; }
      }
    }
    return true;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-3">
            <img src="/logo.png" alt="مشوارو" className="w-12 h-12 rounded-xl object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">مرحباً في مشوارو</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {user?.full_name ? `أهلاً ${user.full_name}،` : ""} لنكمل إعداد حسابك
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-2">
          {steps.map((label, i) => (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i < step ? "bg-accent text-accent-foreground" :
                  i === step ? "bg-primary text-primary-foreground" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
                </div>
                <span className="text-[10px] text-muted-foreground hidden sm:block">{label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 rounded ${i < step ? "bg-accent" : "bg-muted"}`} />
              )}
            </React.Fragment>
          ))}
        </div>
        {/* Mobile: show only the active step's label so the user knows
            where they are without crowding the bar with all labels. */}
        <p className="sm:hidden text-center text-xs text-muted-foreground mb-6">
          خطوة {step + 1} من {steps.length}: {steps[step]}
        </p>
        <div className="hidden sm:block mb-6" />

        <AnimatePresence mode="wait">
          {/* Step 0: Choose role */}
          {step === 0 && (
            <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="bg-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-bold text-foreground mb-2">كيف ستستخدم مشوارو؟</h2>
                <p className="text-sm text-muted-foreground mb-6">يمكنك الاختيار كراكب أو سائق أو كليهما</p>
                <div className="space-y-3">
                  {[
                    { id: "passenger", icon: Users, title: "راكب فقط", desc: "أبحث عن رحلات وأحجز مقاعد" },
                    { id: "driver", icon: Car, title: "سائق فقط", desc: "أنشر رحلاتي وأوصل الركاب" },
                    { id: "both", icon: CheckCircle, title: "راكب وسائق", desc: "أستخدم المنصة بكلا الطريقتين" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setAccountType(opt.id)}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-right transition-all ${
                        accountType === opt.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40 hover:bg-muted/30"
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                        accountType === opt.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}>
                        <opt.icon className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-bold text-foreground">{opt.title}</p>
                        <p className="text-sm text-muted-foreground">{opt.desc}</p>
                      </div>
                      {accountType === opt.id && (
                        <CheckCircle className="w-5 h-5 text-primary mr-auto shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 1: Personal info */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="bg-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-bold text-foreground mb-2">معلوماتك الشخصية</h2>
                <p className="text-sm text-muted-foreground mb-6">هذه المعلومات تساعد الآخرين على التعرف عليك</p>

                {/* Avatar */}
                <div className="flex items-center gap-4 mb-5">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 border-2 border-primary/20">
                    {avatarUrl
                      ? <img loading="lazy" src={avatarUrl} alt="" className="w-full h-full object-cover" />
                      : <User className="w-7 h-7 text-primary" />}
                  </div>
                  <div>
                    <label className="cursor-pointer">
                      <span className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                        <Upload className="w-3.5 h-3.5" />
                        {uploading ? "جاري الرفع..." : "رفع صورة شخصية"}
                      </span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                    </label>
                    <p className="text-xs text-muted-foreground mt-0.5">اختياري — يعزز الثقة</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">رقم الهاتف <span className="text-destructive">*</span></label>
                    <div className="relative">
                      <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        placeholder="059XXXXXXX أو +970591234567"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className="pr-10 rounded-xl"
                        dir="ltr"
                      />
                    </div>
                    {/* Live phone validation hint — same UX pattern as
                        the signup form. Tells driver exactly what's
                        wrong before they hit "next" instead of after. */}
                    {form.phone ? (() => {
                      const c = validatePhone(form.phone);
                      if (c.reason) {
                        return (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-[9px] font-bold">!</span>
                            {c.reason}
                          </p>
                        );
                      }
                      return (
                        <p className="text-[11px] text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-100 dark:bg-green-900/40 text-[9px] font-bold">✓</span>
                          {c.looksPalestinian ? "رقم فلسطيني صالح" : "رقم دولي صالح"}
                        </p>
                      );
                    })() : (
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        مثل: 0591234567 أو ‎+970 لرقم فلسطيني
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">مدينتك <span className="text-destructive">*</span></label>
                    {/* CityAutocomplete provides BOTH typing (autocomplete
                        against CITIES + map coords + live trip DB via
                        useAllCities) AND picking from the map (showMapButton
                        default true → small map icon in the input opens
                        MapCityPicker as a modal). Matches the pattern used
                        on HeroSection, CreateTrip, PassengerRequests — the
                        onboarding screen was the last hold-out on the
                        map-only MapCityPicker, which forced users with a
                        keyboard preference (drivers entering a familiar
                        small village; users on a slow connection where the
                        map tiles take seconds to load) into a pan-and-zoom
                        gesture they didn't need. The "suggest a city"
                        flow inside CityAutocomplete still handles the
                        long-tail case where a locality isn't in any of
                        the three sources yet. */}
                    <CityAutocomplete
                      value={form.city}
                      onChange={(city) => setForm({ ...form, city })}
                    />
                  </div>
                  {/* Gender — required for ALL users at onboarding (not just
                      drivers as the previous design had it). This solves
                      the Google-OAuth flow: Google no longer exposes gender
                      in OIDC scopes, so passengers signing up via Google
                      end up with gender=NULL forever. By asking once at
                      onboarding, every account is fully populated from day
                      one. The migration 040 set-once trigger still applies
                      — if a user makes a mistake here they have to contact
                      support to change it, which is why the amber warning
                      below tells them so up front. */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">الجنس <span className="text-destructive">*</span></label>
                    <select
                      value={form.gender || ""}
                      onChange={(e) => setForm({ ...form, gender: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm"
                    >
                      <option value="">— اختر الجنس —</option>
                      <option value="male">👨 ذكر</option>
                      <option value="female">👩 أنثى</option>
                    </select>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5">
                      ⚠️ يُحدَّد مرة واحدة فقط — للتغيير لاحقاً تواصل مع الدعم
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">نبذة عنك (اختياري)</label>
                    <textarea
                      placeholder="اكتب شيئاً عن نفسك..."
                      value={form.bio}
                      maxLength={500}
                      onChange={(e) => setForm({ ...form, bio: e.target.value })}
                      rows={2}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    {/* Counter shows once the user starts typing — keeps the
                        field clean when empty (the placeholder is enough).
                        Approaches the cap visually (red text at 90%+) so
                        users know they're running out of room before the
                        input silently rejects their next keystroke. */}
                    {form.bio.length > 0 && (
                      <p className={`text-[10px] mt-0.5 text-left ${form.bio.length > 450 ? "text-destructive" : "text-muted-foreground"}`}>
                        {form.bio.length} / 500
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Car info (driver only) */}
          {step === 2 && isDriver && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="bg-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-bold text-foreground mb-2">بيانات سيارتك</h2>
                <p className="text-sm text-muted-foreground mb-6">هذه المعلومات تظهر للركاب في رحلاتك</p>
                <div className="space-y-4">
                  {/* Gender used to live here but moved to step 1 — every
                      user (passenger or driver) now answers it once during
                      the personal-info step rather than only drivers. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block">موديل السيارة <span className="text-destructive">*</span></label>
                      {!customCarModel ? (
                        <select 
                          value={form.car_model} 
                          onChange={(e) => {
                            if (e.target.value === "غير مدرج (اكتب يدوياً)") {
                              setCustomCarModel(true);
                              setForm({ ...form, car_model: "" });
                            } else {
                              setForm({ ...form, car_model: e.target.value });
                            }
                          }}
                          className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm"
                        >
                          <option value="">اختر الموديل</option>
                          {CAR_BRANDS.map(brand => (
                            <option key={brand} value={brand}>{brand}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="relative">
                          <Input 
                            placeholder="اكتب موديل السيارة" 
                            value={form.car_model} 
                            onChange={(e) => setForm({ ...form, car_model: e.target.value })} 
                            className="rounded-xl" 
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setCustomCarModel(false);
                              setForm({ ...form, car_model: "" });
                            }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-primary hover:underline"
                          >
                            عودة للقائمة
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">سنة الصنع <span className="text-destructive">*</span></label>
                      <Input 
                        type="number" 
                        placeholder="مثال: 2020" 
                        value={form.car_year} 
                        onChange={(e) => setForm({ ...form, car_year: e.target.value })} 
                        className="rounded-xl"
                        min="1950"
                        max={new Date().getFullYear()}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block">لون السيارة <span className="text-destructive">*</span></label>
                      <Input placeholder="مثال: فضي" value={form.car_color} onChange={(e) => setForm({ ...form, car_color: e.target.value })} className="rounded-xl" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">رقم اللوحة <span className="text-destructive">*</span></label>
                      <Input placeholder="مثال: 6-1234-95" value={form.car_plate} onChange={(e) => setForm({ ...form, car_plate: e.target.value })} className="rounded-xl" dir="ltr" />
                    </div>
                  </div>
                </div>

                <div className="mt-5 p-4 bg-accent/10 rounded-xl">
                  <p className="text-sm text-accent font-medium mb-1 flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    كل شيء جاهز!
                  </p>
                  <p className="text-xs text-muted-foreground">بعد الإنشاء يمكنك تحديث بياناتك في أي وقت من لوحة السائق.</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Driver Documents */}
          {step === 3 && isDriver && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-foreground mb-1">وثائق التحقق <span className="text-sm font-normal text-muted-foreground">(اختياري)</span></h2>
                  <p className="text-sm text-muted-foreground">ارفع وثائقك للحصول على شارة <span className="text-primary font-medium">موثّق ✓</span> على ملفك. يمكنك تخطي هذه الخطوة والتوثيق لاحقاً من الإعدادات.</p>
                </div>

                {/* Helper: reusable upload field */}
                {/* ── 1) Driver License ── */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <p className="text-sm font-bold flex items-center gap-2">🪪 رخصة القيادة</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">رقم الرخصة</label>
                      <Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} placeholder="123456789" className="rounded-xl h-10 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">تاريخ الانتهاء</label>
                      <DateInput 
                        value={form.license_expiry} 
                        onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} 
                        min={todayISO()}
                        className="rounded-xl h-10 bg-background border border-input px-3"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">صورة الرخصة</label>
                    <Button
                      variant="outline"
                      className={`rounded-xl gap-2 w-full h-10 text-sm ${form.license_image_url ? "border-green-500 text-green-700 bg-green-50" : ""}`}
                      type="button"
                      disabled={uploading}
                      onClick={() => document.getElementById("upload-license").click()}
                    >
                      <Upload className="w-4 h-4" />
                      {uploading ? "جاري الرفع..." : form.license_image_url ? "✓ تم رفع صورة الرخصة" : "رفع صورة الرخصة"}
                    </Button>
                    <input id="upload-license" type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      if (!isAllowedUpload(file, { imageOnly: false })) { toast.error("يجب رفع صورة JPG / PNG أو ملف PDF"); return; }
                      if (file.size > 5*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 5 MB"); return; }
                      setUploading(true);
                      try { const url = await uploadToSupabase(file, { bucket: 'uploads-private' }); setForm(f => ({ ...f, license_image_url: url })); toast.success("✅ تم رفع صورة الرخصة"); }
                      catch (err) { console.error("License upload error:", err); toast.error("فشل رفع الصورة. حجم الملف يجب أن يكون أقل من 5MB وبصيغة صورة أو PDF"); }
                      finally { setUploading(false); }
                    }} />
                  </div>
                </div>

                {/* ── 2) Car Registration ── */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <p className="text-sm font-bold flex items-center gap-2">🚗 استمارة السيارة</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">تاريخ انتهاء الاستمارة</label>
                    <DateInput 
                      value={form.car_reg_expiry} 
                      onChange={(e) => setForm({ ...form, car_reg_expiry: e.target.value })} 
                      min={todayISO()}
                      className="rounded-xl h-10 bg-background border border-input px-3"
                      placeholder="اختياري"
                    />
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      className={`rounded-xl gap-2 w-full h-10 text-sm ${form.car_reg_url ? "border-green-500 text-green-700 bg-green-50" : ""}`}
                      type="button"
                      disabled={uploading}
                      onClick={() => document.getElementById("upload-car-reg").click()}
                    >
                      <Upload className="w-4 h-4" />
                      {form.car_reg_url ? "✓ تم رفع الاستمارة" : "رفع صورة الاستمارة"}
                    </Button>
                    <input id="upload-car-reg" type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      if (!isAllowedUpload(file, { imageOnly: false })) { toast.error("يجب رفع صورة JPG / PNG أو ملف PDF"); return; }
                      if (file.size > 5*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 5 MB"); return; }
                      setUploading(true);
                      try { const url = await uploadToSupabase(file, { bucket: 'uploads-private' }); setForm(f => ({ ...f, car_reg_url: url })); toast.success("✅ تم رفع الاستمارة"); }
                      catch (err) { toast.error(friendlyError(err, "تعذر رفع الملف")); }
                      finally { setUploading(false); }
                    }} />
                  </div>
                </div>

                {/* ── 3) Insurance ── */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <p className="text-sm font-bold flex items-center gap-2">🛡️ وثيقة التأمين</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">تاريخ انتهاء التأمين</label>
                    <DateInput 
                      value={form.insurance_expiry} 
                      onChange={(e) => setForm({ ...form, insurance_expiry: e.target.value })} 
                      min={todayISO()}
                      className="rounded-xl h-10 bg-background border border-input px-3"
                      placeholder="اختياري"
                    />
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      className={`rounded-xl gap-2 w-full h-10 text-sm ${form.insurance_url ? "border-green-500 text-green-700 bg-green-50" : ""}`}
                      type="button"
                      disabled={uploading}
                      onClick={() => document.getElementById("upload-insurance").click()}
                    >
                      <Upload className="w-4 h-4" />
                      {form.insurance_url ? "✓ تم رفع وثيقة التأمين" : "رفع وثيقة التأمين"}
                    </Button>
                    <input id="upload-insurance" type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      if (!isAllowedUpload(file, { imageOnly: false })) { toast.error("يجب رفع صورة JPG / PNG أو ملف PDF"); return; }
                      if (file.size > 5*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 5 MB"); return; }
                      setUploading(true);
                      try { const url = await uploadToSupabase(file, { bucket: 'uploads-private' }); setForm(f => ({ ...f, insurance_url: url })); toast.success("✅ تم رفع وثيقة التأمين"); }
                      catch (err) { toast.error(friendlyError(err, "تعذر رفع الملف")); }
                      finally { setUploading(false); }
                    }} />
                  </div>
                </div>

                {/* ── 4) Selfie / ID ── */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <p className="text-sm font-bold flex items-center gap-2">🤳 صورة شخصية مع الهوية</p>
                  <p className="text-xs text-muted-foreground">صورة واضحة لوجهك مع إمساك بطاقة هويتك</p>
                  <Button
                    variant="outline"
                    className={`rounded-xl gap-2 w-full h-10 text-sm ${form.selfie_url ? "border-green-500 text-green-700 bg-green-50" : ""}`}
                    type="button"
                    disabled={uploading}
                    onClick={() => document.getElementById("upload-selfie").click()}
                  >
                    <Upload className="w-4 h-4" />
                    {form.selfie_url ? "✓ تم رفع الصورة" : "رفع صورة شخصية مع الهوية"}
                  </Button>
                  <input id="upload-selfie" type="file" accept="image/*" capture="user" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    if (!isAllowedUpload(file, { imageOnly: true })) { toast.error("يجب رفع صورة بصيغة JPG / PNG"); return; }
                    if (file.size > 10*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 10 MB"); return; }
                    setUploading(true);
                    try {
                      const url = await uploadToSupabase(file, { bucket: 'uploads-private' });
                      setForm(f => ({ ...f, selfie_url: url }));
                      toast.success("✅ تم رفع الصورة الشخصية بنجاح");
                    } catch (err) {
                      console.error("Selfie upload error:", err);
                      toast.error("فشل رفع الصورة. تأكد من الاتصال وأن حجم الصورة أقل من 10MB");
                    }
                    finally { setUploading(false); }
                  }} />
                </div>

                {/* Info box — shown after license image is uploaded */}
                {form.license_image_url && (
                  <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
                    <p className="text-sm text-blue-700 font-medium">📋 أكمل الخطوات المتبقية</p>
                    <p className="text-xs text-blue-600 mt-1">بعد إنهاء جميع الخطوات، سيتم إرسال وثائقك للمراجعة خلال 24 ساعة.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

          {/* Step 4: Driver Payment Methods */}
          {step === 4 && isDriver && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-foreground mb-1">طرق استلام المدفوعات 💳</h2>
                  <p className="text-sm text-muted-foreground">أضف معلومات حسابك لاستلام مدفوعات الرحلات من الركاب</p>
                </div>
                <DriverPaymentSetupInline user={user} />
                <div className="p-3 bg-muted/50 rounded-xl">
                  <p className="text-xs text-muted-foreground text-center">
                    يمكنك تخطي هذه الخطوة والإضافة لاحقاً من إعدادات الحساب
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        {/* Navigation — back button is ALWAYS visible. On step 0 it returns to home. */}
        <div className="flex justify-between mt-5 gap-3">
          <Button
            variant="outline"
            className="rounded-xl gap-2 px-4 h-11"
            onClick={() => {
              if (step > 0) {
                setStep(step - 1);
              } else {
                // On the first step, go back to home (lets user abandon onboarding)
                      qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
              }
            }}
            disabled={save.isPending}
          >
            <ArrowRight className="w-4 h-4" />
            {step > 0 ? "السابق" : "الرئيسية"}
          </Button>
          <Button
            className="flex-1 bg-primary text-primary-foreground rounded-xl gap-2 h-11"
            disabled={save.isPending}
            onClick={() => {
              if (!validateStep()) return;
              if (step < totalSteps - 1) {
                setStep(step + 1);
              } else {
                save.mutate();
              }
            }}
          >
            {step < totalSteps - 1 ? (
              <>التالي <ArrowLeft className="w-4 h-4" /></>
            ) : save.isPending ? "جاري الحفظ..." : (
              <>إنهاء الإعداد <CheckCircle className="w-4 h-4" /></>
            )}
          </Button>
        </div>

        {/* Delete Account Option - Apple 5.1.1 Compliance */}
        <div className="mt-6 text-center">
          {!deleteConfirmOpen ? (
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleteAccount.isPending}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors underline disabled:opacity-50"
            >
              لا أرغب في إكمال الإعداد - حذف حسابي
            </button>
          ) : (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-3" dir="rtl">
              <p className="text-sm font-semibold text-destructive">هل أنت متأكد؟</p>
              <p className="text-xs text-muted-foreground">هذا الإجراء نهائي ولا يمكن التراجع عنه.</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                >
                  إلغاء
                </button>
                <button
                  onClick={() => { setDeleteConfirmOpen(false); deleteAccount.mutate(); }}
                  disabled={deleteAccount.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
                >
                  {deleteAccount.isPending ? "جاري الحذف..." : "نعم، احذف حسابي"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}