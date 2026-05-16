import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Bell, Mail, MessageSquare, Megaphone, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { getPermission, ensurePermission } from "@/lib/pushNotifications";

/**
 * NotificationPrefsSection — push, email, SMS, marketing toggles.
 * Saves to profiles: notif_push, notif_email, notif_sms, notif_marketing
 *
 * Also surfaces the OS-level Notification.permission state at the top.
 * Without this block, a user could flip the in-app 'notif_push' toggle
 * ON in their profile while the browser had notifications DENIED — and
 * see no indication why notifications weren't actually arriving. The
 * status block makes the OS permission visible and actionable
 * (request now, or re-enable from browser/iOS settings).
 */

// Permission-state card. Rendered above the toggles. Behaviour per state:
//   - 'granted'    → quiet green confirmation
//   - 'default'    → CTA button that triggers ensurePermission()
//   - 'denied'     → warning + platform-aware instructions to re-enable
//                    (browser-level setting, not something we can flip)
//   - 'unsupported'→ info that the browser doesn't expose Notification API
function PermissionStatusCard({ permission, onAsk, asking }) {
  if (permission === "unsupported") {
    return (
      <div className="flex items-start gap-3 p-3 bg-muted/40 border border-border rounded-xl mb-4">
        <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">متصفحك لا يدعم إشعارات الجهاز</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            ستظل تتلقى الإشعارات داخل التطبيق عند فتحه. للحصول على إشعارات خارج التطبيق، استخدم متصفحاً حديثاً أو ثبّت التطبيق على هاتفك.
          </p>
        </div>
      </div>
    );
  }
  if (permission === "granted") {
    return (
      <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/30 rounded-xl mb-4">
        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-green-900 dark:text-green-200">إشعارات الجهاز مفعّلة</p>
          <p className="text-xs text-green-800/80 dark:text-green-300/80 mt-0.5">
            ستتلقى تنبيهات على هاتفك أو متصفحك عند وصول حجوزات جديدة، رسائل، أو تقييمات.
          </p>
        </div>
      </div>
    );
  }
  if (permission === "denied") {
    // Don't try to detect iOS Safari vs Chrome vs Android specifically;
    // give general instructions that cover the common cases. Most
    // platforms put it in the lock-icon menu or site/app settings.
    return (
      <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">إشعارات الجهاز معطّلة</p>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-relaxed">
            قمت بحظر الإشعارات سابقاً. لن نتمكن من تنبيهك على هاتفك للحجوزات والرسائل.
            لإعادة التفعيل:
          </p>
          <ul className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1.5 mr-4 space-y-0.5 list-disc">
            <li>على متصفح الحاسوب: انقر على أيقونة القفل بجانب عنوان الموقع → إعدادات الموقع → الإشعارات → السماح</li>
            <li>على iPhone (Safari): الإعدادات → Safari → المواقع → الإشعارات → mishwaro.com → السماح</li>
            <li>على Android: الإعدادات → التطبيقات → Chrome → الإشعارات → السماح</li>
          </ul>
        </div>
      </div>
    );
  }
  // 'default' — not yet asked, or asked and dismissed without choosing.
  return (
    <div className="flex items-start gap-3 p-3 bg-primary/8 border border-primary/30 rounded-xl mb-4">
      <Bell className="w-4 h-4 text-primary mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">فعّل إشعارات الجهاز</p>
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">
          احصل على تنبيهات لحظية عند وصول حجوزات جديدة، رسائل، أو تقييمات — حتى لو لم يكن التطبيق مفتوحاً.
        </p>
        <Button
          size="sm"
          onClick={onAsk}
          disabled={asking}
          className="rounded-lg text-xs h-8 bg-primary text-primary-foreground"
        >
          {asking ? "جاري الطلب..." : "تفعيل الإشعارات"}
        </Button>
      </div>
    </div>
  );
}

