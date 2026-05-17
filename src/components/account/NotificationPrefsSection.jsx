import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Bell, Mail, MessageSquare, Megaphone, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import {
  getPermission,
  ensurePermission,
  getNativePermission,
  registerNativePush,
} from "@/lib/pushNotifications";

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
function PermissionStatusCard({ permission, onAsk, asking, isNative }) {
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
    // Native iOS / Android: the permission lives in the OS Settings
    // app, not in browser site settings. Showing browser instructions
    // on a native build would be misleading — there's no Safari
    // "Sites" menu inside a Capacitor WKWebView.
    //
    // Native iOS path: Settings → Mishwaro → الإشعارات → السماح
    // Native Android path: Settings → Apps → Mishwaro → Notifications → Allow
    //
    // Web users see the legacy browser-chrome instructions that cover
    // desktop Chrome/Safari and mobile Chrome.
    return (
      <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-4">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">إشعارات الجهاز معطّلة</p>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-relaxed">
            قمت بحظر الإشعارات سابقاً. لن نتمكن من تنبيهك على هاتفك للحجوزات والرسائل.
            لإعادة التفعيل:
          </p>
          {isNative ? (
            <ul className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1.5 mr-4 space-y-0.5 list-disc">
              <li>على iPhone: الإعدادات → مشوارو → الإشعارات → السماح بالإشعارات</li>
              <li>على Android: الإعدادات → التطبيقات → مشوارو → الإشعارات → السماح</li>
            </ul>
          ) : (
            <ul className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1.5 mr-4 space-y-0.5 list-disc">
              <li>على متصفح الحاسوب: انقر على أيقونة القفل بجانب عنوان الموقع → إعدادات الموقع → الإشعارات → السماح</li>
              <li>على iPhone (Safari): الإعدادات → Safari → المواقع → الإشعارات → mishwaro.com → السماح</li>
              <li>على Android: الإعدادات → التطبيقات → Chrome → الإشعارات → السماح</li>
            </ul>
          )}
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

  // Sync local toggle state when the parent's user object updates
  // (e.g. after the save() round-trip invalidates the 'me' query and
  // a fresh profile flows in via prop). Without this, the toggles
  // would stay at their initial-mount values until next remount.
  useEffect(() => {
    setPush(user?.notif_push !== false);
    setEmail(user?.notif_email !== false);
    setSms(user?.notif_sms === true);
    setMarketing(user?.notif_marketing === true);
  }, [user?.notif_push, user?.notif_email, user?.notif_sms, user?.notif_marketing]);

  // Detect whether we're running inside a Capacitor native shell. The
  // permission API and the "go re-enable" instructions differ between
  // web (browser Notification API + browser chrome settings) and
  // native (Capacitor PushNotifications plugin + iOS/Android Settings
  // app). Computed once on mount — the platform doesn't change at
  // runtime; isNative is stable for the life of the page.
  const isNative = Capacitor.isNativePlatform();

  // OS permission state — refreshed on mount and after the user
  // taps 'تفعيل الإشعارات' (so the card updates immediately when
  // the browser prompt resolves). On native, the value comes from
  // the Capacitor PushNotifications plugin via getNativePermission()
  // which returns "granted" | "denied" | "prompt" | "prompt-with-rationale"
  // | "unsupported". We normalize "prompt" / "prompt-with-rationale"
  // to "default" so the status card's CASE handles both web and
  // native uniformly (the card's "default" branch is the CTA path).
  const [permission, setPermission] = useState("default");
  const [asking, setAsking] = useState(false);

  // Read permission once on mount, then again whenever the tab gains
  // focus. Async on native because the Capacitor plugin returns a
  // Promise; we use a cleanup flag to drop stale results if the
  // component unmounts mid-fetch.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      let next;
      if (isNative) {
        const raw = await getNativePermission();
        // Map native states → the four states the card knows about.
        next = (raw === "prompt" || raw === "prompt-with-rationale")
          ? "default"
          : raw;     // "granted" | "denied" | "unsupported"
      } else {
        next = getPermission();
      }
      if (!cancelled) setPermission(next);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isNative]);

  const askPermission = async () => {
    setAsking(true);
    try {
      if (isNative) {
        // On native, registerNativePush() handles permission request
        // AND token registration in one call. If the user grants,
        // they also get device_tokens populated so pushes can be
        // delivered immediately (no second-trip). Returns void; we
        // refresh permission state afterwards.
        await registerNativePush();
        const raw = await getNativePermission();
        setPermission((raw === "prompt" || raw === "prompt-with-rationale") ? "default" : raw);
      } else {
        await ensurePermission();
        setPermission(getPermission());
      }
    } finally {
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
        isNative={isNative}
      />

      <Toggle checked={push} onChange={setPush} icon={Bell} title="الإشعارات داخل التطبيق" desc="لكل النشاطات المهمة: الحجوزات، الرسائل، التقييمات" recommended />
      {/* SMS is marked "قريباً" — there is no SMS gateway (Twilio/local
          provider) wired into the backend yet. Showing the toggle as
          actionable would let users disable a delivery channel that
          doesn't exist, then wonder why they aren't getting messages
          they never could have received.

          EMAIL is now live (mig 066 + Resend Edge Function). Transactional
          types — booking_confirmed / booking_cancelled / trip_cancelled /
          trip_reminder — fire emails to opted-in users. So the email
          toggle is actionable: NULL or true → user gets transactional
          emails; false → all transactional emails are skipped silently. */}
      <Toggle checked={sms} onChange={setSms} icon={MessageSquare} title="الرسائل النصية SMS" desc="للحجوزات الجديدة والإلغاءات فقط" comingSoon />
      <Toggle checked={email} onChange={setEmail} icon={Mail} title="البريد الإلكتروني" desc="تأكيد الحجوزات، الإلغاءات، تذكير الرحلات" />
      <Toggle checked={marketing} onChange={setMarketing} icon={Megaphone} title="العروض والتسويق" desc="عروض خاصة، ميزات جديدة، أخبار مشواروو" />

      <Button onClick={save} disabled={saving} className="w-full rounded-xl bg-primary text-primary-foreground mt-4">
        {saving ? "جاري الحفظ..." : "تأكيد"}
      </Button>
    </div>
  );
}
