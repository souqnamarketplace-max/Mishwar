import { CITIES } from "@/lib/cities";
import DateInput from "@/components/shared/DateInput";
import { checkDriverConflict } from "@/lib/tripScheduling";
import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { friendlyError } from "@/lib/errors";
import RouteMap from "@/components/shared/RouteMap";
import { sanitizeText, todayISO, isFutureOrToday } from "@/lib/validation";

import { checkDriverEligibility, daysUntil } from "@/lib/driverEligibility";
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

// ── Notify users whose route preference matches a new trip ───────────────────
async function notifyMatchingPreferences(trip) {
  try {
    // Fetch all active preferences
    const prefs = await base44.entities.TripPreference.filter({ is_active: true }, "-created_date", 500);
    if (!prefs?.length) return;

    const tripStops = Array.isArray(trip.stops) ? trip.stops.map(s => s?.city).filter(Boolean) : [];
    const tripCities = [trip.from_city, ...tripStops, trip.to_city];

    const matches = prefs.filter(p => {
      if (!p.from_city || !p.to_city || !p.user_email) return false;
      // Don't notify the driver about their own trip
      if (p.user_email === trip.driver_email) return false;
      // Check if from_city appears before to_city in trip sequence
      const fromIdx = tripCities.findIndex(c => c === p.from_city);
      const toIdx   = tripCities.findIndex(c => c === p.to_city);
      return fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx;
    });

    if (!matches.length) return;

    // Send notification to each matching user (in parallel, silently)
    await Promise.allSettled(matches.map(pref =>
      base44.entities.Notification.create({
        user_email: pref.user_email,
        title: `رحلة جديدة: ${trip.from_city} ← ${trip.to_city} 🚗`,
        message: `${trip.driver_name || "سائق"} ينشر رحلة من ${trip.from_city} إلى ${trip.to_city} بتاريخ ${trip.date} الساعة ${trip.time}. السعر: ₪${trip.price} للمقعد.`,
        type: "new_trip",
        trip_id: trip.id,
        is_read: false,
      })
    ));
  } catch (e) {
    // Silent — never block trip creation
    console.warn("[TripMatch] notification failed:", e?.message);
  }
}

