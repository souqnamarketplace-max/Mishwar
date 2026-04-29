import { useSEO } from "@/hooks/useSEO";
import { captureException } from "@/lib/sentry";
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Lock, Mail, Phone, Image, Trash2, AlertCircle, CheckCircle, Shield, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function AccountSettings() {
  useSEO({ title: "الإعدادات", description: "إعدادات حسابك" });

  const { user } = useAuth();
  const qc = useQueryClient();

  // Email
  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  // Password
  const [passwordForm, setPasswordForm] = useState({ current: "", new: "", confirm: "" });
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Phone
  const [phone, setPhone] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);

  // Avatar
  const [avatar, setAvatar] = useState(user?.avatar_url || "");
  const [avatarLoading, setAvatarLoading] = useState(false);

  // Sync form with user data
  // Driver License query
  const { data: license } = useQuery({
    queryKey: ["driver-license", user?.email],
    queryFn: () =>
      user?.email
        ? base44.entities.DriverLicense.filter({ driver_email: user.email }, "-created_date", 1)
        : [],
    enabled: !!user?.email,
  });

  const driverLicense = license?.[0];
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [carRegistrationExpiry, setCarRegistrationExpiry] = useState("");
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
  const [licenseImageUrl, setLicenseImageUrl] = useState("");
  const [carRegistrationUrl, setCarRegistrationUrl] = useState("");
  const [insuranceUrl, setInsuranceUrl] = useState("");
  const [selfie1Url, setSelfie1Url] = useState("");
  const [selfie2Url, setSelfie2Url] = useState("");
  const [licenseLoading, setLicenseLoading] = useState(false);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionLoading, setDeletionLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setEmail(user.email || "");
      setPhone(user.phone || "");
      setAvatar(user.avatar_url || "");
    }
  }, [user]);

  useEffect(() => {
    if (driverLicense) {
      setLicenseNumber(driverLicense.license_number || "");
      setLicenseExpiry(driverLicense.expiry_date || "");
      setCarRegistrationExpiry(driverLicense.car_registration_expiry_date || "");
      setInsuranceExpiry(driverLicense.insurance_expiry_date || "");
      setLicenseImageUrl(driverLicense.license_image_url || "");
      setCarRegistrationUrl(driverLicense.car_registration_url || "");
      setInsuranceUrl(driverLicense.insurance_url || "");
      setSelfie1Url(driverLicense.selfie_1_url || "");
      setSelfie2Url(driverLicense.selfie_2_url || "");
    }
  }, [driverLicense]);

  const updateEmail = async () => {
    if (!email || email === user?.email) {
      toast.error("أدخل بريد إلكتروني جديد");
      return;
    }
    setEmailLoading(true);
    try {
      await base44.auth.updateMe({ email });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تحديث البريد الإلكتروني بنجاح!");
    } catch {
      toast.error("حدث خطأ في تحديث البريد");
    }
    setEmailLoading(false);
  };

  const updatePassword = async () => {
    if (!passwordForm.current || !passwordForm.new || !passwordForm.confirm) {
      toast.error("يرجى ملء جميع الحقول");
      return;
    }
    if (passwordForm.new !== passwordForm.confirm) {
      toast.error("كلمات المرور غير متطابقة");
      return;
    }
    if (passwordForm.new.length < 8) {
      toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    setPasswordLoading(true);
    try {
      // Note: You'll need to implement this in your backend auth service
      await base44.auth.updateMe({ password: passwordForm.new });
      setPasswordForm({ current: "", new: "", confirm: "" });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تغيير كلمة المرور بنجاح!");
    } catch {
      toast.error("خطأ في تغيير كلمة المرور");
    }
    setPasswordLoading(false);
  };

  const updatePhone = async () => {
    if (!phone) {
      toast.error("أدخل رقم الهاتف");
      return;
    }
    setPhoneLoading(true);
    try {
      await base44.auth.updateMe({ phone });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تحديث رقم الهاتف!");
    } catch {
      toast.error("خطأ في تحديث الهاتف");
    }
    setPhoneLoading(false);
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setAvatarLoading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await base44.auth.updateMe({ avatar_url: file_url });
      setAvatar(file_url);
      
      // Update all user's trips with new avatar
      if (user?.email) {
        const userTrips = await base44.entities.Trip.filter({ created_by: user.email }, "-created_date", 100);
        await Promise.all(
          userTrips.map(trip => base44.entities.Trip.update(trip.id, { driver_avatar: file_url }))
        );
      }
      
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      qc.invalidateQueries({ queryKey: ["featured-trips"] });
      toast.success("تم تحديث الصورة!");
    } catch {
      toast.error("خطأ في رفع الصورة");
    }
    setAvatarLoading(false);
  };

  const updateLicense = async () => {
    if (!licenseNumber || !licenseExpiry || !carRegistrationExpiry || !insuranceExpiry || !licenseImageUrl || !carRegistrationUrl || !insuranceUrl || !selfie1Url || !selfie2Url) {
      toast.error("يرجى ملء جميع البيانات والمستندات المطلوبة");
      return;
    }
    setLicenseLoading(true);
    try {
      if (driverLicense) {
        await base44.entities.DriverLicense.update(driverLicense.id, {
          license_number: licenseNumber,
          expiry_date: licenseExpiry,
          car_registration_expiry_date: carRegistrationExpiry,
          insurance_expiry_date: insuranceExpiry,
          license_image_url: licenseImageUrl,
          car_registration_url: carRegistrationUrl,
          insurance_url: insuranceUrl,
          selfie_1_url: selfie1Url,
          selfie_2_url: selfie2Url,
          status: "pending",
          rejection_reason: null,
          submitted_at: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
        });
        toast.success("تم تحديث المستندات وإرسالها للمراجعة");
      } else {
        await base44.entities.DriverLicense.create({
          driver_email: user?.email,
          driver_name: user?.full_name,
          license_number: licenseNumber,
          expiry_date: licenseExpiry,
          car_registration_expiry_date: carRegistrationExpiry,
          insurance_expiry_date: insuranceExpiry,
          license_image_url: licenseImageUrl,
          car_registration_url: carRegistrationUrl,
          insurance_url: insuranceUrl,
          selfie_1_url: selfie1Url,
          selfie_2_url: selfie2Url,
          status: "pending",
          submitted_at: new Date().toISOString(),
        });
        toast.success("تم إرسال جميع المستندات للمراجعة ✓");
      }
      qc.invalidateQueries({ queryKey: ["driver-license", user?.email] });
    } catch (err) {
      captureException(err, { msg: "License update error:" });
      toast.error("خطأ في تحديث المستندات");
    }
    setLicenseLoading(false);
  };

  const uploadFile = async (e, setUrl, fileType = "صورة") => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      toast.error("حجم الملف يجب أن يكون أقل من 5 MB");
      return;
    }

    setLicenseLoading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUrl(file_url);
      toast.success(`تم رفع ${fileType} بنجاح`);
    } catch (err) {
      captureException(err, { msg: "Upload error:" });
      toast.error(`خطأ في رفع ${fileType}`);
    }
    setLicenseLoading(false);
  };

  const deleteAccount = async () => {
    setDeletionLoading(true);
    try {
      await base44.auth.deleteMe?.();
      toast.success("تم حذف حسابك بنجاح");
      setTimeout(() => base44.auth.logout?.("/"), 1500);
    } catch (err) {
      captureException(err, { msg: "Delete error:" });
      toast.error("فشل حذف الحساب. يرجى الاتصال بالدعم");
    }
    setDeletionLoading(false);
    setShowDeleteModal(false);
  };

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </Link>

      <h1 className="text-2xl font-bold text-foreground mb-6">إعدادات الحساب</h1>

      <div className="space-y-6">
        {/* Profile Section */}
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <h3 className="font-bold text-foreground">الملف الشخصي</h3>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary overflow-hidden shrink-0">
              {avatar ? (
                <img loading="lazy" src={avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                user.full_name?.[0] || "م"
              )}
            </div>
            <div>
              <input
                id="avatar-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={uploadAvatar}
                disabled={avatarLoading}
              />
              <Button 
                variant="outline" 
                className="rounded-xl gap-2" 
                disabled={avatarLoading}
                onClick={() => document.getElementById("avatar-input").click()}
              >
                <Image className="w-4 h-4" />
                {avatarLoading ? "جاري الرفع..." : "تغيير الصورة"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG (Max 5MB)</p>
            </div>
          </div>

          {/* Name (Locked) */}
          <div>
            <Label>الاسم الكامل</Label>
            <div className="mt-1 px-4 py-2.5 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span>{user.full_name}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">لا يمكن تغيير الاسم بعد التسجيل</p>
          </div>

          {/* Phone */}
          <div>
            <Label>رقم الهاتف</Label>
            <div className="flex gap-2 mt-1">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="مثال: 0599123456"
                className="rounded-xl h-10"
              />
              <Button
                onClick={updatePhone}
                disabled={phoneLoading || phone === user?.phone}
                className="bg-primary text-primary-foreground rounded-xl"
              >
                {phoneLoading ? "جاري..." : "حفظ"}
              </Button>
            </div>
          </div>
        </div>

        {/* Email Section */}
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            البريد الإلكتروني
          </h3>
          <div>
            <Label>عنوان البريد</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl h-10"
              />
              <Button
                onClick={updateEmail}
                disabled={emailLoading || email === user?.email}
                className="bg-primary text-primary-foreground rounded-xl"
              >
                {emailLoading ? "جاري..." : "حفظ"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">سيتم إرسال تأكيد إلى البريد الجديد</p>
          </div>
        </div>

        {/* Password Section */}
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            تغيير كلمة المرور
          </h3>
          <div className="space-y-3">
            <div>
              <Label>كلمة المرور الحالية</Label>
              <Input
                type="password"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                placeholder="أدخل كلمة المرور الحالية"
                className="rounded-xl h-10 mt-1"
              />
            </div>
            <div>
              <Label>كلمة المرور الجديدة</Label>
              <Input
                type="password"
                value={passwordForm.new}
                onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                placeholder="أدخل كلمة مرور جديدة (8+ أحرف)"
                className="rounded-xl h-10 mt-1"
              />
            </div>
            <div>
              <Label>تأكيد كلمة المرور</Label>
              <Input
                type="password"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                placeholder="أدخل كلمة المرور مرة أخرى"
                className="rounded-xl h-10 mt-1"
              />
            </div>
            <Button
              onClick={updatePassword}
              disabled={passwordLoading}
              className="w-full bg-primary text-primary-foreground rounded-xl"
            >
              {passwordLoading ? "جاري التحديث..." : "تحديث كلمة المرور"}
            </Button>
          </div>
        </div>

        {/* Driver License Section */}
        {/* PASSENGER ONLY: Become a driver upgrade card */}
        {user?.account_type === "passenger" && (
          <div className="bg-gradient-to-br from-primary/5 via-primary/10 to-accent/10 rounded-2xl border-2 border-primary/30 p-6 space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-12 translate-x-12" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-accent/5 rounded-full translate-y-8 -translate-x-8" />
            <div className="relative">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 text-2xl">
                  🚗
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-foreground text-base">تفعيل حساب السائق</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">انشر رحلاتك واربح من المقاعد الفارغة</p>
                </div>
              </div>
              <div className="space-y-1.5 mb-4 text-xs text-foreground/80">
                <div className="flex items-center gap-2">
                  <span className="text-primary">✓</span>
                  <span>انشر رحلاتك بين المدن الفلسطينية</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-primary">✓</span>
                  <span>اربح دخلاً إضافياً من المقاعد الفارغة</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-primary">✓</span>
                  <span>قابل أشخاصاً جدداً وشارك الطريق</span>
                </div>
              </div>
              <Button
                onClick={async () => {
                  if (!confirm("سيتم تحويل حسابك إلى حساب سائق وراكب. ستحتاج لإكمال توثيق 5 وثائق قبل أن تتمكن من نشر الرحلات. هل تريد المتابعة؟")) return;
                  try {
                    await base44.auth.updateMe({ account_type: "both" });
                    toast.success("تم تفعيل حساب السائق! أكمل رفع الوثائق أدناه ↓");
                    qc.invalidateQueries({ queryKey: ["me"] });
                    // Refresh AuthContext too — needed for navbar to show driver features
                    if (typeof window !== "undefined") {
                      // Trigger AuthContext refresh by reloading user data
                      setTimeout(() => window.location.reload(), 800);
                    }
                  } catch (err) {
                    toast.error("فشل التحديث. حاول مجدداً");
                  }
                }}
                className="w-full bg-primary text-primary-foreground rounded-xl gap-2 h-11"
              >
                <Shield className="w-4 h-4" />
                تفعيل حساب السائق الآن
              </Button>
              <p className="text-[10px] text-center text-muted-foreground mt-2">
                ستحتاج لتقديم 5 وثائق: الرخصة، تسجيل المركبة، التأمين، وسيلفي للهوية
              </p>
            </div>
          </div>
        )}

        {user?.account_type && (user.account_type === "driver" || user.account_type === "both") && (
          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              توثيق السائق
              <span className="text-xs font-normal text-muted-foreground mr-auto">
                (5 وثائق مطلوبة)
              </span>
            </h3>
            
            {driverLicense && (
              <div className={`p-3 rounded-xl flex items-start gap-3 ${
                driverLicense.status === "approved" ? "bg-green-500/10 border border-green-500/20" :
                driverLicense.status === "pending"  ? "bg-yellow-500/10 border border-yellow-500/20" :
                driverLicense.status === "incomplete" ? "bg-blue-500/10 border border-blue-500/20" :
                "bg-destructive/10 border border-destructive/20"
              }`}>
                <span className={`text-2xl shrink-0 ${
                  driverLicense.status === "approved" ? "text-green-600" :
                  driverLicense.status === "pending"  ? "text-yellow-600" :
                  driverLicense.status === "incomplete" ? "text-blue-600" :
                  "text-destructive"
                }`}>
                  {driverLicense.status === "approved" ? "✓" :
                   driverLicense.status === "pending"  ? "⏳" :
                   driverLicense.status === "incomplete" ? "📋" : "✕"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {driverLicense.status === "approved" ? "تم توثيق حسابك ✓ يمكنك نشر الرحلات الآن" :
                     driverLicense.status === "pending"  ? "وثائقك قيد المراجعة (1-3 أيام عمل)" :
                     driverLicense.status === "incomplete" ? "وثائقك غير مكتملة — أكمل جميع الوثائق الـ5 لإرسالها للمراجعة" :
                     "لم يتم قبول وثائقك"}
                  </p>
                  {driverLicense.rejection_reason && (
                    <p className="text-xs text-muted-foreground mt-1">السبب: {driverLicense.rejection_reason}</p>
                  )}
                  {/* Mini progress for incomplete */}
                  {(driverLicense.status === "incomplete" || !driverLicense.status) && (() => {
                    const docs = [
                      driverLicense.license_image_url,
                      driverLicense.car_registration_url,
                      driverLicense.insurance_url,
                      driverLicense.selfie_1_url,
                      driverLicense.selfie_2_url,
                    ];
                    const uploaded = docs.filter(Boolean).length;
                    return (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{uploaded} من 5 وثائق</span>
                          <span className="font-bold text-blue-600">{Math.round((uploaded/5)*100)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${(uploaded/5)*100}%` }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label>رقم الرخصة</Label>
                <Input
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="مثال: 123456789"
                  className="rounded-xl h-10 mt-1"
                />
              </div>
              <div>
                <Label>تاريخ انتهاء الرخصة</Label>
                <Input
                  type="date"
                  value={licenseExpiry}
                  onChange={(e) => setLicenseExpiry(e.target.value)}
                  className="rounded-xl h-10 mt-1"
                />
              </div>
              <div>
                <Label>تاريخ انتهاء تسجيل المركبة</Label>
                <Input
                  type="date"
                  value={carRegistrationExpiry}
                  onChange={(e) => setCarRegistrationExpiry(e.target.value)}
                  className="rounded-xl h-10 mt-1"
                />
              </div>
              <div>
                <Label>تاريخ انتهاء التأمين</Label>
                <Input
                  type="date"
                  value={insuranceExpiry}
                  onChange={(e) => setInsuranceExpiry(e.target.value)}
                  className="rounded-xl h-10 mt-1"
                />
              </div>

              {/* Document Uploads */}
              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-3">المستندات المطلوبة</p>
                
                {/* License */}
                <div className="mb-3">
                  <Label className="text-xs">1️⃣ صورة رخصة القيادة</Label>
                  <input
                    id="license-file"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setLicenseImageUrl, "رخصة القيادة")}
                    disabled={licenseLoading}
                  />
                  <Button 
                    variant="outline" 
                    className="rounded-xl gap-2 w-full mt-1" 
                    disabled={licenseLoading}
                    onClick={() => document.getElementById("license-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {licenseImageUrl ? "✓ تم الرفع" : "اختر صورة"}
                  </Button>
                </div>

                {/* Car Registration */}
                <div className="mb-3">
                  <Label className="text-xs">2️⃣ صورة تسجيل المركبة</Label>
                  <input
                    id="registration-file"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setCarRegistrationUrl, "تسجيل المركبة")}
                    disabled={licenseLoading}
                  />
                  <Button 
                    variant="outline" 
                    className="rounded-xl gap-2 w-full mt-1" 
                    disabled={licenseLoading}
                    onClick={() => document.getElementById("registration-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {carRegistrationUrl ? "✓ تم الرفع" : "اختر صورة"}
                  </Button>
                </div>

                {/* Insurance */}
                <div className="mb-3">
                  <Label className="text-xs">3️⃣ صورة التأمين</Label>
                  <input
                    id="insurance-file"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setInsuranceUrl, "التأمين")}
                    disabled={licenseLoading}
                  />
                  <Button 
                    variant="outline" 
                    className="rounded-xl gap-2 w-full mt-1" 
                    disabled={licenseLoading}
                    onClick={() => document.getElementById("insurance-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {insuranceUrl ? "✓ تم الرفع" : "اختر صورة"}
                  </Button>
                </div>

                {/* Selfie 1 */}
                <div className="mb-3">
                  <Label className="text-xs">4️⃣ سيلفي الهوية (الوجه مع الهوية)</Label>
                  <input
                    id="selfie1-file"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setSelfie1Url, "السيلفي الأول")}
                    disabled={licenseLoading}
                  />
                  <Button 
                    variant="outline" 
                    className="rounded-xl gap-2 w-full mt-1" 
                    disabled={licenseLoading}
                    onClick={() => document.getElementById("selfie1-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {selfie1Url ? "✓ تم الرفع" : "اختر صورة"}
                  </Button>
                </div>

                {/* Selfie 2 */}
                <div className="mb-3">
                  <Label className="text-xs">5️⃣ سيلفي إضافي (الوجه الواضح)</Label>
                  <input
                    id="selfie2-file"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadFile(e, setSelfie2Url, "السيلفي الثاني")}
                    disabled={licenseLoading}
                  />
                  <Button 
                    variant="outline" 
                    className="rounded-xl gap-2 w-full mt-1" 
                    disabled={licenseLoading}
                    onClick={() => document.getElementById("selfie2-file").click()}
                  >
                    <Image className="w-4 h-4" />
                    {selfie2Url ? "✓ تم الرفع" : "اختر صورة"}
                  </Button>
                </div>
              </div>

              <Button
                onClick={updateLicense}
                disabled={licenseLoading}
                className="w-full bg-primary text-primary-foreground rounded-xl"
              >
                {licenseLoading ? "جاري التحديث..." : "إرسال المستندات للمراجعة"}
              </Button>
            </div>
          </div>
        )}

        {/* Danger Zone */}
                {/* Logout button — visible signout for the user */}
        <div className="bg-card rounded-2xl border border-border p-4">
          <Button
            onClick={async () => {
              try { await base44.auth.logout?.("/"); } catch {}
              window.location.href = "/";
            }}
            variant="outline"
            className="w-full rounded-xl gap-2 h-11 border-border hover:bg-muted"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </Button>
        </div>

        <div className="bg-destructive/5 rounded-2xl border border-destructive/20 p-6">
          <h3 className="font-bold text-destructive flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4" />
            منطقة الخطر
          </h3>
          <Button
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10 rounded-xl gap-2 w-full"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="w-4 h-4" />
            حذف الحساب
          </Button>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-card rounded-2xl border border-border p-6 max-w-sm mx-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-foreground">حذف الحساب</h3>
                <button onClick={() => setShowDeleteConfirm(false)} className="p-1 hover:bg-muted rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 space-y-2">
                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  تحذير
                </p>
                <p className="text-sm text-destructive/80">
                  سيتم حذف حسابك وجميع بيانات المرتبطة به بشكل دائم. لا يمكن التراجع عن هذا الإجراء.
                </p>
              </div>

              {!showDeleteModal ? (
                <Button
                  onClick={() => setShowDeleteModal(true)}
                  className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl"
                >
                  فهمت، متابعة الحذف
                </Button>
              ) : (
                <div className="space-y-3 bg-destructive/5 p-4 rounded-xl border border-destructive/20">
                  <p className="text-sm font-medium text-destructive">
                    تأكيد أخير: اكتب "حذف حسابي" للمتابعة
                  </p>
                  <div className="space-y-2">
                    <Button
                      onClick={deleteAccount}
                      disabled={deletionLoading}
                      className="w-full bg-red-600 hover:bg-red-700 text-white rounded-xl"
                    >
                      {deletionLoading ? "جاري الحذف..." : "حذف الحساب نهائياً"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => { setShowDeleteConfirm(false); setShowDeleteModal(false); }}
                      className="w-full rounded-xl"
                      disabled={deletionLoading}
                    >
                      إلغاء
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}