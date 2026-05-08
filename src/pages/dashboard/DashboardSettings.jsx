import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings, Save, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

const defaultSettings = {
  // Commission default is 0% — the launch posture is "drivers keep
  // everything" until volume + reconciliation processes are mature
  // enough to justify a cut. Admin can raise this later from the UI
  // and the value flows through to /dashboard?tab=payments and the
  // driver_payments_summary RPC.
  commission_rate: 0,
  // Subscription defaults — kill switch OFF so this system is dormant
  // until admin explicitly enables it. Existing drivers are unaffected
  // until subscription_required = true.
  subscription_required: false,
  subscription_price: 30,
  subscription_period_days: 30,
  subscription_grace_days: 3,
  platform_bank_account_name: "",
  platform_bank_iban: "",
  platform_reflect_number: "",
  platform_jawwal_number: "",
  min_price: 10,
  max_price: 500,
  max_seats: 6,
  app_name: "مِشوار",
  // Contact info: empty by default. Footer / Help only render the contact
  // block when these are set, so a fresh DB shows no contact info rather
  // than placeholders that look like real numbers.
  support_phone: "",
  support_email: "",
  // Hero badge: empty hides the badge entirely. Set to a factual claim
  // when you actually have one.
  hero_badge_text: "",
  // Stats bar: hidden by default. Toggle on once you have enough real
  // users that public_stats_min_users is met.
  public_stats_enabled: false,
  public_stats_min_users: 100,
  allow_registration: true,
  maintenance_mode: false,
};

