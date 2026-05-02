import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Briefcase, Users } from "lucide-react";
import { toast } from "sonner";

/**
 * VehicleDetailsSection — luggage size + back row seating.
 * Saves to profiles: vehicle_luggage, vehicle_back_row
 */
export default function VehicleDetailsSection({ user, onSaved }) {
  const [luggage, setLuggage] = useState(user?.vehicle_luggage || "m");
  const [backRow, setBackRow] = useState(user?.vehicle_back_row || 3);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLuggage(user?.vehicle_luggage || "m");
    setBackRow(user?.vehicle_back_row || 3);
  }, [user?.vehicle_luggage, user?.vehicle_back_row]);

  const save = async () => {
    if (!user?.email) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ vehicle_luggage: luggage, vehicle_back_row: backRow })
        .eq("email", user.email);
      if (error) throw error;
      toast.success("تم حفظ تفاصيل السيارة ✅");
      onSaved?.();
    } catch {
      toast.error("تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const luggageOpts = [
    { id: "none", label: "بدون أمتعة" },
    { id: "s",    label: "صغيرة (S)" },
    { id: "m",    label: "متوسطة (M)" },
    { id: "l",    label: "كبيرة (L)" },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">إعدادات السيارة الإضافية تساعد الركاب على اختيار الرحلة المناسبة</p>

      <div>
        <h4 className="font-bold text-sm text-foreground mb-3">حجم الأمتعة المسموح</h4>
        <div className="grid grid-cols-4 gap-2">
          {luggageOpts.map(opt => (
            <button
              key={opt.id}
              onClick={() => setLuggage(opt.id)}
              className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                luggage === opt.id
                  ? "bg-primary/10 border-primary text-primary"
                  : "bg-card border-border text-muted-foreground"
              }`}
            >
              <Briefcase className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-tight">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-bold text-sm text-foreground mb-1">المقعد الخلفي</h4>
        <p className="text-xs text-green-600 mb-3 font-medium">💡 وضع راكبين فقط في الخلف يزيد الحجوزات بـ 50%</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setBackRow(2)}
            className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 ${backRow === 2 ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
          >
            <Users className="w-4 h-4" />
            <span className="text-sm font-bold">راكبان فقط</span>
          </button>
          <button
            onClick={() => setBackRow(3)}
            className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 ${backRow === 3 ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
          >
            <Users className="w-4 h-4" />
            <span className="text-sm font-bold">3 ركاب</span>
          </button>
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="w-full rounded-xl bg-primary text-primary-foreground">
        {saving ? "جاري الحفظ..." : "حفظ تفاصيل السيارة"}
      </Button>
    </div>
  );
}
