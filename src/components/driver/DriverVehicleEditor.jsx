import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, Save, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const COLORS = ["أبيض", "أسود", "فضي", "رمادي", "أحمر", "أزرق", "بيج"];

export default function DriverVehicleEditor({ trips }) {
  const qc = useQueryClient();
  const lastTrip = trips[0];

  const [form, setForm] = useState({
    car_model: lastTrip?.car_model || "",
    car_year: lastTrip?.car_year || "",
    car_color: lastTrip?.car_color || "",
    car_plate: lastTrip?.car_plate || "",
    car_image: lastTrip?.car_image || "",
    driver_name: lastTrip?.driver_name || "",
    driver_note: lastTrip?.driver_note || "",
  });

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      set("car_image", file_url);
      toast.success("تم رفع الصورة بنجاح ✅");
    } catch {
      toast.error("فشل رفع الصورة، حاول مجدداً");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!lastTrip) return toast.error("أنشئ رحلة أولاً لحفظ بيانات المركبة");
    setSaving(true);
    try {
      await base44.entities.Trip.update(lastTrip.id, form);
      qc.invalidateQueries({ queryKey: ["trips"] });
      toast.success("تم حفظ بيانات المركبة بنجاح ✅");
    } finally {
      setSaving(false);
    }
  };

  const set = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  return (
    <div className="max-w-2xl space-y-6">
      {/* Car preview */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="relative h-44 bg-muted flex items-center justify-center">
          {form.car_image ? (
            <img src={form.car_image} alt="المركبة" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center text-muted-foreground">
              <Car className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد صورة للمركبة</p>
            </div>
          )}
        </div>
        <div className="p-4">
          <label className="block text-sm font-medium mb-2">صورة المركبة</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
          <Button
            variant="outline"
            className="w-full rounded-xl gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> جاري الرفع...</>
            ) : (
              <><Camera className="w-4 h-4" /> رفع صورة المركبة</>
            )}
          </Button>
        </div>
      </div>

      {/* Vehicle Details */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <Car className="w-4 h-4 text-primary" />
          بيانات المركبة
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">موديل السيارة</label>
            <Input
              placeholder="مثال: كيا سيراتو"
              value={form.car_model}
              onChange={(e) => set("car_model", e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">سنة الصنع</label>
            <Input
              placeholder="مثال: 2020"
              value={form.car_year}
              onChange={(e) => set("car_year", e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">لون السيارة</label>
            <select
              value={form.car_color}
              onChange={(e) => set("car_color", e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-muted/50 border border-input text-sm"
            >
              <option value="">اختر اللون</option>
              {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">رقم اللوحة</label>
            <Input
              placeholder="مثال: 6-1234-95"
              value={form.car_plate}
              onChange={(e) => set("car_plate", e.target.value)}
              className="rounded-xl"
            />
          </div>
        </div>
      </div>

      {/* Driver Info */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h3 className="font-bold text-foreground mb-4">معلومات السائق</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">الاسم</label>
            <Input
              placeholder="اسمك الكامل"
              value={form.driver_name}
              onChange={(e) => set("driver_name", e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ملاحظة للركاب</label>
            <textarea
              rows={3}
              placeholder="اكتب ملاحظة للركاب..."
              value={form.driver_note}
              onChange={(e) => set("driver_note", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-input bg-transparent text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="w-full h-11 bg-primary text-primary-foreground rounded-xl font-medium gap-2"
      >
        <Save className="w-4 h-4" />
        {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
      </Button>
    </div>
  );
}