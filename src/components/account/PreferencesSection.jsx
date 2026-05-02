import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Cigarette, MessageCircle, MessageSquare, Moon, Dog } from "lucide-react";
import { toast } from "sonner";

/**
 * PreferencesSection — smoking, chattiness, pets toggles.
 * Saves to profiles: pref_smoking, pref_chattiness, pref_pets
 */
export default function PreferencesSection({ user, onSaved }) {
  const [smoking, setSmoking] = useState(user?.pref_smoking || "no");
  const [chat, setChat] = useState(user?.pref_chattiness || "okay");
  const [pets, setPets] = useState(user?.pref_pets || false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSmoking(user?.pref_smoking || "no");
    setChat(user?.pref_chattiness || "okay");
    setPets(user?.pref_pets || false);
  }, [user?.pref_smoking, user?.pref_chattiness, user?.pref_pets]);

  const save = async () => {
    if (!user?.email) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ pref_smoking: smoking, pref_chattiness: chat, pref_pets: pets })
        .eq("email", user.email);
      if (error) throw error;
      toast.success("تم حفظ التفضيلات ✅");
      onSaved?.();
    } catch (e) {
      toast.error("تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const Tile = ({ active, onClick, icon: Icon, label }) => (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all ${
        active
          ? "bg-primary/10 border-primary text-primary"
          : "bg-card border-border text-muted-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className={`w-7 h-7 ${active ? "" : "opacity-50"}`} />
      <span className="text-xs font-medium text-center">{label}</span>
    </button>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">ستظهر هذه التفضيلات على ملفك الشخصي وعلى رحلاتك</p>

      <div>
        <h4 className="font-bold text-sm text-foreground mb-3">التدخين</h4>
        <div className="grid grid-cols-2 gap-3">
          <Tile active={smoking === "no"} onClick={() => setSmoking("no")} icon={Cigarette} label="لا تدخين" />
          <Tile active={smoking === "ok"} onClick={() => setSmoking("ok")} icon={Cigarette} label="التدخين مسموح" />
        </div>
      </div>

      <div>
        <h4 className="font-bold text-sm text-foreground mb-3">المحادثة أثناء الرحلة</h4>
        <div className="grid grid-cols-3 gap-2">
          <Tile active={chat === "quiet"} onClick={() => setChat("quiet")} icon={Moon} label="أحب الهدوء" />
          <Tile active={chat === "okay"} onClick={() => setChat("okay")} icon={MessageCircle} label="لا مانع من الحديث" />
          <Tile active={chat === "chatty"} onClick={() => setChat("chatty")} icon={MessageSquare} label="أحب الحديث" />
        </div>
      </div>

      <div>
        <h4 className="font-bold text-sm text-foreground mb-3">الحيوانات الأليفة</h4>
        <div className="grid grid-cols-2 gap-3">
          <Tile active={pets === true} onClick={() => setPets(true)} icon={Dog} label="مسموح" />
          <Tile active={pets === false} onClick={() => setPets(false)} icon={Dog} label="غير مسموح" />
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="w-full rounded-xl bg-primary text-primary-foreground">
        {saving ? "جاري الحفظ..." : "حفظ التفضيلات"}
      </Button>
    </div>
  );
}
