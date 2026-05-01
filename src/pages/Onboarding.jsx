import { CITIES } from "@/lib/cities";
import { captureException } from "@/lib/sentry";
import MapCityPicker from "@/components/shared/MapCityPicker";
import { useSEO } from "@/hooks/useSEO";
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import DriverPaymentSetupInline from "@/components/driver/DriverPaymentSetup";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidPalestinianPhone } from "@/lib/validation";
import { Car, Users, CheckCircle, ArrowLeft, ArrowRight, Phone, MapPin, User, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

const STEPS_PASSENGER = ["اختيار الدور", "معلوماتك"];
const STEPS_DRIVER = ["اختيار الدور", "معلوماتك", "بيانات السيارة", "رخصة القيادة"];

export default function Onboarding() {
  useSEO({ title: "إعداد الحساب", description: "أكمل إعداد حسابك في مِشوار" });

  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(0);
  const [accountType, setAccountType] = useState(null); // "passenger" | "driver" | "both"
  const [form, setForm] = useState({ 
    phone: "", 
    city: "", 
    bio: "", 
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
    queryFn: () => base44.auth.me(),
  });

  const save = useMutation({
    mutationFn: async () => {
      await base44.auth.updateMe({
        account_type: accountType,
        phone: form.phone,
        city: form.city,
        bio: form.bio,
        avatar_url: avatarUrl,
        ...(accountType !== "passenger" ? {
          gender: form.gender,
          car_model: form.car_model,
          car_year: form.car_year,
          car_color: form.car_color,
          car_plate: form.car_plate,
        } : {}),
        onboarding_completed: true,
      });

      // Create driver license for drivers
      if (accountType === "driver" || accountType === "both") {
        if (!form.license_number || !form.license_expiry || !form.license_image_url) {
          throw new Error("يرجى ملء جميع بيانات رخصة القيادة");
        }
        await base44.entities.DriverLicense.create({
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
          status: "pending",
          submitted_at: new Date().toISOString(),
        });

        // Create notification for admin
        await base44.entities.Notification.create({
          user_email: "souqnamarketplace@gmail.com",
          title: "طلب تحقق من رخصة قيادة جديد",
          message: `${user?.full_name} قدّم طلب للتحقق من رخصة القيادة الخاصة به`,
          type: "system",
          is_read: false,
        });
      }
    },
    onSuccess: async () => {
      // CRITICAL: refresh AuthContext BEFORE navigating, otherwise the redirect guard
      // in App.jsx still sees onboarding_completed=false and bounces back here (loop bug)
      await refreshUser();

      const isDriver = accountType === "driver" || accountType === "both";
      if (isDriver) {
        toast.success("مرحباً بك في مِشوار! 🎉 أكمل رفع وثائقك من الإعدادات لتصبح سائقاً موثقاً");
        navigate("/settings", { replace: true });
      } else {
        toast.success("مرحباً بك في مِشوار! 🎉");
        navigate("/", { replace: true });
      }
    },
    onError: (err) => {
      toast.error(err.message || "حدث خطأ في الإعداد");
    },
  });

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("حجم الصورة يجب أن يكون أقل من 5 MB"); return; }
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setAvatarUrl(file_url);
      toast.success("تم رفع الصورة بنجاح ✅");
    } catch (err) {
      captureException(err, { msg: "Avatar upload error:" });
      toast.error("فشل رفع الصورة. تأكد من الاتصال وحاول مجدداً");
    } finally {
      setUploading(false);
    }
  };

  const isDriver = accountType === "driver" || accountType === "both";
  const steps = isDriver ? STEPS_DRIVER : STEPS_PASSENGER;
  const totalSteps = steps.length;

  const canNext = () => true;

  const validateStep = () => {
    if (step === 0 && !accountType) { toast.error("يرجى اختيار نوع الحساب ⚠️"); return false; }
    if (step === 1) {
      if (!form.phone) { toast.error("يرجى إدخال رقم الهاتف ⚠️"); return false; }
      if (!isValidPalestinianPhone(form.phone)) { toast.error("رقم الهاتف غير صحيح. مثال: 05XXXXXXXX ⚠️"); return false; }
      if (!form.city) { toast.error("يرجى اختيار مدينتك ⚠️"); return false; }
    }
    if (step === 2 && isDriver) {
      if (!form.gender)    { toast.error("يرجى اختيار الجنس ⚠️"); return false; }
      if (!form.car_model) { toast.error("يرجى إدخال موديل السيارة ⚠️"); return false; }
      if (!form.car_plate) { toast.error("يرجى إدخال رقم اللوحة ⚠️"); return false; }
    }
    if (step === 3 && isDriver) {
      if (!form.license_number) { toast.error("يرجى إدخال رقم الرخصة ⚠️"); return false; }
      if (!form.license_expiry) { toast.error("يرجى تحديد تاريخ انتهاء الرخصة ⚠️"); return false; }
      if (!form.license_image_url) { toast.error("يرجى رفع صورة الرخصة ⚠️"); return false; }
    }
    return true;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-3">
            <span className="text-primary-foreground font-bold text-2xl">س</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">مرحباً في مِشوار</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {user?.full_name ? `أهلاً ${user.full_name}،` : ""} لنكمل إعداد حسابك
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
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

        <AnimatePresence mode="wait">
          {/* Step 0: Choose role */}
          {step === 0 && (
            <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="bg-card rounded-2xl border border-border p-6">
                <h2 className="text-lg font-bold text-foreground mb-2">كيف ستستخدم مِشوار؟</h2>
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
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">مدينتك <span className="text-destructive">*</span></label>
                    <MapCityPicker
                      value={form.city}
                      onChange={(city) => setForm({ ...form, city })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">نبذة عنك (اختياري)</label>
                    <textarea
                      placeholder="اكتب شيئاً عن نفسك..."
                      value={form.bio}
                      onChange={(e) => setForm({ ...form, bio: e.target.value })}
                      rows={2}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    />
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
                  <div>
                    <label className="text-sm font-medium mb-1 block">الجنس <span className="text-destructive">*</span></label>
                    <select
                      value={form.gender || ""}
                      onChange={(e) => setForm({ ...form, gender: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm"
                    >
                      <option value="">اختر الجنس</option>
                      <option value="male">👨 رجل</option>
                      <option value="female">👩 امرأة</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block">موديل السيارة <span className="text-destructive">*</span></label>
                      <Input placeholder="مثال: كيا سبورتاج" value={form.car_model} onChange={(e) => setForm({ ...form, car_model: e.target.value })} className="rounded-xl" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">سنة الصنع</label>
                      <Input placeholder="مثال: 2020" value={form.car_year} onChange={(e) => setForm({ ...form, car_year: e.target.value })} className="rounded-xl" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block">لون السيارة</label>
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
                  <h2 className="text-lg font-bold text-foreground mb-1">وثائق السائق</h2>
                  <p className="text-sm text-muted-foreground">ارفع الوثائق المطلوبة للتحقق من هويتك. الحقول المُعلَّمة بـ * إلزامية.</p>
                </div>

                {/* Helper: reusable upload field */}
                {/* ── 1) Driver License ── */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <p className="text-sm font-bold flex items-center gap-2">🪪 رخصة القيادة <span className="text-destructive text-xs">*</span></p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">رقم الرخصة *</label>
                      <Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} placeholder="123456789" className="rounded-xl h-10 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">تاريخ الانتهاء *</label>
                      <Input type="date" value={form.license_expiry} onChange={(e) => setForm({ ...form, license_expiry: e.target.value })} className="rounded-xl h-10 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">صورة الرخصة *</label>
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
                      if (file.size > 5*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 5 MB"); return; }
                      setUploading(true);
                      try { const { file_url } = await base44.integrations.Core.UploadFile({ file }); setForm(f => ({ ...f, license_image_url: file_url })); toast.success("✅ تم رفع صورة الرخصة"); }
                      catch (err) { toast.error("فشل رفع الملف. تأكد من الاتصال وحاول مجدداً"); }
                      finally { setUploading(false); }
                    }} />
                  </div>
                </div>

                {/* ── 2) Car Registration ── */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <p className="text-sm font-bold flex items-center gap-2">🚗 استمارة السيارة</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">تاريخ انتهاء الاستمارة</label>
                    <Input type="date" value={form.car_reg_expiry} onChange={(e) => setForm({ ...form, car_reg_expiry: e.target.value })} className="rounded-xl h-10 text-sm" />
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
                      if (file.size > 5*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 5 MB"); return; }
                      setUploading(true);
                      try { const { file_url } = await base44.integrations.Core.UploadFile({ file }); setForm(f => ({ ...f, car_reg_url: file_url })); toast.success("✅ تم رفع الاستمارة"); }
                      catch (err) { toast.error("فشل رفع الملف"); }
                      finally { setUploading(false); }
                    }} />
                  </div>
                </div>

                {/* ── 3) Insurance ── */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border space-y-3">
                  <p className="text-sm font-bold flex items-center gap-2">🛡️ وثيقة التأمين</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">تاريخ انتهاء التأمين</label>
                    <Input type="date" value={form.insurance_expiry} onChange={(e) => setForm({ ...form, insurance_expiry: e.target.value })} className="rounded-xl h-10 text-sm" />
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
                      if (file.size > 5*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 5 MB"); return; }
                      setUploading(true);
                      try { const { file_url } = await base44.integrations.Core.UploadFile({ file }); setForm(f => ({ ...f, insurance_url: file_url })); toast.success("✅ تم رفع وثيقة التأمين"); }
                      catch (err) { toast.error("فشل رفع الملف"); }
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
                  <input id="upload-selfie" type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    if (file.size > 5*1024*1024) { toast.error("حجم الملف يجب أن يكون أقل من 5 MB"); return; }
                    setUploading(true);
                    try { const { file_url } = await base44.integrations.Core.UploadFile({ file }); setForm(f => ({ ...f, selfie_url: file_url })); toast.success("✅ تم رفع الصورة الشخصية"); }
                    catch (err) { toast.error("فشل رفع الملف"); }
                    finally { setUploading(false); }
                  }} />
                </div>

                {/* Amber warning — only shown after license image is uploaded */}
                {form.license_image_url && (
                  <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                    <p className="text-sm text-yellow-700 font-medium">⏳ في انتظار التحقق</p>
                    <p className="text-xs text-yellow-600 mt-1">سيتم مراجعة وثائقك من قِبل الفريق خلال 24 ساعة. لن تتمكن من نشر رحلات قبل الموافقة.</p>
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
      </div>
    </div>
  );
}