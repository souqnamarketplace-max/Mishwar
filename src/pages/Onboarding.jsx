import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Car, Users, CheckCircle, ArrowLeft, ArrowRight, Phone, MapPin, User, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

const CITIES = ["رام الله", "نابلس", "الخليل", "بيت لحم", "غزة", "جنين", "طولكرم", "قلقيلية"];

const STEPS_PASSENGER = ["اختيار الدور", "معلوماتك"];
const STEPS_DRIVER = ["اختيار الدور", "معلوماتك", "بيانات السيارة"];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [accountType, setAccountType] = useState(null); // "passenger" | "driver" | "both"
  const [form, setForm] = useState({ phone: "", city: "", bio: "", car_model: "", car_year: "", car_color: "", car_plate: "" });
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  const save = useMutation({
    mutationFn: () =>
      base44.auth.updateMe({
        account_type: accountType,
        phone: form.phone,
        city: form.city,
        bio: form.bio,
        avatar_url: avatarUrl,
        ...(accountType !== "passenger" ? {
          car_model: form.car_model,
          car_year: form.car_year,
          car_color: form.car_color,
          car_plate: form.car_plate,
        } : {}),
        onboarding_completed: true,
      }),
    onSuccess: () => {
      toast.success("مرحباً بك في سيرتنا! 🎉");
      navigate(accountType === "driver" || accountType === "both" ? "/driver" : "/");
    },
  });

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setAvatarUrl(file_url);
    setUploading(false);
  };

  const isDriver = accountType === "driver" || accountType === "both";
  const steps = isDriver ? STEPS_DRIVER : STEPS_PASSENGER;
  const totalSteps = steps.length;

  const canNext = () => {
    if (step === 0) return !!accountType;
    if (step === 1) return !!form.phone && !!form.city;
    if (step === 2) return !!form.car_model && !!form.car_plate;
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
          <h1 className="text-2xl font-bold text-foreground">مرحباً في سيرتنا</h1>
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
                <h2 className="text-lg font-bold text-foreground mb-2">كيف ستستخدم سيرتنا؟</h2>
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
                      ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
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
                    <label className="text-sm font-medium mb-1 block">رقم الهاتف *</label>
                    <div className="relative">
                      <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        placeholder="05xxxxxxxx"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className="pr-10 rounded-xl"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">مدينتك *</label>
                    <div className="relative">
                      <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <select
                        value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                        className="w-full h-10 pr-10 pl-3 rounded-xl border border-input bg-background text-sm"
                      >
                        <option value="">اختر مدينتك</option>
                        {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
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
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1 block">موديل السيارة *</label>
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
                      <label className="text-sm font-medium mb-1 block">رقم اللوحة *</label>
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
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex justify-between mt-5 gap-3">
          {step > 0 && (
            <Button variant="outline" className="rounded-xl gap-2" onClick={() => setStep(step - 1)}>
              <ArrowRight className="w-4 h-4" />
              السابق
            </Button>
          )}
          <Button
            className="flex-1 bg-primary text-primary-foreground rounded-xl gap-2"
            disabled={!canNext() || save.isPending}
            onClick={() => {
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