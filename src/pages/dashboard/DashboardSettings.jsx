import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings, Save, CheckCircle } from "lucide-react";
import { toast } from "sonner";

const defaultSettings = {
  commission_rate: 10,
  min_price: 10,
  max_price: 500,
  max_seats: 6,
  app_name: "مِشوار",
  support_phone: "+970-59-1234567",
  support_email: "support@mishwar.ps",
  allow_registration: true,
  maintenance_mode: false,
};

export default function DashboardSettings() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });

  const existingSettings = settingsArr[0];
  const [form, setForm] = useState(() => ({ ...defaultSettings, ...existingSettings }));

  const saveMutation = useMutation({
    mutationFn: () => existingSettings
      ? base44.entities.AppSettings.update(existingSettings.id, form)
      : base44.entities.AppSettings.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app_settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("تم حفظ الإعدادات");
    },
  });

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-5 max-w-2xl">
      {/* General */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          الإعدادات العامة
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">اسم التطبيق</label>
            <input value={form.app_name} onChange={(e) => update("app_name", e.target.value)}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">نسبة العمولة (%)</label>
            <input type="number" value={form.commission_rate} onChange={(e) => update("commission_rate", parseInt(e.target.value))}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الحد الأدنى للسعر (₪)</label>
            <input type="number" value={form.min_price} onChange={(e) => update("min_price", parseInt(e.target.value))}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الحد الأقصى للسعر (₪)</label>
            <input type="number" value={form.max_price} onChange={(e) => update("max_price", parseInt(e.target.value))}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الحد الأقصى للمقاعد</label>
            <input type="number" value={form.max_seats} onChange={(e) => update("max_seats", parseInt(e.target.value))}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-bold text-sm mb-4">معلومات التواصل</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">رقم الدعم</label>
            <input value={form.support_phone} onChange={(e) => update("support_phone", e.target.value)}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" dir="ltr" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">بريد الدعم</label>
            <input value={form.support_email} onChange={(e) => update("support_email", e.target.value)}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" dir="ltr" />
          </div>
        </div>
      </div>

      {/* Toggles */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-bold text-sm mb-4">إعدادات التشغيل</h3>
        <div className="space-y-3">
          {[
            { key: "allow_registration", label: "السماح بالتسجيل الجديد", desc: "السماح لمستخدمين جدد بإنشاء حسابات" },
            { key: "maintenance_mode", label: "وضع الصيانة", desc: "إيقاف التطبيق مؤقتاً للصيانة" },
          ].map((toggle) => (
            <div key={toggle.key} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div>
                <p className="text-sm font-medium">{toggle.label}</p>
                <p className="text-xs text-muted-foreground">{toggle.desc}</p>
              </div>
              <button
                onClick={() => update(toggle.key, !form[toggle.key])}
                className={`w-11 h-6 rounded-full transition-colors relative ${form[toggle.key] ? "bg-primary" : "bg-muted-foreground/30"}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form[toggle.key] ? "right-0.5" : "left-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <Button
        className="gap-2 rounded-xl"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        {saved ? <><CheckCircle className="w-4 h-4" />تم الحفظ</> : <><Save className="w-4 h-4" />حفظ الإعدادات</>}
      </Button>
    </div>
  );
}