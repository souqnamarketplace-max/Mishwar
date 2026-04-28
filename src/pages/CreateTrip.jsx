import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MapPin, Calendar, Clock, Car, Users, CreditCard, CheckCircle,
  ArrowLeft, ArrowRight, Wifi, Music, Snowflake, Cigarette, Briefcase
} from "lucide-react";
import { toast } from "sonner";

const CITIES = ["رام الله", "نابلس", "الخليل", "بيت لحم", "غزة", "جنين", "طولكرم", "قلقيلية"];

const steps = [
  { id: 1, label: "تفاصيل الرحلة", icon: MapPin },
  { id: 2, label: "المقاعد والسعر", icon: Users },
  { id: 3, label: "معلومات إضافية", icon: Car },
  { id: 4, label: "مراجعة ونشر", icon: CheckCircle },
];

const amenitiesList = [
  { id: "wifi", label: "Wi-Fi", icon: Wifi },
  { id: "ac", label: "تكييف", icon: Snowflake },
  { id: "music", label: "موسيقى", icon: Music },
  { id: "smoking", label: "مسموح بالتدخين", icon: Cigarette },
  { id: "luggage", label: "متاح للأمتعة", icon: Briefcase },
];

export default function CreateTrip() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });
  const [form, setForm] = useState({
    from_city: "",
    to_city: "",
    date: "",
    time: "",
    available_seats: 3,
    price: 50,
    car_model: "",
    car_year: "",
    car_color: "",
    car_plate: "",
    amenities: [],
    driver_note: "",
    is_direct: true,
  });

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleAmenity = (id) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(id)
        ? prev.amenities.filter((a) => a !== id)
        : [...prev.amenities, id],
    }));
  };

  const handleSubmit = async () => {
    const tripData = {
      ...form,
      status: "confirmed",
      total_seats: form.available_seats,
      driver_name: user?.full_name || user?.email?.split("@")[0] || "سائق",
      driver_avatar: user?.avatar_url || "",
      driver_email: user?.email || "",
    };
    await base44.entities.Trip.create(tripData);
    toast.success("تم نشر الرحلة بنجاح!");
    navigate("/my-trips");
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">كيف تنشر رحلة ؟</h1>
        <p className="text-muted-foreground">شارك مقاعدك الفارغة وساعد الآخرين على الوصول بأمان وراحة</p>
      </div>

      {/* Steps */}
      <div className="flex items-center justify-between mb-10">
        {steps.map((s, i) => (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                step >= s.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}>
                {step > s.id ? <CheckCircle className="w-5 h-5" /> : s.id}
              </div>
              <span className="text-xs text-muted-foreground mt-1 hidden sm:block">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${step > s.id ? "bg-primary" : "bg-border"}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step Content */}
      <div className="bg-card rounded-2xl border border-border p-6 mb-6">
        {step === 1 && (
          <div className="space-y-5">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center">1</span>
              تفاصيل الرحلة
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>من</Label>
                <select
                  value={form.from_city}
                  onChange={(e) => updateField("from_city", e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-muted/50 border border-border text-sm mt-1"
                >
                  <option value="">اختر المدينة</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label>إلى</Label>
                <select
                  value={form.to_city}
                  onChange={(e) => updateField("to_city", e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-muted/50 border border-border text-sm mt-1"
                >
                  <option value="">اختر المدينة</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label>تاريخ المغادرة</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className="h-11 rounded-xl mt-1"
                />
              </div>
              <div>
                <Label>وقت المغادرة</Label>
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => updateField("time", e.target.value)}
                  className="h-11 rounded-xl mt-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.is_direct}
                onCheckedChange={(v) => updateField("is_direct", v)}
              />
              <span className="text-sm">ذهاب فقط</span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center">2</span>
              المقاعد والسعر
            </h3>
            <div>
              <Label>عدد المقاعد المتاحة</Label>
              <div className="flex items-center gap-4 mt-2">
                <Button variant="outline" size="icon" className="rounded-xl"
                  onClick={() => updateField("available_seats", Math.max(1, form.available_seats - 1))}>
                  -
                </Button>
                <span className="text-2xl font-bold w-10 text-center">{form.available_seats}</span>
                <Button variant="outline" size="icon" className="rounded-xl"
                  onClick={() => updateField("available_seats", Math.min(6, form.available_seats + 1))}>
                  +
                </Button>
              </div>
            </div>
            <div>
              <Label>السعر للمقعد الواحد (₪)</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) => updateField("price", parseInt(e.target.value))}
                className="h-11 rounded-xl mt-1 max-w-xs"
              />
            </div>
            <div className="p-4 bg-primary/5 rounded-xl">
              <p className="text-sm text-muted-foreground">إجمالي الربح المتوقع</p>
              <p className="text-2xl font-bold text-primary">₪{form.price * form.available_seats}</p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center">3</span>
              معلومات إضافية
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>نوع السيارة</Label>
                <Input
                  value={form.car_model}
                  onChange={(e) => updateField("car_model", e.target.value)}
                  placeholder="مثال: كيا سيراتو"
                  className="h-11 rounded-xl mt-1"
                />
              </div>
              <div>
                <Label>سنة الصنع</Label>
                <Input
                  value={form.car_year}
                  onChange={(e) => updateField("car_year", e.target.value)}
                  placeholder="مثال: 2020"
                  className="h-11 rounded-xl mt-1"
                />
              </div>
              <div>
                <Label>اللون</Label>
                <Input
                  value={form.car_color}
                  onChange={(e) => updateField("car_color", e.target.value)}
                  placeholder="مثال: فضي"
                  className="h-11 rounded-xl mt-1"
                />
              </div>
              <div>
                <Label>رقم اللوحة</Label>
                <Input
                  value={form.car_plate}
                  onChange={(e) => updateField("car_plate", e.target.value)}
                  placeholder="مثال: 6-1234-95"
                  className="h-11 rounded-xl mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="mb-3 block">مرافق متاحة</Label>
              <div className="flex flex-wrap gap-2">
                {amenitiesList.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => toggleAmenity(a.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all border ${
                      form.amenities.includes(a.id)
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    <a.icon className="w-4 h-4" />
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center">4</span>
              مراجعة ونشر
            </h3>
            <div className="bg-muted/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-foreground font-bold text-lg">
                <MapPin className="w-5 h-5 text-primary" />
                <span>{form.from_city || "—"}</span>
                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                <span>{form.to_city || "—"}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">التاريخ:</span> {form.date || "—"}</div>
                <div><span className="text-muted-foreground">الوقت:</span> {form.time || "—"}</div>
                <div><span className="text-muted-foreground">المقاعد:</span> {form.available_seats}</div>
                <div><span className="text-muted-foreground">السعر:</span> ₪{form.price}</div>
                <div><span className="text-muted-foreground">السيارة:</span> {form.car_model || "—"} {form.car_year}</div>
                <div><span className="text-muted-foreground">اللوحة:</span> {form.car_plate || "—"}</div>
              </div>
            </div>
            <div>
              <Label>ملاحظات للمسافرين</Label>
              <textarea
                value={form.driver_note}
                onChange={(e) => updateField("driver_note", e.target.value)}
                placeholder="أضف ملاحظة للمسافرين..."
                className="w-full h-24 mt-1 px-4 py-3 rounded-xl bg-muted/50 border border-border text-sm resize-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          className="rounded-xl gap-2"
          onClick={() => setStep(Math.max(1, step - 1))}
          disabled={step === 1}
        >
          <ArrowRight className="w-4 h-4" />
          السابق
        </Button>
        {step < 4 ? (
          <Button
            className="rounded-xl bg-primary text-primary-foreground gap-2"
            onClick={() => setStep(step + 1)}
          >
            التالي
            <ArrowLeft className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            className="rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground gap-2 px-8"
            onClick={handleSubmit}
          >
            <CheckCircle className="w-4 h-4" />
            انشر الرحلة
          </Button>
        )}
      </div>
    </div>
  );
}