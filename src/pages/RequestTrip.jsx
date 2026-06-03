import React, { useState, useMemo, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useOnboardingGate } from "@/hooks/useOnboardingGate";
import { useSEO } from "@/hooks/useSEO";
import { supabase } from "@/lib/supabase";
import { api } from "@/api/apiClient";
import { friendlyError } from "@/lib/errors";
import { logAudit } from "@/lib/adminAudit";
import { normalizeDigits } from "@/lib/validation";
import { CITY_COORDS } from "@/lib/mapUtils";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Calendar, Clock, Users, DollarSign, Info, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CityAutocomplete from "@/components/shared/CityAutocomplete";
import DateInput from "@/components/shared/DateInput";

/**
 * RequestTrip — passenger-facing form to post a "I want a ride" request.
 *
 * Calls submit_trip_request RPC (migration 019) which:
 *   - Validates auth + 3-active-max
 *   - Computes expires_at from date + time + flexibility
 *   - Inserts with status='open'
 *
 * On success, redirects to /my-requests so the user sees their new
 * request immediately + understands where to manage it.
 *
 * Auth gate: requires login. If not authed, redirects to /login with a
 * returnTo. If authed but is a driver-only account, soft-warning that
 * this feature is for passengers (driver-only users can still post —
 * they might want a ride for personal use — but we surface the
 * driver-side counterpart so they know it exists).
 */
const FLEX_OPTIONS = [
  { value: "exact",     label: "وقت محدد",     desc: "أحدد ساعة الانطلاق بالضبط" },
  { value: "morning",   label: "صباحاً",        desc: "بين 6 ص و 12 ظ" },
  { value: "afternoon", label: "بعد الظهر",     desc: "بين 12 ظ و 5 م" },
  { value: "evening",   label: "مساءً",          desc: "بين 5 م و 10 م" },
  { value: "flexible",  label: "أي وقت",         desc: "وقت الانطلاق مرن" },
];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

