import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Lock, Mail, Phone, Image, Trash2, AlertCircle, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function AccountSettings() {
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });
  const qc = useQueryClient();

  // Email
  const [email, setEmail] = useState(user?.email || "");
  const [emailLoading, setEmailLoading] = useState(false);

  // Password
  const [passwordForm, setPasswordForm] = useState({ current: "", new: "", confirm: "" });
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Phone
  const [phone, setPhone] = useState(user?.phone || "");
  const [phoneLoading, setPhoneLoading] = useState(false);

  // Avatar
  const [avatarLoading, setAvatarLoading] = useState(false);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تحديث الصورة!");
    } catch {
      toast.error("خطأ في رفع الصورة");
    }
    setAvatarLoading(false);
  };

  const deleteAccount = async () => {
    setShowDeleteConfirm(false);
    toast.error("يرجى الاتصال بالدعم لحذف الحساب");
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
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                user.full_name?.[0] || "م"
              )}
            </div>
            <div>
              <label htmlFor="avatar-input" className="cursor-pointer">
                <Button variant="outline" className="rounded-xl gap-2" disabled={avatarLoading}>
                  <Image className="w-4 h-4" />
                  {avatarLoading ? "جاري الرفع..." : "تغيير الصورة"}
                </Button>
              </label>
              <input
                id="avatar-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={uploadAvatar}
                disabled={avatarLoading}
              />
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

        {/* Danger Zone */}
        <div className="bg-destructive/5 rounded-2xl border border-destructive/20 p-6">
          <h3 className="font-bold text-destructive flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4" />
            منطقة الخطر
          </h3>
          {showDeleteConfirm ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">هل أنت متأكد من حذف حسابك؟ هذا الإجراء لا يمكن التراجع عنه.</p>
              <div className="flex gap-2">
                <Button
                  onClick={deleteAccount}
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl flex-1"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  نعم، احذف الحساب
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-xl flex-1"
                >
                  إلغاء
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10 rounded-xl gap-2 w-full"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="w-4 h-4" />
              حذف الحساب
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}