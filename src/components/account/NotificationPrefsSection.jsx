import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Bell, Mail, MessageSquare, Megaphone } from "lucide-react";
import { toast } from "sonner";

/**
 * NotificationPrefsSection — push, email, SMS, marketing toggles.
 * Saves to profiles: notif_push, notif_email, notif_sms, notif_marketing
 */
export default function NotificationPrefsSection({ user, onSaved }) {
  const [push, setPush]            = useState(user?.notif_push !== false);
  const [email, setEmail]          = useState(user?.notif_email !== false);
  const [sms, setSms]              = useState(user?.notif_sms === true);
  const [marketing, setMarketing]  = useState(user?.notif_marketing === true);
  const [saving, setSaving]        = useState(false);

  useEffect(() => {
    setPush(user?.notif_push !== false);
    setEmail(user?.notif_email !== false);
    setSms(user?.notif_sms === true);
    setMarketing(user?.notif_marketing === true);
  }, [user?.notif_push, user?.notif_email, user?.notif_sms, user?.notif_marketing]);

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
      onSaved?.();
    } catch {
      toast.error("تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({ checked, onChange, icon: Icon, title, desc, recommended }) => (
    <div className="flex items-start gap-3 py-4 border-b border-border/50">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-bold text-sm text-foreground">{title}</p>
          {recommended && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">⭐ موصى به</span>}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? "bg-primary" : "bg-muted"}`}
        role="switch" aria-checked={checked}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all ${checked ? "right-0.5" : "right-[1.4rem]"}`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-4">اختر كيف تود أن نتواصل معك</p>

      <Toggle checked={push} onChange={setPush} icon={Bell} title="الإشعارات داخل التطبيق" desc="لكل النشاطات المهمة: الحجوزات، الرسائل، التقييمات" recommended />
      <Toggle checked={sms} onChange={setSms} icon={MessageSquare} title="الرسائل النصية SMS" desc="للحجوزات الجديدة والإلغاءات فقط" />
      <Toggle checked={email} onChange={setEmail} icon={Mail} title="البريد الإلكتروني" desc="لكل النشاطات المهمة: الحجوزات، الرسائل، التقييمات" />
      <Toggle checked={marketing} onChange={setMarketing} icon={Megaphone} title="العروض والتسويق" desc="عروض خاصة، ميزات جديدة، أخبار مِشوارو" />

      <Button onClick={save} disabled={saving} className="w-full rounded-xl bg-primary text-primary-foreground mt-4">
        {saving ? "جاري الحفظ..." : "تأكيد"}
      </Button>
    </div>
  );
}