export default function RequestTrip() {
  useSEO({
    title: "اطلب رحلة",
    description: "انشر طلب رحلة في مشوارو وسيتواصل معك السائقون المتجهون لوجهتك.",
  });

  const navigate = useNavigate();
  const qc       = useQueryClient();
  const requireOnboarding = useOnboardingGate();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [searchParams] = useSearchParams();

  // Pre-fill from URL: ?from=<city>&to=<city>&date=<yyyy-mm-dd>
  // Surfaced from /search empty-state CTA — passenger searches a route,
  // gets no results, taps "اطلب رحلتك على هذا المسار" → lands here with
  // the route/date already filled. Saves them re-typing what they just
  // typed on /search.
  // CITY_COORDS lookup happens in submit; passing arbitrary city strings
  // is fine because validation runs on submit anyway. Date is also
  // accepted defensively — if the URL date is in the past, todayISO()
  // wins as the fallback (see initializer below).
  const prefilledFromCity = searchParams.get("from") || "";
  const prefilledToCity   = searchParams.get("to")   || "";
  const prefilledDate     = searchParams.get("date");
  const validPrefilledDate = prefilledDate && prefilledDate >= todayISO()
    ? prefilledDate : null;

  const [form, setForm] = useState({
    from_city:        prefilledFromCity,
    to_city:          prefilledToCity,
    requested_date:   validPrefilledDate || todayISO(),
    requested_time:   "",
    time_flexibility: "flexible",
    seats_needed:     1,
    suggested_price:  0,
    pickup_details:   "",
    dropoff_details:  "",
    notes:            "",
  });

  // Active-requests count — surface the 3-max ceiling upfront so the user
  // knows their remaining budget. Cheap query, only fires for authed users.
  const { data: activeCount = 0 } = useQuery({
    queryKey: ["my-active-request-count", user?.email],
    queryFn: async () => {
      const list = await api.entities.TripRequest.filter(
        { passenger_email: user.email, status: "open" }, "-created_at", 10
      );
      return list?.length || 0;
    },
    enabled: !!user?.email && isAuthenticated,
    staleTime: 30_000,
  });

  // ─── ID Verification gate ───────────────────────────────────────
  // Calls is_passenger_verified RPC (migration 020). Admins auto-pass.
  // If not verified, render a redirect-to-verify panel instead of the
  // form. Server-side, submit_trip_request also rejects with
  // "passenger not verified" — defense in depth.
  const { data: isVerified, isLoading: verifyLoading } = useQuery({
    queryKey: ["is-passenger-verified", user?.email],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_passenger_verified", { p_email: user.email });
      if (error) throw error;
      return !!data;
    },
    enabled: !!user?.email && isAuthenticated,
    staleTime: 30_000,
  });

  // ─── "Both" users: gate passenger features on driver license approval
  // If account_type="both", their driver documents serve as ID verification
  // for BOTH roles. No duplicate verification — one approval unlocks both.
  const { data: driverLicense, isLoading: licenseLoading } = useQuery({
    queryKey: ["driver-license-status", user?.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_licenses")
        .select("status")
        .eq("driver_email", user.email)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.email && user?.account_type === "both",
    staleTime: 30_000,
  });

  // NOTE: Auth gate is enforced AFTER all hooks below via the
  // useEffect at the end of this hook list. Doing it inline here as
  // `if (!isAuthenticated) { navigate(...); return null; }` (where it
  // used to live) violates rules-of-hooks because useMutation and
  // useMemo below would be skipped on un-authed renders, changing the
  // hook count between renders. Same reasoning the comment further
  // down explains for the verification gate.

  const submit = useMutation({
    mutationFn: async () => {
      // Pull GPS coords from CITY_COORDS for "near me" filtering by drivers.
      // Optional — null is fine if the city isn't in the lookup.
      const fromCoord = CITY_COORDS[form.from_city] || null;
      const toCoord   = CITY_COORDS[form.to_city]   || null;

      const { data, error } = await supabase.rpc("submit_trip_request", {
        p_from_city:        form.from_city,
        p_to_city:          form.to_city,
        p_requested_date:   form.requested_date,
        p_requested_time:   form.time_flexibility === "exact" && form.requested_time
                              ? form.requested_time
                              : null,
        p_time_flexibility: form.time_flexibility,
        p_seats_needed:     form.seats_needed,
        p_suggested_price:  form.suggested_price,
        p_pickup_details:   form.pickup_details || null,
        p_dropoff_details:  form.dropoff_details || null,
        p_notes:            form.notes || null,
        p_from_lat:         fromCoord?.[0] ?? null,
        p_from_lng:         fromCoord?.[1] ?? null,
        p_to_lat:           toCoord?.[0]   ?? null,
        p_to_lng:           toCoord?.[1]   ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("تم نشر طلبك! سيظهر للسائقين فوراً 🎉");
      qc.invalidateQueries({ queryKey: ["my-trip-requests"] });
      qc.invalidateQueries({ queryKey: ["my-active-request-count"] });
      qc.invalidateQueries({ queryKey: ["public-open-requests-count"] });
      // Audit log — trip requests (passenger posts 'I want a ride
      // from X to Y, who's going?') were unaudited. This is the
      // passenger-side equivalent of trip_created (driver-side).
      // Captures route, date, suggested price for activity-feed
      // visibility.
      logAudit("trip_request_created", "trip_request", data?.id || null, {
        passenger_email:  user?.email,
        route:            `${form.from_city} → ${form.to_city}`,
        date:             form.requested_date,
        time_flexibility: form.time_flexibility,
        seats_needed:     form.seats_needed,
        suggested_price:  form.suggested_price,
      });
      navigate("/my-requests");
    },
    onError: (err) => {
      toast.error(friendlyError(err, "تعذر نشر الطلب"));
    },
  });

  // ─── Validators ─────────────────────────────────────────────
  // Why this is more than a simple date check:
  // The server expires a request as soon as its computed `expires_at`
  // is in the past (see migration 096 — compute_request_expiry). For
  // morning/afternoon/evening flexibility, those expiries are at
  // 12:00 / 17:00 / 22:00 Palestine time on the requested date. So
  // when a user picks "today" + "morning" at 8pm local, the request
  // is already past its expiry the moment it's created → drivers
  // never see it, and `expire_stale_requests` flips it to expired
  // within 30 minutes. Out of 12 historical expirations, 7 fit this
  // pattern. Block it on the client so the user sees a clear message
  // ("the slot for today has already passed — pick tomorrow") rather
  // than discovering their request silently vanished.
  //
  // We do the work in Palestine time (Asia/Jerusalem) regardless of
  // the device clock, so a passenger creating a request from a phone
  // set to a different timezone still gets the correct check against
  // the server's reference frame.
  const palestineNow = useMemo(() => {
    // Build "now" in Palestine by formatting via Intl and re-parsing.
    // toLocaleString with the Asia/Jerusalem timezone produces the
    // wall-clock date+time there; we split it back into parts so we
    // can compare hour-of-day independent of the device timezone.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date()).map(p => [p.type, p.value])
    );
    return {
      ymd: `${parts.year}-${parts.month}-${parts.day}`,
      hour: parseInt(parts.hour, 10),
      minute: parseInt(parts.minute, 10),
    };
  }, []);

  // Closing minute-of-day for each flexibility window (Palestine time):
  //   morning  → 12:00  → 720 minutes from midnight
  //   afternoon→ 17:00  → 1020
  //   evening  → 22:00  → 1320
  //   anytime  → 23:59  → 1439 (entire day still valid)
  const slotEndMinutes = (flex) => (
    flex === "morning"   ? 720 :
    flex === "afternoon" ? 1020 :
    flex === "evening"   ? 1320 :
                           1439
  );

  const issues = useMemo(() => {
    const arr = [];
    if (!form.from_city)                 arr.push("اختر مدينة الانطلاق");
    if (!form.to_city)                   arr.push("اختر مدينة الوصول");
    if (form.from_city === form.to_city && form.from_city) arr.push("نقطة الانطلاق والوصول لا يمكن أن تكون نفسها");
    if (!form.requested_date)            arr.push("اختر تاريخ الرحلة");
    if (form.requested_date < palestineNow.ymd) arr.push("تاريخ الرحلة في الماضي");
    if (form.time_flexibility === "exact" && !form.requested_time) arr.push("اختر ساعة الانطلاق");

    // Same-day check — block selections that are already past:
    //   - exact time earlier than now
    //   - morning/afternoon/evening slot whose window has already closed
    if (form.requested_date === palestineNow.ymd) {
      const nowMin = palestineNow.hour * 60 + palestineNow.minute;
      if (form.time_flexibility === "exact" && form.requested_time) {
        const [h, m] = form.requested_time.split(":").map(Number);
        if (Number.isFinite(h) && Number.isFinite(m) && (h * 60 + m) <= nowMin) {
          arr.push("الوقت المطلوب اليوم قد مرّ — اختر وقتاً لاحقاً أو يوماً آخر");
        }
      } else if (form.time_flexibility && form.time_flexibility !== "anytime") {
        if (slotEndMinutes(form.time_flexibility) <= nowMin) {
          arr.push("هذه الفترة من اليوم انتهت — اختر فترة لاحقة أو يوماً آخر");
        }
      }
    }

    if (form.seats_needed < 1 || form.seats_needed > 6) arr.push("عدد المقاعد بين 1 و 6");
    if (form.suggested_price < 0 || form.suggested_price > 1000) arr.push("السعر المقترح بين 0 و 1000 شيكل");
    return arr;
  }, [form, palestineNow]);

  const canSubmit = issues.length === 0 && !submit.isPending && activeCount < 3;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Auth gate — redirect runs as a side-effect (effect, not render)
  // so the navigate call doesn't fight with the render tree. The
  // un-authed render returns a loading splash for the brief window
  // between the effect firing and the route change. Hook count stays
  // invariant across renders this way.
  useEffect(() => {
    if (!isLoadingAuth && !isAuthenticated) {
      navigate("/login?returnTo=/request-trip", { replace: true });
    }
  }, [isLoadingAuth, isAuthenticated, navigate]);

  if (!isLoadingAuth && !isAuthenticated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ─── "Both" users with pending driver license: block passenger features
  // until license approved. Their driver documents verify identity for
  // BOTH roles — no need to verify twice. Show pending status + link to
  // check verification progress.
  if (user?.account_type === "both" && !licenseLoading) {
    if (!driverLicense || driverLicense.status === "pending") {
      return (
        <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4 rotate-180" />
            رجوع
          </Link>

          <div className="bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-2xl p-6 mb-5">
            <div className="flex items-center gap-3 mb-3">
              <Clock className="w-7 h-7" />
              <h1 className="text-2xl font-bold">في انتظار توثيق وثائقك</h1>
            </div>
            <p className="text-sm leading-relaxed opacity-95">
              بما أنك قمت بالتسجيل كراكب وسائق معاً، نحتاج أولاً أن نوثق رخصة قيادتك
              ووثائق سيارتك. بعد الموافقة، ستتمكن من طلب رحلات كراكب ونشر رحلات
              كسائق — دون الحاجة لتوثيق إضافي.
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-foreground">ماذا بعد؟</h3>
            <ul className="space-y-2 text-sm text-foreground/80">
              <li className="flex items-start gap-2">
                <span className="text-primary shrink-0">✓</span>
                ستتم مراجعة وثائقك خلال 24 ساعة
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary shrink-0">✓</span>
                ستصلك إشعارات فورية عند الموافقة
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary shrink-0">✓</span>
                بعد الموافقة، تستطيع طلب ونشر الرحلات مباشرة
              </li>
            </ul>
            <p className="text-xs text-muted-foreground leading-relaxed pt-2 border-t border-border/60">
              💡 وثائقك تخدم كتوثيق هوية لكلا الخدمتين — لن تحتاج لتوثيق منفصل كراكب.
            </p>
            <Link to="/settings?section=verification">
              <Button className="w-full h-12 text-base font-bold gap-2">
                <ShieldCheck className="w-5 h-5" />
                تحقق من حالة التوثيق
              </Button>
            </Link>
          </div>
        </div>
      );
    }
    if (driverLicense.status === "rejected") {
      return (
        <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4 rotate-180" />
            رجوع
          </Link>

          <div className="bg-gradient-to-br from-red-500 to-red-600 text-white rounded-2xl p-6 mb-5">
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle className="w-7 h-7" />
              <h1 className="text-2xl font-bold">تم رفض وثائق القيادة</h1>
            </div>
            <p className="text-sm leading-relaxed opacity-95">
              لم يتم الموافقة على رخصة القيادة أو وثائق السيارة. يرجى مراجعة
              ملاحظات الإدارة وإعادة تقديم وثائق صحيحة للموافقة.
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <p className="text-sm text-foreground/80">
              بعد إعادة تقديم وثائق صحيحة والموافقة عليها، ستتمكن من استخدام
              التطبيق كراكب وسائق معاً.
            </p>
            <Link to="/settings?section=verification">
              <Button className="w-full h-12 text-base font-bold gap-2" variant="destructive">
                <ShieldCheck className="w-5 h-5" />
                مراجعة الوثائق وإعادة التقديم
              </Button>
            </Link>
          </div>
        </div>
      );
    }
  }

  // ─── ID verification gate (rendered AFTER all hooks to keep hook
  // order stable across renders — earlier placement violated rules-
  // of-hooks and crashed when verification status flipped to false).
  if (!verifyLoading && isVerified === false) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 rotate-180" />
          رجوع
        </Link>

        <div className="bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-2xl p-6 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <ShieldCheck className="w-7 h-7" />
            <h1 className="text-2xl font-bold">يتطلب توثيق الهوية</h1>
          </div>
          <p className="text-sm leading-relaxed opacity-95">
            لحماية السائقين والمنصة من الطلبات المُسيئة، نطلب توثيق هويتك مرة
            واحدة قبل أول طلب رحلة. التوثيق سريع وبياناتك تبقى خاصة لا تظهر
            لأي مستخدم آخر.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-foreground">ما تحتاجه:</h3>
          <ul className="space-y-2 text-sm text-foreground/80">
            <li className="flex items-start gap-2">
              <span className="text-primary shrink-0">✓</span>
              صورة واضحة لهويتك (الوجه الأمامي)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary shrink-0">✓</span>
              صورة شخصية لك مع الهوية في يدك
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary shrink-0">✓</span>
              الاسم الرباعي كما يظهر على الهوية
            </li>
          </ul>
          <p className="text-xs text-muted-foreground leading-relaxed pt-2 border-t border-border/60">
            🔒 الصور مخزنة في خوادم خاصة. الإدارة فقط تراها للمراجعة لمدة قصيرة،
            ولا تظهر لأي مستخدم آخر إطلاقاً.
          </p>
          <Link to="/verify-passenger">
            <Button className="w-full h-12 text-base font-bold gap-2">
              <ShieldCheck className="w-5 h-5" />
              ابدأ التوثيق الآن
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </Link>

      <div className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground rounded-2xl p-5 mb-5">
        <h1 className="text-2xl font-bold mb-1">اطلب رحلة 🚗</h1>
        <p className="text-sm opacity-90 leading-relaxed">
          أخبر السائقين أنك تبحث عن رحلة. سيتواصل معك من يمر بمسارك.
          خدمة مجانية للراكب — لا حجز ولا التزام.
        </p>
      </div>

      {/* Active requests counter — show before form so user knows the limit */}
      {activeCount >= 3 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-5 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              لديك 3 طلبات نشطة بالفعل
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
              ألغِ أحدها قبل إنشاء طلب جديد.{" "}
              <Link to="/my-requests" className="underline font-medium">إدارة طلباتي</Link>
            </p>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
        {/* From / To */}
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-green-600" />
              من أين؟
            </Label>
            <CityAutocomplete
              value={form.from_city}
              onChange={(v) => set("from_city", v)}
              placeholder="اختر مدينة الانطلاق"
            />
            <Input
              value={form.pickup_details}
              onChange={(e) => set("pickup_details", e.target.value)}
              placeholder="نقطة محددة (مثل: قرب الصيدلية، اختياري)"
              className="mt-2 text-sm"
              maxLength={200}
            />
          </div>
          <div>
            <Label className="mb-1.5 block flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-destructive" />
              إلى أين؟
            </Label>
            <CityAutocomplete
              value={form.to_city}
              onChange={(v) => set("to_city", v)}
              placeholder="اختر مدينة الوصول"
            />
            <Input
              value={form.dropoff_details}
              onChange={(e) => set("dropoff_details", e.target.value)}
              placeholder="نقطة محددة (مثل: مستشفى الهمشري، اختياري)"
              className="mt-2 text-sm"
              maxLength={200}
            />
          </div>
        </div>

        {/* Date */}
        <div>
          <Label className="mb-1.5 block flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-primary" />
            متى تريد الرحلة؟
          </Label>
          <DateInput
            value={form.requested_date}
            onChange={(e) => set("requested_date", e.target.value)}
            min={todayISO()}
          />
        </div>

        {/* Time flexibility */}
        <div>
          <Label className="mb-1.5 block flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-primary" />
            وقت الانطلاق
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FLEX_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set("time_flexibility", opt.value)}
                className={`text-right rounded-xl border p-3 transition-colors ${
                  form.time_flexibility === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <p className="text-sm font-bold text-foreground">{opt.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
          {form.time_flexibility === "exact" && (
            <Input
              type="time"
              value={form.requested_time}
              onChange={(e) => set("requested_time", e.target.value)}
              className="mt-2"
              required
            />
          )}
        </div>

        {/* Seats + Price */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block flex items-center gap-1.5">
              <Users className="w-4 h-4 text-blue-600" />
              عدد المقاعد
            </Label>
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => set("seats_needed", Math.max(1, form.seats_needed - 1))}
                className="w-9 h-10 rounded-lg border border-border bg-muted/40 active:scale-95">−</button>
              <div className="flex-1 h-10 rounded-lg border border-border flex items-center justify-center font-bold text-foreground">
                {form.seats_needed}
              </div>
              <button type="button"
                onClick={() => set("seats_needed", Math.min(6, form.seats_needed + 1))}
                className="w-9 h-10 rounded-lg border border-border bg-muted/40 active:scale-95">+</button>
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-green-600" />
              السعر المقترح للمقعد
            </Label>
            <div className="relative">
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9٠-٩۰-۹]*"
                value={form.suggested_price}
                onChange={(e) => {
                  // Accept Arabic-Indic + Persian digits, normalize to ASCII.
                  // Was type="number" which silently rejected ٠-٩ on mobile.
                  const ascii = normalizeDigits(e.target.value);
                  const digits = ascii.replace(/[^\d]/g, "");
                  set("suggested_price", digits === "" ? 0 : parseInt(digits, 10));
                }}
                placeholder="مثال: 50"
                className="pr-14"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₪</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              السائق قد يقبل أو يفاوض عليه
            </p>
          </div>
        </div>

        {/* Notes */}
        <div>
          <Label className="mb-1.5 block flex items-center gap-1.5">
            <Info className="w-4 h-4 text-muted-foreground" />
            ملاحظات إضافية (اختياري)
          </Label>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="مثلاً: لدي حقيبة كبيرة، أو أفضل سائقاً امرأة..."
            maxLength={500}
            rows={3}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-[10px] text-muted-foreground mt-1 text-left">
            {form.notes.length}/500
          </p>
        </div>

        {/* Issues / Submit */}
        {issues.length > 0 && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200 mb-1">يرجى إكمال:</p>
            <ul className="text-[11px] text-amber-800 dark:text-amber-300 space-y-0.5">
              {issues.map(i => <li key={i}>• {i}</li>)}
            </ul>
          </div>
        )}

        <Button
          onClick={() => { if (requireOnboarding("/request-trip")) submit.mutate(); }}
          disabled={!canSubmit}
          className="w-full h-12 text-base font-bold"
        >
          {submit.isPending ? "جاري النشر..." : "نشر الطلب"}
        </Button>

        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          بنشر الطلب فإنك توافق على{" "}
          <Link to="/terms" className="text-primary underline">شروط الاستخدام</Link>.
          سيظهر اسمك ومسارك ومقعدك المطلوب للسائقين المشتركين فقط — لن يُكشف رقم هاتفك.
        </p>
      </div>
    </div>
  );
}