export default function CreateTrip() {
  const qc = useQueryClient();
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
        <Link to="/become-driver" className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm">
          تفعيل حساب السائق
        </Link>
      </div>
    );
  }


  const { data: licenses = [] } = useQuery({
    queryKey: ["driver-licenses-all", user?.email],
    queryFn: () =>
      user?.email
        ? base44.entities.DriverLicense.filter({ driver_email: user.email }, "-created_date", 10)
        : [],
    enabled: !!user?.email,
  });

  // Subscription gate — when the kill switch is on, drivers must have an
  // active subscription to publish trips. RPC returns { status: 'not_required' }
  // when the kill switch is off, which makes the eligibility check a no-op.
  // If the RPC doesn't exist (migration 009 not applied yet), we treat the
  // missing function as 'not_required' so older deployments still work.
  const { data: subscriptionStatus = null } = useQuery({
    queryKey: ["subscription-status", user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      const { supabase } = await import("@/lib/supabase");
      const { data, error } = await supabase.rpc("driver_subscription_status", {
        p_driver_email: user.email,
      });
      if (error) {
        if (
          error.code === "PGRST202" ||
          /function .* does not exist/i.test(error.message || "") ||
          /not found/i.test(error.message || "")
        ) {
          return { status: "not_required", allowed: true };
        }
        throw error;
      }
      return data;
    },
    enabled: !!user?.email,
    retry: 0,
    staleTime: 30_000,
  });

  // Determine eligibility based on full license history + subscription state.
  // Subscription block takes precedence over license-allowed states.
  const eligibility = React.useMemo(
    () => checkDriverEligibility(licenses, subscriptionStatus),
    [licenses, subscriptionStatus]
  );
  const driverLicense = eligibility.latest || licenses?.[0]; // for prefilling form fields
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
    // Driver preferences applied to THIS trip. Default to the safer/quieter
    // option so a driver who never edits the form still publishes a
    // reasonable trip (no smoking, no pets, neutral chat). The pre-fill
    // effect below overwrites these from the driver's profile when loaded
    // so account-level prefs become per-trip defaults.
    pref_smoking: "no",
    pref_chattiness: "okay",
    pref_pets: false,
  });

  // Pre-fill car details + driver preferences from user profile once loaded.
  // Driver-level prefs (smoking / chattiness / pets) become per-trip defaults
  // here. The form lets the driver override per trip — useful for "I usually
  // don't allow smoking but for this airport run with friends it's fine".
  useEffect(() => {
    if (user && !formInitialized) {
      // Resolve each pref with explicit fallback. The `??` operator preserves
      // explicit `false` for pref_pets — we want a driver who set "no pets" to
      // see that selection mirrored, not get reset to the default true.
      const profileSmoking    = user.pref_smoking    || "no";
      const profileChattiness = user.pref_chattiness || "okay";
      const profilePets       = user.pref_pets       ?? false;

      // Auto-populate amenities from driver's saved preferences.
      // Smoking amenity stays in sync with pref_smoking — if the driver's
      // profile says "yes/allowed", the amenity chip is auto-selected; if
      // "no", it stays off. The form lets them flip either way per trip,
      // and the submit handler re-syncs them so they can't disagree on
      // the trip row.
      const amenitiesFromPrefs = [];
      if (profileSmoking === "yes" || profileSmoking === "allowed") amenitiesFromPrefs.push("smoking");
      if (user.vehicle_luggage && user.vehicle_luggage !== "none" && user.vehicle_luggage !== "no") amenitiesFromPrefs.push("luggage");
      // Common amenities most cars have — pre-select for convenience
      amenitiesFromPrefs.push("ac");

      // Auto-populate payment methods based on what driver set up in profile
      const paymentFromProfile = ["cash"]; // cash always available
      if (user.bank_iban) paymentFromProfile.push("bank_transfer");
      if (user.jawwal_pay_number) paymentFromProfile.push("jawwal_pay");
      if (user.reflect_number) paymentFromProfile.push("reflect");
      if (user.credit_card_enabled) paymentFromProfile.push("credit_card");

      setForm((prev) => ({
        ...prev,
        car_model: user.car_model || "",
        car_year: user.car_year || "",
        car_color: user.car_color || "",
        car_plate: user.car_plate || "",
        driver_note: user.driver_note || "",
        amenities: amenitiesFromPrefs,
        payment_methods: paymentFromProfile,
        pref_smoking: profileSmoking,
        pref_chattiness: profileChattiness,
        pref_pets: profilePets,
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
      stops: [...prev.stops, { city: "", location: "", price_from_origin: 0, seats_available: prev.available_seats || 4 }],
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
      // Catch typed-in past dates that bypassed the picker's `min` attribute
      if (!isFutureOrToday(form.date)) { toast.error("لا يمكن نشر رحلة في تاريخ سابق ⚠️"); return false; }
      if (!form.time) { toast.error("يرجى تحديد وقت المغادرة ⚠️"); return false; }
      // Validate every stop has city + non-negative price
      for (let i = 0; i < form.stops.length; i++) {
        const s = form.stops[i];
        if (!s.city) { toast.error(`المحطة ${i + 1}: يرجى اختيار المدينة ⚠️`); return false; }
        if (s.city === form.from_city || s.city === form.to_city) { toast.error(`المحطة ${i + 1}: لا يمكن أن تكون نفس مدينة الانطلاق أو الوصول ⚠️`); return false; }
        const stopPrice = parseFloat(s.price_from_origin);
        if (isNaN(stopPrice) || stopPrice < 0) { toast.error(`المحطة ${i + 1}: السعر يجب أن يكون رقماً صحيحاً ⚠️`); return false; }
      }
    }
    if (currentStep === 2) {
      // Step 2 (seats + price) had NO validation before. Users could
      // submit zero/negative prices, zero seats, or empty values.
      const seats = parseInt(form.available_seats, 10);
      if (isNaN(seats) || seats < 1) { toast.error("عدد المقاعد يجب أن يكون 1 على الأقل ⚠️"); return false; }
      if (seats > 8) { toast.error("الحد الأقصى للمقاعد هو 8 ⚠️"); return false; }
      const price = parseFloat(form.price);
      if (isNaN(price) || price <= 0) { toast.error("السعر يجب أن يكون أكبر من صفر ⚠️"); return false; }
      if (price > 1000) { toast.error("السعر مرتفع جداً — تحقق من المبلغ ⚠️"); return false; }
    }
    if (currentStep === 3) {
      if (!form.car_model) { toast.error("يرجى إدخال نوع السيارة ⚠️"); return false; }
      if (!form.car_plate) { toast.error("يرجى إدخال رقم اللوحة ⚠️"); return false; }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!user?.id) { toast.error("لم يتم تحميل بيانات المستخدم. حاول مرة أخرى."); return; }

    // ── Pre-submit conflict check (frontend layer; SQL trigger is the source of truth) ──
    try {
      const myTrips = await base44.entities.Trip.filter({ driver_id: user.id }, "-created_date", 200);
      const tripsToCheck = form.is_recurring && form.recurring_days.length > 0
        ? form.recurring_days.map((dayIndex) => {
            const baseDate = new Date(form.date);
            const diff = (dayIndex - baseDate.getDay() + 7) % 7;
            const tripDate = new Date(baseDate);
            tripDate.setDate(baseDate.getDate() + (diff === 0 ? 7 : diff));
            return { ...form, date: tripDate.toISOString().split("T")[0] };
          })
        : [{ ...form }];

      for (const candidate of tripsToCheck) {
        const result = checkDriverConflict(candidate, myTrips);
        if (!result.valid) {
          toast.error(result.message || "يوجد تعارض في الجدول");
          return;
        }
      }
    } catch (e) {
      // Don't block submission on a check failure — SQL trigger will catch real conflicts
      console.warn("[CreateTrip] conflict check skipped:", e?.message);
    }

    // Build the payload using ONLY known DB columns — spreading form directly
    // risks sending unknown keys (e.g. "gender") that don't exist in trips.
    const baseData = {
      // Trip route + schedule
      from_city:       form.from_city,
      to_city:         form.to_city,
      from_location:   form.from_location || "",
      to_location:     form.to_location || "",
      date:            form.date,
      time:            form.time,
      price:           form.price,
      available_seats: form.available_seats,
      total_seats:     form.available_seats,
      // Trip options
      is_direct:       form.is_direct,
      is_recurring:    form.is_recurring,
      recurring_days:  form.recurring_days || [],
      // Re-sync the smoking amenity with pref_smoking before submit.
      // Without this, a driver could set pref_smoking="no" but leave the
      // smoking amenity chip ON (or vice versa) and the trip row would
      // ship contradictory data — the chip below the car would say
      // "ممنوع التدخين" while the amenities list still showed
      // "مسموح بالتدخين". Authoritative source: form.pref_smoking.
      amenities: (() => {
        const a = new Set(form.amenities || []);
        const allowsSmoking = form.pref_smoking === "yes" || form.pref_smoking === "allowed";
        if (allowsSmoking) a.add("smoking"); else a.delete("smoking");
        return Array.from(a);
      })(),
      payment_methods: form.payment_methods || ["cash"],
      has_checkpoint:  form.has_checkpoint || false,
      checkpoint_note: form.checkpoint_note || "",
      driver_note:     form.driver_note || "",
      // Car info
      car_model:  user?.car_model || form.car_model || "",
      car_year:   user?.car_year  || form.car_year  || "",
      car_color:  user?.car_color || form.car_color || "",
      car_plate:  user?.car_plate || form.car_plate || "",
      car_image:  user?.car_image || "",
      // Multi-stop support
      stops: (form.stops || []).filter(s => s.city && s.time).map(s => ({
        city:              s.city,
        location:          s.location || "",
        time:              s.time,
        price_from_origin: Number(s.price_from_origin) || 0,
        seats_available:   Number(s.seats_available) || form.available_seats,
      })),
      // Driver identity — UUID link + denormalized display fields
      // Driver preferences for THIS trip (form values, not profile values).
      // The form was pre-filled from the profile but the driver may have
      // overridden any of these per trip. Use what they actually saw on
      // screen at submit time so the published trip matches their intent.
      pref_smoking:      form.pref_smoking,
      pref_chattiness:   form.pref_chattiness,
      pref_pets:         !!form.pref_pets,
      vehicle_luggage:   user?.vehicle_luggage || null,
      vehicle_back_row:  user?.vehicle_back_row || null,
      driver_id:     user.id,
      driver_name:   user?.full_name || user?.email?.split("@")[0] || "سائق",
      driver_avatar: user?.avatar_url || "",
      driver_email:  user?.email || "",
      driver_phone:  user?.phone || "",
      driver_gender: user?.gender || null,  // from profile — CHECK constraint: male|female|null only
      status: "confirmed",
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
      const createdTrips = await Promise.all(promises);
      toast.success(`تم نشر ${form.recurring_days.length} رحلات متكررة بنجاح! 🎉`);
      // Notify matching preferences for first recurring trip
      if (createdTrips[0]) notifyMatchingPreferences({ ...baseData, id: createdTrips[0]?.id || createdTrips[0] });
    } else {
      try {
        const newTrip = await base44.entities.Trip.create(baseData);
        toast.success("تم نشر الرحلة بنجاح! 🎉");
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["driver-trips"] });
      qc.invalidateQueries({ queryKey: ["my-driver-trips"] });
      qc.invalidateQueries({ queryKey: ["featured-trips"] });
        // Notify users with matching route preferences (fire & forget)
        notifyMatchingPreferences({ ...baseData, id: newTrip?.id || newTrip });
      } catch (err) {
        const msg = err?.message || "";
        // SQL trigger errors come back with the Arabic text already
        if (msg.includes("يتعارض") || msg.includes("لا يطابق") || msg.includes("لا يمكن")) {
          toast.error(msg.split("\\n")[0]);
          return;
        }
        toast.error(friendlyError(err, "تعذر نشر الرحلة"));
        return;
      }
    }
    navigate("/my-trips");
  };

  // Eligibility-based block: only block if driver truly cannot publish
  if (!eligibility.allowed) {
    const reasonMap = {
      no_docs: {
        icon: "📄",
        title: "لم تقدم وثائق بعد",
        message: "لرفع وثائق قيادتك ومركبتك، يرجى إكمال الإعداد من صفحة الحساب.",
        ctaLabel: "تفعيل حساب السائق",
        ctaPath: "/become-driver",
      },
      first_time_pending: {
        icon: "⏳",
        title: "وثائقك قيد المراجعة",
        message: "شكراً على إرسال وثائقك. يقوم فريقنا بمراجعتها خلال 1-3 أيام عمل. ستصلك إشعار فور القبول، وعندها يمكنك نشر رحلاتك.",
        ctaLabel: "تتبّع حالة الوثائق",
        ctaPath: "/account-settings/profile#license",
      },
      expired_no_pending: {
        icon: "⚠️",
        title: "انتهت صلاحية وثائقك",
        message: eligibility.lastRejected
          ? `وثائقك السابقة انتهت ولم تتم الموافقة على آخر تحديث: ${eligibility.lastRejected.rejection_reason || "بدون سبب"}. يرجى رفع وثائق محدثة.`
          : "صلاحية وثائقك انتهت ولم ترفع وثائق جديدة. يرجى تحديثها لتتمكن من نشر الرحلات.",
        ctaLabel: "رفع وثائق جديدة",
        ctaPath: "/account-settings/profile#license",
      },
      // Subscription gates — only fire when kill switch is on AND driver
      // doesn't have an active subscription. License is still valid but
      // they need to subscribe (or wait for admin approval).
      subscription_never_subscribed: {
        icon: "💳",
        title: "اشترك في المنصة لتتمكن من نشر الرحلات",
        message: "وثائقك مقبولة، لكنك لم تشترك بعد في خدمة مِشوار للسائقين. الاشتراك الشهري ₪30 ويسمح لك بنشر رحلات بلا قيود.",
        ctaLabel: "اشترك الآن",
        ctaPath: "/driver?tab=subscription",
      },
      subscription_expired: {
        icon: "⏰",
        title: "انتهى اشتراكك",
        message: "انتهت صلاحية اشتراكك الشهري ولم تجدّده خلال فترة السماح. لا يمكنك نشر رحلات جديدة حتى تجدّد الاشتراك.",
        ctaLabel: "جدّد الاشتراك",
        ctaPath: "/driver?tab=subscription",
      },
      subscription_pending_review: {
        icon: "⏳",
        title: "طلب اشتراكك قيد المراجعة",
        message: "أرسلت طلب اشتراك ونحن نتحقق من تحويل الدفع. عادةً تكتمل المراجعة خلال 24 ساعة. ستصلك رسالة فور التفعيل وعندها يمكنك نشر رحلاتك.",
        ctaLabel: "تتبّع طلب الاشتراك",
        ctaPath: "/driver?tab=subscription",
      },
    };
    const info = reasonMap[eligibility.reason] || reasonMap.expired_no_pending;

    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div className="w-14 h-14 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">{info.icon}</span>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">{info.title}</h2>
          <p className="text-muted-foreground mb-4">{info.message}</p>
          <Link to={info.ctaPath}>
            <Button className="bg-primary text-primary-foreground rounded-xl mt-4">
              {info.ctaLabel}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Eligibility allowed but with caveats: show banner above the form
  const showPendingBanner = eligibility.reason === "pending_grace" || eligibility.reason === "valid_with_pending";
  const showExpiringSoonBanner = eligibility.expiringSoon && !showPendingBanner;
  const showSubscriptionGraceBanner = eligibility.reason === "subscription_in_grace";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">كيف تنشر رحلة ؟</h1>
        <p className="text-muted-foreground">شارك مقاعدك الفارغة وساعد الآخرين على الوصول بأمان وراحة</p>
      </div>

      {/* Subscription grace banner — driver's subscription expired but
          they're inside the configured grace window. They can still post
          but must renew before grace runs out. */}
      {showSubscriptionGraceBanner && eligibility.subscriptionStatus && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-foreground mb-0.5">انتهى اشتراكك — أنت في فترة سماح</p>
              <p className="text-sm text-muted-foreground">
                متبقي {eligibility.subscriptionStatus.grace_days_left} أيام لتجديد الاشتراك. بعدها لن تتمكن من نشر رحلات جديدة.
              </p>
            </div>
            <Link to="/driver?tab=subscription" className="text-xs font-bold text-primary underline shrink-0 mt-1">
              جدّد الآن
            </Link>
          </div>
        </div>
      )}

      {/* Subscription expiring soon banner — sub is active but ≤7 days left */}
      {eligibility.subscriptionStatus?.status === "active"
        && eligibility.subscriptionStatus.days_remaining <= 7
        && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-foreground mb-0.5">ينتهي اشتراكك قريباً</p>
              <p className="text-sm text-muted-foreground">
                متبقي {eligibility.subscriptionStatus.days_remaining} أيام على انتهاء اشتراكك. يفضّل التجديد مبكّراً لتفادي انقطاع النشر.
              </p>
            </div>
            <Link to="/driver?tab=subscription" className="text-xs font-bold text-primary underline shrink-0 mt-1">
              جدّد
            </Link>
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="flex items-center justify-between mb-2">
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
              {/* Desktop: show every step's label inline */}
              <span className="text-xs text-muted-foreground mt-1 hidden sm:block">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${step > s.id ? "bg-primary" : "bg-border"}`} />
            )}
          </React.Fragment>
        ))}
      </div>
      {/* Mobile: a single line under the bar showing the CURRENT step label
          + position. Stacking every label under each circle on a 375px screen
          either truncates them to ellipses or wraps the row to two lines. */}
      <p className="sm:hidden text-center text-sm font-medium text-foreground mb-8">
        خطوة {step} من {steps.length}: {steps.find((s) => s.id === step)?.label}
      </p>
      <div className="hidden sm:block mb-10" />

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
                <div className="h-11 rounded-xl mt-1 bg-background border border-input px-3 flex items-center">
                  <DateInput
                    value={form.date}
                    onChange={(e) => updateField("date", e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    placeholder="اختر تاريخ المغادرة"
                    className="w-full"
                  />
                </div>
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
              {form.stops.length > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 mb-2 flex items-start gap-2">
                  <span>💡</span>
                  <span>لا حاجة لتحديد وقت الوصول للمحطات — السائق سيتواصل مع الراكب عند الاقتراب</span>
                </div>
              )}
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
                min="1"
                max="1000"
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
            {/* Car details — pulled from "مركبتي" in driver dashboard */}
            <div className="bg-muted/30 rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-foreground flex items-center gap-2">
                  🚗 بيانات مركبتك
                </p>
                <Link to="/driver?tab=vehicle" className="text-xs text-primary hover:underline flex items-center gap-1">
                  تعديل ← لوحة السائق
                </Link>
              </div>

              {/* Car image preview */}
              {user?.car_image && (
                <div className="mb-3 rounded-xl overflow-hidden h-32 bg-muted relative">
                  <img loading="lazy" decoding="async" src={user.car_image} alt="المركبة" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                  {user.car_model && (
                    <div className="absolute bottom-2 right-3 text-white">
                      <p className="text-sm font-bold">{user.car_model} {user.car_year}</p>
                    </div>
                  )}
                </div>
              )}

              {user?.car_model ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-card rounded-xl p-2.5 border border-border text-center">
                    <p className="text-[10px] text-muted-foreground">الموديل</p>
                    <p className="text-xs font-bold mt-0.5 truncate">{user.car_model} {user.car_year}</p>
                  </div>
                  <div className="bg-card rounded-xl p-2.5 border border-border text-center">
                    <p className="text-[10px] text-muted-foreground">اللون</p>
                    <p className="text-xs font-bold mt-0.5">{user.car_color || "—"}</p>
                  </div>
                  <div className="bg-card rounded-xl p-2.5 border border-border text-center">
                    <p className="text-[10px] text-muted-foreground">اللوحة</p>
                    <p className="text-xs font-bold mt-0.5 font-mono">{user.car_plate || "—"}</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 flex items-start gap-2">
                  <span className="text-amber-600 mt-0.5">⚠️</span>
                  <div>
                    <p className="text-xs font-medium text-amber-800">لم تضف بيانات مركبتك بعد</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      اذهب إلى <Link to="/driver?tab=vehicle" className="font-bold underline">لوحة السائق ← مركبتي</Link> لإضافة موديل السيارة، اللون، واللوحة. ستظهر تلقائياً في كل رحلة.
                    </p>
                  </div>
                </div>
              )}
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
            {/* Driver preferences for this trip.
                Pre-filled from the driver's profile but overridable per trip.
                Each value is also saved on the trip row (pref_smoking,
                pref_chattiness, pref_pets) so passengers see the actual
                rules for THIS ride on the trip-details page chips —
                independent of any later profile changes. */}
            <div>
              <Label className="mb-2 block">تفضيلات الرحلة</Label>
              <p className="text-xs text-muted-foreground mb-3">
                مأخوذة من إعداداتك — يمكنك تعديلها لهذه الرحلة فقط.
                {" "}
                <Link to="/settings?section=preferences" className="text-primary hover:underline">
                  عدّل التفضيلات الافتراضية
                </Link>
              </p>
              <div className="space-y-3">
                {/* Smoking */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">التدخين</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "no",      label: "🚭 ممنوع" },
                      { id: "yes",     label: "🚬 مسموح" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateField("pref_smoking", opt.id)}
                        className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                          form.pref_smoking === opt.id
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-card border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Pets */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">الحيوانات الأليفة</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: false, label: "🚫 بدون حيوانات" },
                      { id: true,  label: "🐾 مرحب بها" },
                    ].map((opt) => (
                      <button
                        key={String(opt.id)}
                        type="button"
                        onClick={() => updateField("pref_pets", opt.id)}
                        className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                          !!form.pref_pets === !!opt.id
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-card border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Chattiness */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">الدردشة في الرحلة</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "quiet",  label: "🤫 هادئة" },
                      { id: "okay",   label: "🙂 معتدلة" },
                      { id: "chatty", label: "💬 دردشة" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateField("pref_chattiness", opt.id)}
                        className={`px-4 py-2 rounded-xl text-sm transition-all border ${
                          form.pref_chattiness === opt.id
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-card border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <Label className="mb-3 block">طرق الدفع المقبولة</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "cash",          label: "نقداً",        icon: "💵" },
                  { id: "bank_transfer", label: "تحويل بنكي",  icon: "🏦" },
                  { id: "reflect",       label: "Reflect",      icon: "💜" },
                  { id: "jawwal_pay",    label: "Jawwal Pay",   icon: "📱" },
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