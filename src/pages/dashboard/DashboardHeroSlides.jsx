import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Trash2, Plus, GripVertical, Eye, EyeOff, Upload, ImageIcon } from "lucide-react";

const DEFAULT_SLIDES = [
  { city: "القدس", subtitle: "المدينة المقدسة", img: "https://images.unsplash.com/photo-1552423314-cf29ab68ad73?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "بيت لحم", subtitle: "مهد المسيح", img: "https://images.unsplash.com/photo-1549900932-5f7a1f04e17f?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "نابلس", subtitle: "جبل النار", img: "https://images.unsplash.com/photo-1578895101408-1a36b834405b?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "أريحا", subtitle: "أقدم مدينة في العالم", img: "https://images.unsplash.com/photo-1518684079-3c830dcef090?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "الخليل", subtitle: "مدينة الآباء", img: "https://images.unsplash.com/photo-1580834341580-8c17a3a630ca?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "غزة", subtitle: "عروس البحر", img: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1400&h=800&fit=crop&q=80", active: true },
];

export default function DashboardHeroSlides() {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(null); // index being uploaded

  // Load slides from app_settings
  const { data: setting } = useQuery({
    queryKey: ["hero-slides-setting"],
    queryFn: async () => {
      const results = await base44.entities.AppSettings.filter({ key: "hero_city_slides" }, "-created_at", 1);
      return results?.[0] || null;
    },
  });

  const slides = (() => {
    try { return JSON.parse(setting?.value || "null") || DEFAULT_SLIDES; }
    catch { return DEFAULT_SLIDES; }
  })();

  const saveMutation = useMutation({
    mutationFn: async (newSlides) => {
      const val = JSON.stringify(newSlides);
      if (setting?.id) {
        await base44.entities.AppSettings.update(setting.id, { value: val });
      } else {
        await base44.entities.AppSettings.create({ key: "hero_city_slides", value: val, label: "صور المدن في الصفحة الرئيسية" });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hero-slides-setting"] });
      qc.invalidateQueries({ queryKey: ["hero-slides"] });
      toast.success("✅ تم حفظ الشرائح بنجاح");
    },
    onError: () => toast.error("فشل الحفظ"),
  });

  const updateSlide = (idx, field, value) => {
    const updated = slides.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    saveMutation.mutate(updated);
  };

  const deleteSlide = (idx) => {
    saveMutation.mutate(slides.filter((_, i) => i !== idx));
  };

  const addSlide = () => {
    saveMutation.mutate([...slides, { city: "مدينة جديدة", subtitle: "", img: "", active: true }]);
  };

  const moveSlide = (idx, dir) => {
    const arr = [...slides];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    saveMutation.mutate(arr);
  };

  const uploadImage = async (file, idx) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("الصورة يجب أن تكون أقل من 5MB"); return; }
    if (!file.type.startsWith("image/")) { toast.error("يرجى رفع صورة فقط"); return; }
    setUploading(idx);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      updateSlide(idx, "img", file_url);
      toast.success("✅ تم رفع الصورة");
    } catch { toast.error("فشل رفع الصورة"); }
    finally { setUploading(null); }
  };

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-black">شرائح الصفحة الرئيسية</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            صور المدن التي تظهر في أعلى الصفحة الرئيسية — مقاس 1400×800px
          </p>
        </div>
        <Button onClick={addSlide} className="rounded-xl gap-2" disabled={saveMutation.isPending}>
          <Plus className="w-4 h-4" /> إضافة مدينة
        </Button>
      </div>

      {/* Image spec reminder */}
      <div className="bg-accent/10 border border-accent/30 rounded-xl p-3 mb-6 flex items-center gap-3">
        <ImageIcon className="w-5 h-5 text-accent shrink-0" />
        <div className="text-sm">
          <span className="font-bold text-accent">مواصفات الصور: </span>
          <span className="text-muted-foreground">1400×800px • JPG • أقل من 500KB • المحتوى في المنتصف</span>
        </div>
      </div>

      <div className="space-y-4">
        {slides.map((slide, idx) => (
          <div key={idx}
            className={`bg-card border-2 rounded-2xl overflow-hidden transition-all ${slide.active ? "border-border" : "border-dashed border-muted opacity-60"}`}>
            <div className="flex">
              {/* Preview */}
              <div className="w-32 h-24 shrink-0 relative bg-muted">
                {slide.img ? (
                  <img src={slide.img} alt={slide.city}
                    className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <ImageIcon className="w-8 h-8 opacity-30" />
                  </div>
                )}
                {/* Upload overlay */}
                <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                  <div className="text-white text-center">
                    {uploading === idx ? (
                      <div className="text-[10px]">جاري الرفع...</div>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 mx-auto mb-0.5" />
                        <div className="text-[10px]">رفع صورة</div>
                      </>
                    )}
                  </div>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => uploadImage(e.target.files?.[0], idx)}
                    disabled={uploading !== null} />
                </label>
              </div>

              {/* Fields */}
              <div className="flex-1 p-3 space-y-2">
                <div className="flex gap-2">
                  <Input value={slide.city}
                    onChange={(e) => updateSlide(idx, "city", e.target.value)}
                    placeholder="اسم المدينة" className="rounded-lg h-8 text-sm font-bold flex-1" />
                  <Input value={slide.subtitle}
                    onChange={(e) => updateSlide(idx, "subtitle", e.target.value)}
                    placeholder="وصف قصير" className="rounded-lg h-8 text-sm flex-1" />
                </div>
                <Input value={slide.img}
                  onChange={(e) => updateSlide(idx, "img", e.target.value)}
                  placeholder="رابط الصورة (أو ارفع من الصورة على اليسار)" className="rounded-lg h-8 text-xs text-muted-foreground" />
              </div>

              {/* Controls */}
              <div className="flex flex-col justify-center gap-1 px-2 border-r border-border">
                <button onClick={() => moveSlide(idx, -1)} disabled={idx === 0}
                  className="p-1 hover:bg-muted rounded disabled:opacity-30 text-muted-foreground text-xs">▲</button>
                <button onClick={() => moveSlide(idx, 1)} disabled={idx === slides.length - 1}
                  className="p-1 hover:bg-muted rounded disabled:opacity-30 text-muted-foreground text-xs">▼</button>
                <button onClick={() => updateSlide(idx, "active", !slide.active)}
                  className="p-1 hover:bg-muted rounded text-muted-foreground"
                  title={slide.active ? "إخفاء" : "إظهار"}>
                  {slide.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => deleteSlide(idx)}
                  className="p-1 hover:bg-destructive/10 rounded text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-4 text-center">
        التغييرات تُحفظ تلقائياً عند كل تعديل • تظهر في الصفحة الرئيسية فوراً
      </p>
    </div>
  );
}