export default function NotificationPrefsSection({ user, onSaved }) {
  const qc = useQueryClient();
  const [push, setPush]            = useState(user?.notif_push !== false);
  const [email, setEmail]          = useState(user?.notif_email !== false);
  const [sms, setSms]              = useState(user?.notif_sms === true);
  const [marketing, setMarketing]  = useState(user?.notif_marketing === true);
  const [saving, setSaving]        = useState(false);

  // OS permission state — refreshed on mount and after the user
  // taps 'تفعيل الإشعارات' (so the card updates immediately when
  // the browser prompt resolves).
  const [permission, setPermission] = useState(() => getPermission());
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setPush(user?.notif_push !== false);
    setEmail(user?.notif_email !== false);
    setSms(user?.notif_sms === true);
    setMarketing(user?.notif_marketing === true);
  }, [user?.notif_push, user?.notif_email, user?.notif_sms, user?.notif_marketing]);

  // Re-read permission when the tab gains focus — covers the case
  // where the user went to browser/iOS settings, changed the
  // permission, then came back. Without this, the card would still
  // show the stale 'denied' state until full reload.
  useEffect(() => {
    const refresh = () => setPermission(getPermission());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const askPermission = async () => {
    setAsking(true);
    try {
      await ensurePermission();
    } finally {
      // Re-read whatever the user chose. ensurePermission resolves
      // to the new state but we re-fetch from Notification.permission
      // directly to handle the edge case where the browser doesn't
      // honour the request (e.g. permission policy blocks).
      setPermission(getPermission());
      setAsking(false);
    }
  };

  const save = async () => {
    if (!user?.email) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ notif_push: push, notif_email: email, notif_sms: sms, notif_marketing: marketing })
        .eq("email", user.email);
      if (error) throw error;
      toast.success("تم حفظ الإعدادات ✅");
      qc.invalidateQueries({ queryKey: ["me"] });
      onSaved?.();
    } catch (err) {
      toast.error(friendlyError(err, "تعذر حفظ إعدادات الإشعارات"));
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({ checked, onChange, icon: Icon, title, desc, recommended, comingSoon }) => (
    <div className={`flex items-start gap-3 py-4 border-b border-border/50 ${comingSoon ? "opacity-60" : ""}`}>
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className="font-bold text-sm text-foreground">{title}</p>
          {recommended && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">⭐ موصى به</span>}
          {comingSoon && <span className="text-[9px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">قريباً</span>}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      </div>
      <button
        onClick={() => !comingSoon && onChange(!checked)}
        disabled={comingSoon}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked && !comingSoon ? "bg-primary" : "bg-muted"} ${comingSoon ? "cursor-not-allowed" : ""}`}
        role="switch" aria-checked={checked} aria-disabled={comingSoon || undefined}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all ${checked && !comingSoon ? "right-0.5" : "right-[1.4rem]"}`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-4">اختر كيف تود أن نتواصل معك</p>

      {/* OS-level permission state — surfaced ABOVE the in-app toggle so
          users see the OS state before flipping the profile preference.
          Previously, a user could enable notif_push in their profile
          while the BROWSER had notifications denied and see no indication
          why notifications weren't actually arriving. */}
      <PermissionStatusCard
        permission={permission}
        onAsk={askPermission}
        asking={asking}
      />

      <Toggle checked={push} onChange={setPush} icon={Bell} title="الإشعارات داخل التطبيق" desc="لكل النشاطات المهمة: الحجوزات، الرسائل، التقييمات" recommended />
      {/* SMS and Email are intentionally marked "قريباً" — there is no SMS
          gateway (Twilio/local provider) or transactional email sender wired
          into the backend yet. Showing the toggle as actionable would let
          users disable a delivery channel that doesn't exist, then wonder
          why they aren't getting messages they never could have received. */}
      <Toggle checked={sms} onChange={setSms} icon={MessageSquare} title="الرسائل النصية SMS" desc="للحجوزات الجديدة والإلغاءات فقط" comingSoon />
      <Toggle checked={email} onChange={setEmail} icon={Mail} title="البريد الإلكتروني" desc="لكل النشاطات المهمة: الحجوزات، الرسائل، التقييمات" comingSoon />
      <Toggle checked={marketing} onChange={setMarketing} icon={Megaphone} title="العروض والتسويق" desc="عروض خاصة، ميزات جديدة، أخبار مشواروو" />

      <Button onClick={save} disabled={saving} className="w-full rounded-xl bg-primary text-primary-foreground mt-4">
        {saving ? "جاري الحفظ..." : "تأكيد"}
      </Button>
    </div>
  );
}
