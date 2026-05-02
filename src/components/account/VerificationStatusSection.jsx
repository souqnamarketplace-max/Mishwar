import React from "react";
import { ShieldCheck, Clock, Camera } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * VerificationStatusSection — shows the user their ID verification status.
 */
export default function VerificationStatusSection({ user }) {
  const isVerified = user?.is_verified === true;
  const isPending = user?.verification_pending === true;

  if (isVerified) {
    return (
      <div className="text-center py-6">
        <div className="w-20 h-20 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
          <ShieldCheck className="w-10 h-10 text-blue-500" />
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">تم التحقق من هويتك! ✓</h3>
        <p className="text-sm text-muted-foreground mb-2">مبارك، تم التحقق من هويتك بنجاح.</p>
        <p className="text-sm text-muted-foreground mb-6">شارة التحقق تظهر الآن على ملفك الشخصي ورحلاتك ونتائج البحث.</p>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-right">
          <p className="text-xs font-bold text-blue-900 mb-1">ماذا يعني ذلك؟</p>
          <ul className="text-xs text-blue-800 space-y-1 list-disc pr-4">
            <li>الركاب يثقون بك أكثر</li>
            <li>تظهر في نتائج البحث بشكل أفضل</li>
            <li>أكثر حجوزات وأمان</li>
          </ul>
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="text-center py-6">
        <div className="w-20 h-20 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
          <Clock className="w-10 h-10 text-yellow-500" />
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">قيد المراجعة...</h3>
        <p className="text-sm text-muted-foreground mb-6">استلمنا طلب التحقق وسيراجعه فريق الإدارة خلال 24-48 ساعة.</p>
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-right">
          <p className="text-xs text-yellow-900">في هذه الأثناء يمكنك استخدام التطبيق بشكل طبيعي. ستحصل على شارة التحقق بمجرد الموافقة.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-6">
      <div className="w-20 h-20 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-4">
        <Camera className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-bold text-foreground mb-2">تحقق من هويتك</h3>
      <p className="text-sm text-muted-foreground mb-6">احصل على شارة التحقق الزرقاء لزيادة ثقة الركاب وحجوزاتك.</p>
      <div className="bg-card border border-border rounded-2xl p-4 mb-4 text-right">
        <p className="text-xs font-bold text-foreground mb-2">ما تحتاجه:</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pr-4">
          <li>صورة سيلفي واضحة لوجهك</li>
          <li>صورة هوية شخصية (اختياري)</li>
        </ul>
      </div>
      <Link to="/account-settings/profile#license" className="inline-block w-full bg-primary text-primary-foreground rounded-xl py-3 font-bold text-sm">
        ابدأ التحقق الآن ←
      </Link>
    </div>
  );
}
