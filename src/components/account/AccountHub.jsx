import React, { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import {
  ArrowLeft, ChevronLeft, User, ShieldCheck, Bell, CreditCard,
  Sparkles, Settings as SettingsIcon, Shield, Flag, Wallet
} from "lucide-react";
import AccountHubItem from "./AccountHubItem";
import PreferencesSection from "./PreferencesSection";
import NotificationPrefsSection from "./NotificationPrefsSection";
import VerificationStatusSection from "./VerificationStatusSection";
import PassengerPaymentsSection from "./PassengerPaymentsSection";
import BlockedUsersSection from "./BlockedUsersSection";
import MyReportsSection from "./MyReportsSection";
import StrikeStatusSection from "./StrikeStatusSection";
import DebugOverlay from "@/components/debug/DebugOverlay";

import { useSEO } from "@/hooks/useSEO";
/**
 * AccountHub — Poparide-style hub view.
 * Renders a master list when no section selected, or the selected section's content.
 */
export default function AccountHub() {
  useSEO({ title: "الحساب", description: "إدارة إعدادات حسابك في مشوارو" });
  const auth = useAuth();
  const user = auth?.user;
  const refreshUser = auth?.refreshUser;
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState(searchParams.get("section") || null);

  // Hidden debug overlay — tap the version number 7 times to open.
  // Tap counter resets if 2s elapse between taps so accidental
  // double-taps from a curious user don't slowly fill the counter.
  const [debugOpen, setDebugOpen] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  useEffect(() => {
    if (tapCount === 0) return;
    const t = setTimeout(() => setTapCount(0), 2000);
    return () => clearTimeout(t);
  }, [tapCount]);
  const handleVersionTap = () => {
    setTapCount((n) => {
      const next = n + 1;
      if (next >= 7) {
        setDebugOpen(true);
        return 0;
      }
      return next;
    });
  };

  // Sync section state with URL query param. Previously this only
  // updated when fromUrl was truthy — so a user navigating from
  // /account?section=vehicle to /account (no params) ended up
  // viewing the vehicle section even though the URL no longer
  // requested it. The deep-link case still works because
  // setSection(<string>) updates the rendered view.
  React.useEffect(() => {
    setSection(searchParams.get("section") || null);
  }, [searchParams]);

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
      notifications:"إعدادات الإشعارات",
      verification: "التحقق من الهوية",
      payments:     "سجل المدفوعات",
      blocked:      "المستخدمون المحظورون",
      reports:      "بلاغاتي",
      strikes:      "حالة الحساب",
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
          {section === "notifications"&& <NotificationPrefsSection user={user} onSaved={refreshUser} />}
          {section === "verification" && <VerificationStatusSection user={user} />}
          {section === "payments"     && <PassengerPaymentsSection user={user} />}
          {section === "blocked"      && <BlockedUsersSection user={user} />}
          {section === "reports"      && <MyReportsSection user={user} />}
          {section === "strikes"      && <StrikeStatusSection user={user} />}
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
        to="/profile"
        className="block bg-card border border-border rounded-2xl p-4 mb-4 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-lg overflow-hidden">
              {user.avatar_url ? (
                <img loading="lazy" decoding="async" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
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

      {/* Become a driver — passengers only. Lifted to the top of the
          list because a 5-step wizard is the primary upgrade path and
          burying it under settings is a known friction point. */}
      {!isDriver && (
        <Link to="/become-driver" className="block mb-4">
          <div className="bg-gradient-to-br from-primary via-primary to-primary/85 rounded-2xl p-4 flex items-center gap-3 shadow-md hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center text-2xl shrink-0">
              🚗
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-primary-foreground">كن سائقاً في مشوارو</p>
              <p className="text-xs text-primary-foreground/80 mt-0.5">اربح من مقاعدك الفارغة — التسجيل 5 دقائق</p>
            </div>
            <ChevronLeft className="w-4 h-4 text-primary-foreground/70 shrink-0" />
          </div>
        </Link>
      )}

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

        <AccountHubItem icon={CreditCard} label="سجل المدفوعات" sublabel="حجوزاتك السابقة والمدفوعة" onClick={() => setSection("payments")} />

        {isDriver && (
          <Link to="/driver?tab=payments">
            <AccountHubItem icon={CreditCard} label="مدفوعات السائق" sublabel="حسابك المصرفي، Jawwal Pay، Reflect" onClick={() => {}} />
          </Link>
        )}

        {isDriver && (
          <Link to="/driver?tab=subscription">
            <AccountHubItem icon={Wallet} label="اشتراك المنصة" sublabel="حالة الاشتراك الشهري وطلب التجديد" onClick={() => {}} />
          </Link>
        )}

        <AccountHubItem
          icon={Flag}
          label="بلاغاتي"
          sublabel="البلاغات التي قدمتها وحالتها"
          onClick={() => setSection("reports")}
        />
        <AccountHubItem
          icon={Shield}
          label="المستخدمون المحظورون"
          sublabel="إدارة قائمة الحظر وإلغاء الحظر"
          onClick={() => setSection("blocked")}
        />
        <AccountHubItem
          icon={ShieldCheck}
          label="حالة الحساب"
          sublabel="نقاط الإلغاء وسجل النشاط"
          onClick={() => setSection("strikes")}
        />

        <Link to="/verify-passenger">
          <AccountHubItem
            icon={ShieldCheck}
            label="توثيق الهوية"
            sublabel="مطلوب لنشر طلبات الرحلات"
            onClick={() => {}}
          />
        </Link>

        <Link to="/account-settings/profile#license">
          <AccountHubItem icon={SettingsIcon} label="إعدادات متقدمة" sublabel="كلمة المرور، رخصة القيادة، حذف الحساب" onClick={() => {}} />
        </Link>
      </div>

      <p
        className="text-xs text-muted-foreground text-center mt-6 select-none cursor-pointer"
        onClick={handleVersionTap}
      >
        نسخة مشوارو {import.meta.env?.VITE_APP_VERSION || "1.0.5"}
      </p>

      <DebugOverlay open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  );
}
