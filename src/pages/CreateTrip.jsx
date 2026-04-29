import { CITIES } from "@/lib/cities";
import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import SelectDrawer from "@/components/ui/select-drawer";
import CityAutocomplete from "@/components/shared/CityAutocomplete";
import { Link } from "react-router-dom";
import {
  MapPin, Calendar, Clock, Car, Users, CreditCard, CheckCircle,
  ArrowLeft, ArrowRight, Wifi, Music, Snowflake, Cigarette, Briefcase, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import RouteMap from "@/components/shared/RouteMap";
import { sanitizeText } from "@/lib/validation";

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
  useSEO({ title: "أنشر رحلتك", description: "انشر رحلتك واكسب من طريقك اليومي" });

  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  // Role gate — only drivers (or both) can access this page
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";
  if (user && !isDriver) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">🚗</span>
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">حسابك راكب فقط</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          لنشر الرحلات تحتاج لتفعيل حساب السائق وإكمال التحقق من الوثائق.
        </p>
        <a href="/settings" className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm">
          تفعيل حساب السائق
        </a>
      </div>
    );
  }


  const { data: license } = useQuery({
    queryKey: ["driver-license", user?.email],
    queryFn: () =>
      user?.email
        ? base44.entities.DriverLicense.filter({ driver_email: user.email }, "-created_date", 1)
        : [],
    enabled: !!user?.email,
  });

  const driverLicense = license?.[0];
  const isLicenseApproved = driverLicense?.status === "approved";
  const [formInitialized, setFormInitialized] = React.useState(false);
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
    gender: "",
    amenities: [],
    driver_note: "",
    is_direct: true,
    payment_methods: ["cash"],
    has_checkpoint: false,
    checkpoint_note: "",
    is_recurring: false,
    recurring_days: [],
    // Multi-stop support: array of {city, location, time, price_from_origin, seats_available}
    stops: [],
  });

  // Pre-fill car details from user profile once loaded
  useEffect(() => {
    if (user && !formInitialized) {
      setForm((prev) => ({
        ...prev,
        car_model: user.car_model || "",
        car_year: user.car_year || "",
        car_color: user.car_color || "",
        car_plate: user.car_plate || "",
        gender: user.gender || "",
        driver_note: user.driver_note || "",
      }));
      setFormInitialized(true);
    }
  }, [user, formInitialized]);

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleAmenity = (id) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(id)
        ? prev.amenities.filter((a) => a !== id)
        : [...prev.amenities, id],
    }));
  };

  const togglePaymentMethod = (method) => {
    setForm((prev) => ({
      ...prev,
      payment_methods: prev.payment_methods.includes(method)
        ? prev.payment_methods.filter((m) => m !== method)
        : [...prev.payment_methods, method],
    }));
  };

  const addStop = () => {
    setForm((prev) => ({
      ...prev,
      stops: [...prev.stops, { city: "", location: "", time: "", price_from_origin: 0, seats_available: prev.available_seats || 4 }],
      // A trip with stops is no longer "direct"
      is_direct: false,
    }));
  };

  const updateStop = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      stops: prev.stops.map((s, i) => i === index ? { ...s, [key]: value } : s),
    }));
  };

  const removeStop = (index) => {
    setForm((prev) => {
      const newStops = prev.stops.filter((_, i) => i !== index);
      return { ...prev, stops: newStops, is_direct: newStops.length === 0 };
    });
  };

  const validateStep = (currentStep) => {
    if (currentStep === 1) {
      if (!form.from_city) { toast.error("يرجى اختيار مدينة الانطلاق ⚠️"); return false; }
      if (!form.to_city) { toast.error("يرجى اختيار مدينة الوصول ⚠️"); return false; }
      if (form.from_city === form.to_city) { toast.error("مدينة الانطلاق والوصول لا يمكن أن تكونا نفس المدينة ⚠️"); return false; }
      if (!form.date) { toast.error("يرجى تحديد تاريخ المغادرة ⚠️"); return false; }
      if (!form.time) { toast.error("يرجى تحديد وقت المغادرة ⚠️"); return false; }
      // Validate every stop has city + time
      for (let i = 0; i < form.stops.length; i++) {
        const s = form.stops[i];
        if (!s.city) { toast.error(`المحطة ${i + 1}: يرجى اختيار المدينة ⚠️`); return false; }
        if (!s.time) { toast.error(`المحطة ${i + 1}: يرجى تحديد وقت الوصول ⚠️`); return false; }
        if (s.city === form.from_city || s.city === form.to_city) { toast.error(`المحطة ${i + 1}: لا يمكن أن تكون نفس مدينة الانطلاق أو الوصول ⚠️`); return false; }
      }
    }
    if (currentStep === 3) {
      if (!form.car_model) { toast.error("يرجى إدخال نوع السيارة ⚠️"); return false; }
      if (!form.car_plate) { toast.error("يرجى إدخال رقم اللوحة ⚠️"); return false; }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!user?.id) { toast.error("لم يتم تحميل بيانات المستخدم. حاول مرة أخرى."); return; }
    const baseData = {
      ...form,
      status: "confirmed",
      total_seats: form.available_seats,
      // CRITICAL: link the trip to the driver via UUID (not just email)
      driver_id: user.id,
      driver_name: user?.full_name || user?.email?.split("@")[0] || "سائق",
      driver_avatar: user?.avatar_url || "",
      driver_email: user?.email || "",
      driver_phone: user?.phone || "",
      driver_gender: form.gender || "",
      // Ensure stops is a clean array (no undefined / partial entries)
      stops: (form.stops || []).filter(s => s.city && s.time).map(s => ({
        city: s.city,
        location: s.location || "",
        time: s.time,
        price_from_origin: Number(s.price_from_origin) || 0,
        seats_available: Number(s.seats_available) || form.available_seats,
      })),
    };

    if (form.is_recurring && form.recurring_days.length > 0) {
      // Create a trip for each selected recurring day
      const dayNames = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
      const baseDate = new Date(form.date);
      const promises = form.recurring_days.map(dayIndex => {
        // Find next occurrence of this day of week
        const diff = (dayIndex - baseDate.getDay() + 7) % 7;
        const tripDate = new Date(baseDate);
        tripDate.setDate(baseDate.getDate() + (diff === 0 ? 7 : diff));
        return base44.entities.Trip.create({
          ...baseData,
          date: tripDate.toISOString().split("T")[0],
          driver_note: (baseData.driver_note || "") + " (رحلة يومية - " + dayNames[dayIndex] + ")",
        });
      });
      await Promise.all(promises);
      toast.success(`تم نشر ${form.recurring_days.length} رحلات متكررة بنجاح! 🎉`);
    } else {
      await base44.entities.Trip.create(baseData);
      toast.success("تم نشر الرحلة بنجاح! 🎉");
    }
    navigate("/my-trips");
  };

  const hasExpiredDocuments = () => {
    const today = new Date().toISOString().split('T')[0];
    return (
      (driverLicense?.expiry_date && driverLicense.expiry_date < today) ||
      (driverLicense?.car_registration_expiry_date && driverLicense.car_registration_expiry_date < today) ||
      (driverLicense?.insurance_expiry_date && driverLicense.insurance_expiry_date < today)
    );
  };

  if (!isLicenseApproved || hasExpiredDocuments()) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div className="w-14 h-14 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">{hasExpiredDocuments() ? "⚠️" : "⏳"}</span>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">
            {hasExpiredDocuments() ? "انتهت صلاحية المستندات" : "انتظر موافقة رخصة القيادة"}
          </h2>
          <p className="text-muted-foreground mb-4">
            {hasExpiredDocuments()
              ? "صلاحية المستندات الخاصة بك انتهت. يرجى تحديثها من الإعدادات لتتمكن من نشر الرحلات."
              : driverLicense?.status === "pending"
              ? "رخصتك قيد المراجعة. سيتم إخطارك بمجرد الموافقة عليها."
              : driverLicense?.status === "rejected"
              ? `تم رفض رخصتك: ${driverLicense.rejection_reason}. يمكنك تحديثها من الإعدادات.`
              : "لم تقدم رخصة قيادة بعد. يرجى إكمال الإعداد أولاً."}
          </p>
          <a href="/settings">
            <Button className="bg-primary text-primary-foreground rounded-xl mt-4">
              {hasExpiredDocuments() ? "تحديث المستندات" : "تحديث الرخصة"}
            </Button>
          </a>
        </div>
      </div>
    );
  }

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
                <Label>من <span className="text-destructive">*</span></Label>
                <div className="bg-muted/50 rounded-xl border border-border mt-1">
                  <CityAutocomplete
                    value={form.from_city}
                    onChange={(v) => updateField("from_city", v)}
                    placeholder="اكتب اسم المدينة"
                    iconColor="primary"
                  />
                </div>
              </div>
              <div>
                <Label>إلى <span className="text-destructive">*</span></Label>
                <div className="bg-muted/50 rounded-xl border border-border mt-1">
                  <CityAutocomplete
                    value={form.to_city}
                    onChange={(v) => updateField("to_city", v)}
                    placeholder="اكتب اسم المدينة"
                    iconColor="accent"
                  />
                </div>
              </div>
              <div>
                <Label>تاريخ المغادرة <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className="h-11 rounded-xl mt-1"
                />
              </div>
              <div>
                <Label>وقت المغادرة <span className="text-destructive">*</span></Label>
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => updateField("time", e.target.value)}
                  className="h-11 rounded-xl mt-1"
                />
              </div>
            </div>
            {/* Multi-stop trip support */}
            <div className="border border-border rounded-xl p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Label className="text-sm font-medium">محطات إضافية في الطريق (اختياري)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {form.stops.length === 0
                      ? "أضف محطات إذا كنت ستتوقف بمدن أخرى — يمكن للركاب الصعود أو النزول بأي محطة"
                      : `${form.stops.length} محطة في الطريق — الرحلة ستظهر للركاب الذين يبحثون عبر هذه المدن أيضاً`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addStop}
                  className="rounded-xl shrink-0"
                  disabled={!form.from_city || !form.to_city}
                >
                  + محطة
                </Button>
              </div>
              {form.stops.map((stop, idx) => (
                <div key={idx} className="bg-card rounded-xl border border-border p-3 mb-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">محطة {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeStop(idx)}
                      className="text-xs text-destructive hover:underline"
                      aria-label={`حذف محطة ${idx + 1}`}
                    >
                      حذف
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <CityAutocomplete
                      value={stop.city}
                      onChange={(v) => updateStop(idx, "city", v)}
                      placeholder="مدينة المحطة"
                      iconColor="muted"
                    />
                    <Input
                      type="time"
                      value={stop.time}
                      onChange={(e) => updateStop(idx, "time", e.target.value)}
                      className="h-10 rounded-xl"
                      placeholder="وقت الوصول"
                    />
                    <Input
                      type="text"
                      value={stop.location}
                      onChange={(e) => updateStop(idx, "location", e.target.value)}
                      className="h-10 rounded-xl"
                      placeholder="المكان داخل المدينة (اختياري)"
                    />
                    <Input
                      type="number"
                      value={stop.price_from_origin}
                      onChange={(e) => updateStop(idx, "price_from_origin", e.target.value)}
                      className="h-10 rounded-xl"
                      placeholder="سعر الراكب من البداية إلى هذه المحطة (₪)"
                      min="0"
                    />
                  </div>
                </div>
              ))}
              {form.stops.length === 0 && (
                <div className="text-xs text-center text-muted-foreground py-2">
                  رحلة مباشرة بدون محطات
                </div>
              )}
            </div>

            {/* Route Preview Map — shows when both cities are selected */}
            {form.from_city && form.to_city && form.from_city !== form.to_city && (
              <div>
                <Label className="text-sm font-medium mb-2 block">معاينة المسار</Label>
                <RouteMap
                  fromCity={form.from_city}
                  toCity={form.to_city}
                  stops={form.stops}
                  height="200px"
                  showStats={true}
                  onRouteCalculated={({ distance, duration }) => {
                    updateField("distance", distance);
                    updateField("duration", duration);
                  }}
                />
                {(form.distance || form.duration) && (
                  <p className="text-xs text-muted-foreground mt-1 text-center">
                    تم حساب المسافة والمدة تلقائياً وستُحفظ مع الرحلة
                  </p>
                )}
              </div>
            )}
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
                <Label>نوع السيارة <span className="text-destructive">*</span></Label>
                <Input
                  value={form.car_model}
                  onChange={(e) => updateField("car_model", e.target.value)}
                  placeholder="مثال: كيا سيراتو"
                  className="h-11 rounded-xl mt-1"
                />
              </div>
              <div>
                <Label>الجنس</Label>
                <select
                  value={form.gender}
                  onChange={(e) => updateField("gender", e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-muted/50 border border-border text-sm mt-1"
                >
                  <option value="">اختر الجنس</option>
                  <option value="male">👨 رجل</option>
                  <option value="female">👩 امرأة</option>
                </select>
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
                <Label>رقم اللوحة <span className="text-destructive">*</span></Label>
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
            <div>
              <Label className="mb-3 block">طرق الدفع المقبولة</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "cash", label: "نقداً", icon: "💵" },
                  { id: "bank_transfer", label: "تحويل بنكي", icon: "🏦" },
                  { id: "card", label: "بطاقة ائتمان", icon: "💳" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => togglePaymentMethod(m.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all border ${
                      form.payment_methods.includes(m.id)
                        ? "bg-accent/10 border-accent text-accent"
                        : "bg-card border-border text-muted-foreground hover:border-accent/30"
                    }`}
                  >
                    <span>{m.icon}</span>
                    {m.label}
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

            {/* Checkpoint Warning */}
            <div className="bg-orange-500/10 rounded-xl p-4 border border-orange-500/20">
              <div className="flex items-center gap-2 mb-3">
                <Checkbox
                  checked={form.has_checkpoint}
                  onCheckedChange={(v) => updateField("has_checkpoint", v)}
                />
                <span className="text-sm font-medium">⚠️ المسار يمر بحاجز عسكري</span>
              </div>
              {form.has_checkpoint && (
                <input
                  value={form.checkpoint_note}
                  onChange={(e) => updateField("checkpoint_note", e.target.value)}
                  placeholder="مثال: حاجز قلنديا، عادةً 10-20 دقيقة"
                  className="w-full h-10 px-3 rounded-xl bg-white/50 border border-orange-300 text-sm"
                />
              )}
            </div>

            {/* Recurring Trip */}
            <div className="bg-primary/5 rounded-xl p-4 border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Checkbox
                  checked={form.is_recurring}
                  onCheckedChange={(v) => updateField("is_recurring", v)}
                />
                <span className="text-sm font-medium">🔄 رحلة يومية متكررة</span>
              </div>
              {form.is_recurring && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">اختر أيام التكرار</p>
                  <div className="flex flex-wrap gap-2">
                    {["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"].map((day, i) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const days = form.recurring_days.includes(i)
                            ? form.recurring_days.filter(d => d !== i)
                            : [...form.recurring_days, i];
                          updateField("recurring_days", days);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                          form.recurring_days.includes(i)
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-card border-border text-muted-foreground"
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">سيتم إنشاء رحلة منفصلة لكل يوم محدد</p>
                </div>
              )}
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
            onClick={() => { if (validateStep(step)) setStep(step + 1); }}
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