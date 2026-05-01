import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Trash2, Plus, Eye, EyeOff, Upload, ImageIcon, CheckCircle } from "lucide-react";

const DEFAULT_SLIDES = [
  { city: "القدس",   subtitle: "المدينة المقدسة",        img: "https://images.unsplash.com/photo-1552423314-cf29ab68ad73?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "بيت لحم", subtitle: "مهد المسيح",             img: "https://images.unsplash.com/photo-1549900932-5f7a1f04e17f?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "نابلس",   subtitle: "جبل النار",               img: "https://images.unsplash.com/photo-1578895101408-1a36b834405b?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "أريحا",   subtitle: "أقدم مدينة في العالم",   img: "https://images.unsplash.com/photo-1518684079-3c830dcef090?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "الخليل",  subtitle: "مدينة الآباء",            img: "https://images.unsplash.com/photo-1580834341580-8c17a3a630ca?w=1400&h=800&fit=crop&q=80", active: true },
  { city: "غزة",     subtitle: "عروس البحر",              img: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1400&h=800&fit=crop&q=80", active: true },
];

function SlideCard({ slide, idx, onUpdate, onDelete, onMove, isFirst, isLast }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error("الصورة يجب أن تكون أقل من 8MB"); return; }
    if (!file.type.startsWith("image/")) { toast.error("يرجى رفع صورة فقط"); return; }
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onUpdate("img", file_url);
      toast.success("✅ تم رفع الصورة بنجاح");
    } catch { toast.error("فشل رفع الصورة، حاول مجدداً"); }
    finally { setUploading(false); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className={`bg-card border-2 rounded-2xl overflow-hidden transition-all ${slide.active ? "border-border" : "border-dashed border-muted"}`}
      dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-black flex items-center justify-center">{idx + 1}</span>
          <Input value={slide.city} onChange={(e) => onUpdate("city", e.target.value)}
            placeholder="اسم المدينة" className="h-7 text-sm font-bold border-0 bg-transparent p-0 focus-visible:ring-0 w-28" />
          <span className="text-muted-foreground text-xs">—</span>
          <Input value={slide.subtitle} onChange={(e) => onUpdate("subtitle", e.target.value)}
            placeholder="وصف قصير" className="h-7 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 flex-1" />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={isFirst} className="p-1 hover:bg-muted rounded disabled:opacity-20 text-xs">▲</button>
          <button onClick={() => onMove(1)} disabled={isLast} className="p-1 hover:bg-muted rounded disabled:opacity-20 text-xs">▼</button>
          <button onClick={() => onUpdate("active", !slide.active)} className="p-1 hover:bg-muted rounded text-muted-foreground" title={slide.active ? "إخفاء" : "إظهار"}>
            {slide.active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4 opacity-40" />}
          </button>
          <button onClick={onDelete} className="p-1 hover:bg-destructive/10 rounded text-destructive">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-4 p-4">
        {/* Upload Zone — PROMINENT */}
        <div
          className={`relative w-48 h-28 rounded-xl border-2 border-dashed transition-all cursor-pointer shrink-0 overflow-hidden
            ${dragOver ? "border-primary bg-primary/10 scale-105" : slide.img ? "border-primary/30" : "border-muted-foreground/30 hover:border-primary/50 bg-muted/30"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          {/* Current image */}
          {slide.img && (
            <img src={slide.img} alt={slide.city} className="absolute inset-0 w-full h-full object-cover" />
          )}

          {/* Upload overlay */}
          <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all
            ${slide.img ? "bg-black/50 opacity-0 hover:opacity-100" : "opacity-100"}`}>
            {uploading ? (
              <div className="text-center text-white">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-1" />
                <span className="text-xs">جاري الرفع...</span>
              </div>
            ) : (
              <div className={`text-center ${slide.img ? "text-white" : "text-muted-foreground"}`}>
                <Upload className="w-6 h-6 mx-auto mb-1" />
                <span className="text-xs font-bold block">اضغط أو اسحب الصورة</span>
                <span className="text-[10px] opacity-70">JPG • أقل من 8MB</span>
              </div>
            )}
          </div>

          {/* Success badge */}
          {slide.img && !uploading && (
            <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
              <CheckCircle className="w-3 h-3 text-white" />
            </div>
          )}

          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])} />
        </div>

        {/* Right side — upload button + status */}
        <div className="flex flex-col justify-center gap-3 flex-1">
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-xl gap-2 h-10"
            variant={slide.img ? "outline" : "default"}
          >
            <Upload className="w-4 h-4" />
            {uploading ? "جاري الرفع..." : slide.img ? "تغيير الصورة" : "رفع صورة من جهازك"}
          </Button>

          {slide.img ? (
            <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">تم رفع الصورة ✅</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground text-center">
              أو اسحب الصورة مباشرة إلى المربع
            </div>
          )}

          {/* Status badge */}
          <div className={`text-center text-xs rounded-lg py-1 ${slide.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {slide.active ? "🟢 ظاهرة في الصفحة الرئيسية" : "⚫ مخفية"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardHeroSlides() {
  const qc = useQueryClient();

  // Use Supabase directly — bypasses base44 created_by filter
  const { data: settingRow, isLoading } = useQuery({
    queryKey: ["hero-slides-admin"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("id, hero_city_slides").limit(1).single();
      return data || null;
    },
  });

  const slides = (() => {
    try {
      const val = settingRow?.hero_city_slides;
      if (val) return typeof val === "string" ? JSON.parse(val) : val;
    } catch {}
    return DEFAULT_SLIDES;
  })();

  const save = useMutation({
    mutationFn: async (newSlides) => {
      const val = JSON.stringify(newSlides);
      if (settingRow?.id) {
        const { error } = await supabase.from("app_settings").update({ hero_city_slides: val }).eq("id", settingRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert({ hero_city_slides: val });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hero-slides-admin"] });
      qc.invalidateQueries({ queryKey: ["hero-city-slides-public"] });
      toast.success("✅ تم الحفظ");
    },
    onError: (e) => toast.error("فشل الحفظ: " + e.message),
  });

  const updateSlide = (idx, field, value) => {
    const updated = slides.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    save.mutate(updated);
  };

  const deleteSlide = (idx) => save.mutate(slides.filter((_, i) => i !== idx));

  const addSlide = () => save.mutate([...slides, { city: "مدينة جديدة", subtitle: "", img: "", active: false }]);

  const moveSlide = (idx, dir) => {
    const arr = [...slides];
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    save.mutate(arr);
  };

  if (isLoading) return <div className="text-center py-20 text-muted-foreground">جاري التحميل...</div>;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-black">شرائح الصفحة الرئيسية</h2>
          <p className="text-sm text-muted-foreground mt-0.5">ارفع صور المدن — تظهر تلقائياً في الصفحة الرئيسية</p>
        </div>
        <Button onClick={addSlide} className="rounded-xl gap-2" disabled={save.isPending}>
          <Plus className="w-4 h-4" /> مدينة جديدة
        </Button>
      </div>

      {/* Specs */}
      <div className="bg-accent/10 border border-accent/20 rounded-xl p-3 mb-5 flex items-center gap-2 text-sm" dir="rtl">
        <ImageIcon className="w-5 h-5 text-accent shrink-0" />
        <div>
          <span className="font-bold text-accent">مواصفات الصور المثالية: </span>
          <span className="text-muted-foreground">1400×800px • JPG أو PNG • أقل من 8MB • المحتوى في المنتصف</span>
        </div>
      </div>

      <div className="space-y-4">
        {slides.map((slide, idx) => (
          <SlideCard
            key={idx}
            slide={slide}
            idx={idx}
            isFirst={idx === 0}
            isLast={idx === slides.length - 1}
            onUpdate={(field, value) => updateSlide(idx, field, value)}
            onDelete={() => deleteSlide(idx)}
            onMove={(dir) => moveSlide(idx, dir)}
          />
        ))}
      </div>

      <p className="text-xs text-center text-muted-foreground mt-6">
        التغييرات تُحفظ تلقائياً • {slides.filter(s => s.active).length} شريحة ظاهرة من أصل {slides.length}
      </p>
    </div>
  );
}
