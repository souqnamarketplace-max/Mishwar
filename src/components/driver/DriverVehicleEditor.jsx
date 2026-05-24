import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Save, Camera, Loader2, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

const COLORS = ["أبيض", "أسود", "فضي", "رمادي", "أحمر", "أزرق", "بيج"];

const EMPTY_FORM = {
  car_model: "", car_year: "", car_color: "",
  car_plate: "", car_image: "", driver_note: "",
  vehicle_capacity: null, vehicle_luggage: "m",
};

export default function DriverVehicleEditor() {
  const qc = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.auth.me(),
  });

  // Fetch latest driver license to know review status.
  // This drives the banner state: red "must upload" vs yellow "under review".
  const { data: license } = useQuery({
    queryKey: ["driver-license", user?.id],
    queryFn: () =>
      user?.id
        ? api.entities.DriverLicense.filter({ user_id: user.id }, "-created_date", 1)
        : [],
    enabled: !!user?.id,
  });
  const latestLicense = license?.[0];

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showVerificationWarning, setShowVerificationWarning] = useState(false);
  const fileInputRef = useRef(null);

  // Hydrate form from user. Two-phase patch (June 2026):
  //
  // The previous hydratedRef-keyed-on-email approach had a race: when
  // user.email arrives in the first React tick (cached session) but
  // car_model / car_year / etc arrive in a later tick (fresh profile),
  // the ref locked on email=present and the form stayed at EMPTY_FORM
  // forever. Drivers opened the editor, saw blank fields, hit save
  // "to refresh" → empty values wiped the real car data in DB.
  //
  // The fix: merge from user into form ONLY for fields the form
  // doesn't already have a value for. Never clobber driver edits.
  // Runs on every dep change, but is idempotent — no patch is built
  // when every relevant field is already populated.
  useEffect(() => {
    if (!user?.email) return;
    setForm((prev) => {
      const patch = {};
      if (!prev.car_model   && user.car_model)   patch.car_model   = user.car_model;
      if (!prev.car_year    && user.car_year)    patch.car_year    = user.car_year;
      if (!prev.car_color   && user.car_color)   patch.car_color   = user.car_color;
      if (!prev.car_plate   && user.car_plate)   patch.car_plate   = user.car_plate;
      if (!prev.car_image   && user.car_image)   patch.car_image   = user.car_image;
      if (!prev.driver_note && user.driver_note) patch.driver_note = user.driver_note;
      if (prev.vehicle_capacity === null && user.vehicle_capacity) patch.vehicle_capacity = user.vehicle_capacity;
      if (!prev.vehicle_luggage && user.vehicle_luggage) patch.vehicle_luggage = user.vehicle_luggage;
      return Object.keys(patch).length ? { ...prev, ...patch } : prev;
    });
  }, [user?.email, user?.car_model, user?.car_year, user?.car_color,
      user?.car_plate, user?.car_image, user?.driver_note, 
      user?.vehicle_capacity, user?.vehicle_luggage]);

  const set = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    // Validation: capacity is required
    if (!form.vehicle_capacity) {
      toast.error("يرجى اختيار عدد المقاعد الكلي");
      return;
    }
    
    setSaving(true);
    try {
      // Check if vehicle identity changed (new car = need re-verification)
      const vehicleChanged = 
        (user?.car_model && user.car_model !== form.car_model) ||
        (user?.car_year && user.car_year !== form.car_year) ||
        (user?.car_plate && user.car_plate !== form.car_plate);
      
      // If vehicle changed, require re-verification
      const payload = { ...form };
      if (vehicleChanged) {
        payload.verification_pending = true;
        // Note: vehicle_insurance/registration are in driver_licenses table, 
        // not profiles, so we just set verification_pending flag here.
        // Admin will need to approve new vehicle documents.
      }
      
      await api.auth.updateMe(payload);
      
      // Send notifications when vehicle changes (requires re-verification)
      if (vehicleChanged && user?.email) {
        // CLEAR old vehicle-specific documents from driver_licenses.
        // This is critical: the old "approved" license was for the OLD car.
        // For the NEW car, driver must re-upload registration + insurance
        // (license_image_url + selfies stay - they're about the person, not the car).
        //
        // We also reset status to "pending" so:
        // 1. The eligibility check blocks trip creation (defense in depth)
        // 2. The verification card shows "قيد المراجعة" instead of "موثّق"
        // 3. The license row reappears in the admin approval queue
        try {
          // Find the latest license row for this user
          const { data: existingLicenses, error: fetchErr } = await supabase
            .from("driver_licenses")
            .select("id")
            .eq("driver_email", user.email)
            .order("created_date", { ascending: false })
            .limit(1);
          
          if (fetchErr) throw fetchErr;
          
          if (existingLicenses && existingLicenses.length > 0) {
            const licenseId = existingLicenses[0].id;
            const { error: updateErr } = await supabase
              .from("driver_licenses")
              .update({
                status: "incomplete", // Forces driver to complete + resubmit
                car_registration_image_url: null,
                insurance_image_url: null,
                car_registration_expiry_date: null,
                insurance_expiry_date: null,
                approved_at: null,
                approved_by: null,
                rejection_reason: "تم تغيير بيانات المركبة — يجب رفع وثائق التأمين والترخيص الجديدة",
              })
              .eq("id", licenseId);
            
            if (updateErr) console.warn("license clear error:", updateErr);
          }
        } catch (e) {
          console.warn("failed to clear old vehicle docs:", e);
          // Non-fatal - verification_pending flag still blocks trip posting
        }
        
        // Notification to driver: in-app bell entry as a persistent record
        // (the toast is transient - this stays in their notifications list)
        const { error: notifErr } = await supabase
          .from("notifications")
          .insert({
            user_email: user.email,
            title: "⚠️ مطلوب: تحديث وثائق المركبة",
            message: `قمت بتغيير بيانات مركبتك (${form.car_model || ""}). يجب رفع وثائق التأمين والترخيص الجديدة وانتظار الموافقة قبل نشر رحلات جديدة.`,
            type: "vehicle_change_pending",
            is_read: false,
            link: "/account-settings/profile#license",
          });
        if (notifErr) console.warn("driver notif error:", notifErr); // non-fatal
        
        // Notification to admins (broadcast to admin role via notifications
        // table — admin dashboard polls this for verification queue alerts)
        const { error: adminNotifErr } = await supabase
          .from("notifications")
          .insert({
            user_email: "souqnamarketplace@gmail.com", // admin email
            title: "🚗 سائق غيّر بيانات مركبته",
            message: `${user.full_name || user.email} قام بتغيير بيانات مركبته ويحتاج إلى موافقة على الوثائق الجديدة.`,
            type: "admin_vehicle_change",
            is_read: false,
            link: "/dashboard/licenses",
          });
        if (adminNotifErr) console.warn("admin notif error:", adminNotifErr); // non-fatal
      }
      
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["driver-license"] });
      await qc.invalidateQueries({ queryKey: ["licenses"] });
      // Force wait for user data to refresh before showing toast
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (vehicleChanged) {
        setShowVerificationWarning(true); // Show banner immediately
        toast.success("تم حفظ بيانات المركبة بنجاح ✅", {
          duration: 8000,
        });
        toast.warning("⚠️ تنبيه هام: قمت بتغيير بيانات المركبة\n\nيجب عليك رفع وثائق التأمين والترخيص الجديدة للمركبة الجديدة من صفحة \"الإعدادات\" ← \"التحقق من الهوية\"، وإلا لن تتمكن من نشر رحلات جديدة حتى تتم الموافقة.", {
          duration: 12000,
        });
      } else {
        toast.success("تم حفظ بيانات المركبة بنجاح ✅");
      }
    } catch (err) {
      toast.error(friendlyError(err, "فشل حفظ بيانات المركبة — حاول مجدداً"));
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await api.integrations.Core.UploadFile({ file });
      set("car_image", file_url);
      toast.success("تم رفع الصورة بنجاح ✅");
    } catch (err) {
      toast.error(friendlyError(err, "فشل رفع الصورة — حاول مجدداً"));
    } finally {
      setUploading(false);
    }
  };

  // Banner state machine:
  // - verification_pending=false → No banner (driver approved or never re-verified)
  // - verification_pending=true + license.status=pending → YELLOW "under review"
  // - verification_pending=true + license.status=incomplete/null → RED "must upload"
  const isPending = user?.verification_pending || showVerificationWarning;
  const isUnderReview = latestLicense?.status === "pending";
  const showRedBanner = isPending && !isUnderReview;
  const showYellowBanner = isPending && isUnderReview;

  return (
    <div className="max-w-2xl space-y-6">
      {/* RED banner: docs not uploaded yet, driver MUST upload */}
      {showRedBanner && (
        <div className="bg-red-500/10 border-2 border-red-500/40 rounded-2xl p-5 animate-pulse">
          <div className="flex items-start gap-3">
            <span className="text-3xl shrink-0">⚠️</span>
            <div>
              <h3 className="font-bold text-red-900 dark:text-red-200 text-lg mb-2">
                مطلوب: تحديث وثائق المركبة
              </h3>
              <p className="text-sm text-red-800 dark:text-red-300 mb-3 leading-relaxed">
                قمت بتغيير بيانات المركبة (الموديل، السنة، أو اللوحة). يجب عليك رفع وثائق <strong>التأمين والترخيص الجديدة</strong> للمركبة الجديدة وانتظار موافقة الإدارة.
              </p>
              <p className="text-sm text-red-800 dark:text-red-300 font-bold">
                ⛔ لن تتمكن من نشر رحلات جديدة حتى تتم الموافقة على الوثائق الجديدة.
              </p>
              <Link to="/account-settings/profile#license">
                <Button className="mt-4 bg-red-600 hover:bg-red-700 text-white rounded-xl gap-2">
                  <span>📄</span>
                  رفع الوثائق الآن
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* YELLOW banner: docs uploaded, awaiting admin review */}
      {showYellowBanner && (
        <div className="bg-yellow-500/10 border-2 border-yellow-500/40 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-3xl shrink-0">⏳</span>
            <div>
              <h3 className="font-bold text-yellow-900 dark:text-yellow-200 text-lg mb-2">
                وثائقك قيد المراجعة
              </h3>
              <p className="text-sm text-yellow-800 dark:text-yellow-300 mb-2 leading-relaxed">
                تم استلام وثائق المركبة الجديدة بنجاح. الإدارة تراجع وثائقك الآن — عادة خلال <strong>1-3 أيام عمل</strong>.
              </p>
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                ℹ️ ستتمكن من نشر رحلات جديدة فور الموافقة. سنرسل لك إشعاراً.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Car preview */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="relative h-44 bg-muted flex items-center justify-center">
          {form.car_image ? (
            <img loading="lazy" src={form.car_image} alt="المركبة" className="w-full h-full object-cover" />
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

      {/* Driver Note */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h3 className="font-bold text-foreground mb-4">ملاحظة للركاب</h3>
        <textarea
          rows={3}
          placeholder="اكتب ملاحظة للركاب..."
          value={form.driver_note}
          onChange={(e) => set("driver_note", e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-input bg-transparent text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Vehicle Capacity & Luggage */}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-6">
        <div>
          <h3 className="font-bold text-foreground mb-1 flex items-center gap-2">
            <Car className="w-4 h-4 text-primary" />
            عدد المقاعد الكلي
          </h3>
          <p className="text-xs text-amber-600 mb-3 font-medium">⚠️ اختر إجمالي المقاعد في سيارتك (شامل السائق). لا يمكن إنشاء رحلة بمقاعد أكثر من هذا العدد.</p>
          <div className="grid grid-cols-4 gap-2">
            {[2, 3, 4, 5, 6, 7, 8, 9].map(num => (
              <button
                key={num}
                onClick={() => set("vehicle_capacity", num)}
                className={`flex items-center justify-center p-3 rounded-xl border-2 transition-all ${
                  form.vehicle_capacity === num
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground"
                }`}
              >
                <span className="text-lg font-bold">{num}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-bold text-sm text-foreground mb-3">حجم الأمتعة المسموح</h4>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: "none", label: "بدون أمتعة" },
              { id: "s",    label: "صغيرة (S)" },
              { id: "m",    label: "متوسطة (M)" },
              { id: "l",    label: "كبيرة (L)" },
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => set("vehicle_luggage", opt.id)}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                  form.vehicle_luggage === opt.id
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