export default function DashboardSettings() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: settingsArr = [], isLoading } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });

  const existingSettings = settingsArr[0];
  // CRITICAL: form starts as null and gets populated from the DB once the
  // query resolves. Earlier this was useState(() => ({ ...defaultSettings,
  // ...existingSettings })) — but the lazy initializer only runs ONCE on
  // first render, when the query is still loading and existingSettings is
  // undefined. So the form was permanently stuck at defaults, regardless
  // of what was actually saved in the DB. On every page refresh the toggle
  // appeared OFF even when DB had subscription_required=true, and saving
  // would silently overwrite all other fields with their defaults.
  //
  // Now: form is null until existingSettings loads, then we sync once.
  // After that user edits drive the form, and the form keeps its value
  // across mutation invalidations (we only re-sync on first hydrate).
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (form === null && existingSettings) {
      setForm({ ...defaultSettings, ...existingSettings });
    } else if (form === null && !isLoading && !existingSettings) {
      // No row exists in DB yet — first-time save will create it
      setForm({ ...defaultSettings });
    }
  }, [existingSettings, isLoading, form]);

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
    onError: (err) => {
      // Without this handler, save failures were invisible — react-query
      // would log to console but the user saw no toast, the toggle would
      // appear to flip in the UI (form state held), and only a refresh
      // (which re-syncs from DB) revealed nothing was actually saved.
      //
      // Most common cause we've seen: a form field references a column
      // that doesn't exist in the DB (migration not yet applied), so
      // PostgREST returns 400 "column does not exist" on PATCH.
      const msg = String(err?.message || err || "");
      // Specifically detect missing-column errors and surface a more
      // helpful message instead of the generic friendlyError.
      const missingColumn = msg.match(/column [\"']?(\w+)[\"']?\s+does not exist/i)
                          || msg.match(/Could not find the [\"']?(\w+)[\"']? column/i);
      if (missingColumn) {
        toast.error(
          `لم يتم الحفظ — العمود ${missingColumn[1]} غير موجود في قاعدة البيانات. ` +
          `قد تحتاج لتطبيق آخر ترحيلات (migrations).`
        );
      } else {
        toast.error(friendlyError(err, "فشل حفظ الإعدادات"));
      }
    },
  });

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Loading state — without this guard, downstream {form.commission_rate}
  // accesses would throw because form is initially null.
  if (form === null) {
    return (
      <div className="space-y-5 max-w-2xl">
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="animate-pulse h-32 bg-muted/40 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Monetization mode summary — at-a-glance status of how the platform
          is currently making money. Commission and subscription are
          orthogonal levers; this card translates the current settings
          into plain-Arabic prose so admin doesn't have to puzzle out the
          combination of two toggles. */}
      <MonetizationModeCard
        commissionRate={form.commission_rate}
        subscriptionOn={form.subscription_required}
        subscriptionPrice={form.subscription_price}
      />

      {/* Subscription system */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          نظام الاشتراك (تحصيل من السائقين)
        </h3>

        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg mb-4">
          <div className="flex-1 ml-3">
            <p className="text-sm font-medium">تفعيل نظام الاشتراك</p>
            <p className="text-xs text-muted-foreground">
              عند التفعيل، سيتطلب من السائقين دفع الاشتراك الشهري لنشر الرحلات.
              يفضّل منح السائقين الحاليين فترة سماح من صفحة "اشتراكات السائقين" قبل التفعيل.
            </p>
          </div>
          <button
            onClick={() => {
              // When flipping FROM off TO on, warn about existing drivers
              // and direct admin to grant them grace first. Without this
              // confirm step, every existing driver immediately can't post
              // trips the moment the toggle saves.
              if (!form.subscription_required) {
                const ok = window.confirm(
                  "تحذير: عند تفعيل نظام الاشتراك، السائقون الذين لا يملكون اشتراكاً نشطاً " +
                  "سيُمنعون فوراً من نشر رحلات جديدة.\n\n" +
                  "نوصي بزيارة صفحة 'اشتراكات السائقين' أولاً ومنح فترة سماح للسائقين الحاليين " +
                  "قبل تفعيل النظام.\n\n" +
                  "هل تريد المتابعة؟"
                );
                if (!ok) return;
              }
              update("subscription_required", !form.subscription_required);
            }}
            className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${form.subscription_required ? "bg-primary" : "bg-muted-foreground/30"}`}
            aria-label="تفعيل نظام الاشتراك"
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.subscription_required ? "right-0.5" : "left-0.5"}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">السعر الشهري (₪)</label>
            <input
              type="number"
              min="0"
              max="500"
              step="0.5"
              value={form.subscription_price ?? 30}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                update("subscription_price", Number.isFinite(raw) ? Math.max(0, Math.min(500, raw)) : 0);
              }}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">مدة الاشتراك (يوماً)</label>
            <input
              type="number"
              min="1"
              max="365"
              value={form.subscription_period_days ?? 30}
              onChange={(e) => {
                const raw = parseInt(e.target.value);
                update("subscription_period_days", Number.isFinite(raw) ? Math.max(1, Math.min(365, raw)) : 30);
              }}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">فترة السماح بعد الانتهاء (يوماً)</label>
            <input
              type="number"
              min="0"
              max="30"
              value={form.subscription_grace_days ?? 3}
              onChange={(e) => {
                const raw = parseInt(e.target.value);
                update("subscription_grace_days", Number.isFinite(raw) ? Math.max(0, Math.min(30, raw)) : 0);
              }}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">
            حسابات استلام الاشتراك (تظهر للسائقين عند التسجيل)
          </p>
          <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
            ⚠️ هذه الحسابات تخصك أنت كإدارة. السائقون يرسلون إليها مبلغ الاشتراك. اتركها فارغة لإخفائها.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">رقم Reflect</label>
                <input
                  value={form.platform_reflect_number || ""}
                  onChange={(e) => update("platform_reflect_number", e.target.value)}
                  placeholder="0599XXXXXXX"
                  dir="ltr"
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">رقم Jawwal Pay</label>
                <input
                  value={form.platform_jawwal_number || ""}
                  onChange={(e) => update("platform_jawwal_number", e.target.value)}
                  placeholder="0599XXXXXXX"
                  dir="ltr"
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">اسم صاحب الحساب البنكي</label>
                <input
                  value={form.platform_bank_account_name || ""}
                  onChange={(e) => update("platform_bank_account_name", e.target.value)}
                  placeholder="مثال: علاّم سعيد"
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">IBAN البنكي</label>
                <input
                  value={form.platform_bank_iban || ""}
                  onChange={(e) => update("platform_bank_iban", e.target.value)}
                  placeholder="PS00XXXXXXXXXXXXXXXXXXXXX"
                  dir="ltr"
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none font-mono uppercase"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

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
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={form.commission_rate ?? 0}
              onChange={(e) => {
                // parseInt returns NaN for empty input. Use parseFloat
                // and fall back to 0 so clearing the field doesn't
                // create an invalid state. Clamp to [0, 100].
                const raw = parseFloat(e.target.value);
                const n = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
                update("commission_rate", n);
              }}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
            />
            {form.commission_rate === 0 && (
              <p className="text-[11px] text-green-600 dark:text-green-400 mt-1">
                ✓ العمولة 0% — السائقون يحتفظون بكامل الأرباح. يمكنك زيادتها لاحقاً.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الحد الأدنى للسعر (₪)</label>
            <input type="number" min="0" value={form.min_price} onChange={(e) => update("min_price", parseInt(e.target.value))}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الحد الأقصى للسعر (₪)</label>
            <input type="number" min="1" value={form.max_price} onChange={(e) => update("max_price", parseInt(e.target.value))}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الحد الأقصى للمقاعد</label>
            <input type="number" min="1" max="8" value={form.max_seats} onChange={(e) => update("max_seats", parseInt(e.target.value))}
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

      {/* Home page content */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-bold text-sm mb-1">إعدادات الصفحة الرئيسية</h3>
        <p className="text-xs text-muted-foreground mb-4">
          هذه الحقول تظهر على الصفحة الرئيسية. اتركها فارغة لإخفائها.
        </p>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              نص شارة البطل (Hero Badge)
            </label>
            <input
              value={form.hero_badge_text || ""}
              onChange={(e) => update("hero_badge_text", e.target.value)}
              placeholder="مثال: منصة فلسطينية موثوقة 🇵🇸"
              maxLength={200}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              يظهر فوق العنوان الرئيسي على الصفحة الرئيسية. اتركه فارغاً لإخفاء الشارة.
              <br />
              ⚠️ تجنب أرقاماً غير صحيحة (مثل "10,000 مستخدم") قبل أن تكون لديك بيانات حقيقية.
            </p>
          </div>

          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div className="flex-1 ml-3">
              <p className="text-sm font-medium">عرض شريط الإحصائيات</p>
              <p className="text-xs text-muted-foreground">
                يظهر عدد المستخدمين والرحلات المكتملة على الصفحة الرئيسية —
                فعّله فقط بعد توفر أرقام حقيقية تستحق العرض
              </p>
            </div>
            <button
              onClick={() => update("public_stats_enabled", !form.public_stats_enabled)}
              className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${form.public_stats_enabled ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.public_stats_enabled ? "right-0.5" : "left-0.5"}`} />
            </button>
          </div>

          {form.public_stats_enabled && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                الحد الأدنى لعدد المستخدمين قبل عرض الإحصائيات
              </label>
              <input
                type="number"
                value={form.public_stats_min_users || 100}
                onChange={(e) => update("public_stats_min_users", parseInt(e.target.value) || 0)}
                min={0}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm outline-none"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                حتى لو فُعّل الشريط، لن يظهر إذا كان عدد المستخدمين أقل من هذا الرقم.
                هذا يحميك من عرض أرقام صغيرة محرجة في البداية.
              </p>
            </div>
          )}
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

// ─── Monetization mode summary ─────────────────────────────────────────────
// Translates the (commission, subscription) pair into plain Arabic prose.
// Commission and subscription are independent levers — admin can run any
// combo (free, commission-only, subscription-only, both). This card removes
// the cognitive load of figuring out which combination is currently active.
function MonetizationModeCard({ commissionRate, subscriptionOn, subscriptionPrice }) {
  const hasCommission = (commissionRate ?? 0) > 0;
  const hasSubscription = !!subscriptionOn;

  let title, body, color;

  if (!hasCommission && !hasSubscription) {
    title = "وضع مجاني — لا تحصيل من السائقين";
    body  = "حالياً لا تحصّل المنصة أي مبلغ من السائقين. هذا الوضع مناسب لمرحلة الإطلاق وبناء قاعدة المستخدمين.";
    color = "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400";
  } else if (hasCommission && !hasSubscription) {
    title = `وضع العمولة فقط — ${commissionRate}% لكل رحلة`;
    body  = `تأخذ المنصة ${commissionRate}% من كل رحلة مدفوعة. السائق يحتفظ بالباقي. لا اشتراك شهري.`;
    color = "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400";
  } else if (!hasCommission && hasSubscription) {
    title = `وضع الاشتراك فقط — ₪${subscriptionPrice}/شهر`;
    body  = `السائقون يدفعون ₪${subscriptionPrice} شهرياً ويحتفظون بـ 100% من أرباح كل رحلة. لا عمولة لكل رحلة.`;
    color = "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400";
  } else {
    title = "وضع مزدوج — اشتراك + عمولة";
    body  = `السائقون يدفعون ₪${subscriptionPrice} شهرياً، وأيضاً ${commissionRate}% من كل رحلة. هذا الوضع غير شائع — تأكد أنه مناسب لإستراتيجيتك.`;
    color = "bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400";
  }

  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <p className="text-sm font-bold mb-1">{title}</p>
      <p className="text-xs leading-relaxed">{body}</p>
    </div>
  );
}
