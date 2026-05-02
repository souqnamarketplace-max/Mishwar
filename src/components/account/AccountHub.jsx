import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import {
  ArrowLeft, ChevronLeft, User, ShieldCheck, Bell, CreditCard,
  Sparkles, Car, Settings as SettingsIcon
} from "lucide-react";
import AccountHubItem from "./AccountHubItem";
import PreferencesSection from "./PreferencesSection";
import VehicleDetailsSection from "./VehicleDetailsSection";
import NotificationPrefsSection from "./NotificationPrefsSection";
import VerificationStatusSection from "./VerificationStatusSection";
import PassengerPaymentsSection from "./PassengerPaymentsSection";

/**
 * AccountHub — Poparide-style hub view.
 * Renders a master list when no section selected, or the selected section's content.
 */
export default function AccountHub() {
  const auth = useAuth();
  const user = auth?.user;
  const refreshUser = auth?.refreshUser;
  const [section, setSection] = useState(null);

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">يرجى تسجيل الدخول</p>
      </div>
    );
  }

  const isDriver = user.account_type === "driver" || user.account_type === "both";
  const isVerified = user.is_verified === true;

  if (section) {
    const titles = {
      preferences:  "التفضيلات",
      vehicle:      "تفاصيل السيارة",
      notifications:"إعدادات الإشعارات",
      verification: "التحقق من الهوية",
      payments:     "سجل المدفوعات",
    };

    return (
      <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
        <button
          onClick={() => setSection(null)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          رجوع للحساب
        </button>
        <h1 className="text-2xl font-bold text-foreground mb-6">{titles[section]}</h1>

        <div className="bg-card border border-border rounded-2xl p-5">
          {section === "preferences"  && <PreferencesSection user={user} onSaved={refreshUser} />}
          {section === "vehicle"      && <VehicleDetailsSection user={user} onSaved={refreshUser} />}
          {section === "notifications"&& <NotificationPrefsSection user={user} onSaved={refreshUser} />}
          {section === "verification" && <VerificationStatusSection user={user} />}
          {section === "payments"     && <PassengerPaymentsSection user={user} />}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </Link>

      <h1 className="text-2xl font-bold text-foreground mb-6">حسابي</h1>

      <Link
        to={`/profile?email=${encodeURIComponent(user.email)}`}
        className="block bg-card border border-border rounded-2xl p-4 mb-4 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-lg overflow-hidden">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                user.full_name?.[0] || "م"
              )}
            </div>
            {isVerified && (
              <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center border-2 border-card">
                <ShieldCheck className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-foreground truncate">{user.full_name || user.email}</p>
            <p className="text-xs text-muted-foreground">عرض ملفك الشخصي</p>
          </div>
          <ChevronLeft className="w-4 h-4 text-muted-foreground/60 shrink-0" />
        </div>
      </Link>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <Link to="/account-settings/profile" className="block">
          <AccountHubItem icon={User} label="إعدادات الملف الشخصي" sublabel="الاسم، الهاتف، الجنس، الصورة" onClick={() => {}} />
        </Link>

        <AccountHubItem
          icon={ShieldCheck}
          label="التحقق من الهوية"
          sublabel={isVerified ? "تم التحقق ✓" : user.verification_pending ? "قيد المراجعة..." : "ابدأ التحقق"}
          badge={isVerified ? "موثّق" : null}
          onClick={() => setSection("verification")}
        />

        <AccountHubItem icon={Bell} label="إعدادات الإشعارات" sublabel="Push، SMS، البريد، التسويق" onClick={() => setSection("notifications")} />
        <AccountHubItem icon={Sparkles} label="التفضيلات" sublabel="التدخين، المحادثة، الحيوانات الأليفة" onClick={() => setSection("preferences")} />

        {isDriver && (
          <AccountHubItem icon={Car} label="تفاصيل السيارة" sublabel="حجم الأمتعة، المقعد الخلفي" onClick={() => setSection("vehicle")} />
        )}

        <AccountHubItem icon={CreditCard} label="سجل المدفوعات" sublabel="حجوزاتك السابقة والمدفوعة" onClick={() => setSection("payments")} />

        {isDriver && (
          <Link to="/driver-dashboard?tab=payment">
            <AccountHubItem icon={CreditCard} label="مدفوعات السائق" sublabel="حسابك المصرفي، Jawwal Pay، Reflect" onClick={() => {}} />
          </Link>
        )}

        <Link to="/account-settings/profile#license">
          <AccountHubItem icon={SettingsIcon} label="إعدادات متقدمة" sublabel="كلمة المرور، رخصة القيادة، حذف الحساب" onClick={() => {}} />
        </Link>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-6">
        نسخة مِشوارو {import.meta.env?.VITE_APP_VERSION || "1.0"}
      </p>
    </div>
  );
}
