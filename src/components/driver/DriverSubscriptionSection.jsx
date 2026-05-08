/**
 * DriverSubscriptionSection — driver-facing subscription management.
 *
 * Renders 4 distinct states based on driver_subscription_status RPC:
 *
 *   not_required    → "اشتراك المنصة غير إلزامي حالياً" (kill switch off)
 *   active          → green "ساري حتى DATE — N يوماً متبقياً"
 *   in_grace        → yellow "انتهى — أنت في فترة سماح N أيام"
 *   pending_review  → blue "طلبك قيد المراجعة"
 *   expired / never → red "اشترك الآن للنشر" + the new-subscription form
 *
 * The form lets the driver claim they paid via one of the platform's rails
 * (Reflect / Jawwal / IBAN — pulled from app_settings.platform_*_number),
 * with a reference number and an optional proof screenshot. Submit creates
 * a row in driver_subscriptions with status='pending'. Admin reviews via
 * /dashboard?tab=subscriptions and approves or rejects.
 *
 * Money flow:
 *   1. Driver sees admin's payment rails on this page
 *   2. Driver sends ₪X via their own Reflect/Jawwal/banking app to admin
 *   3. Driver fills form claiming they paid + uploads optional proof
 *   4. Admin verifies the deposit landed and approves
 *   5. period_start = approved_at, period_end = approved_at + 30 days
 *   6. Driver returns to this page → green "active" state
 */
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { compressImage } from "@/lib/compressImage";
import { formatArabicDate } from "@/lib/validation";
import {
  CheckCircle, AlertCircle, Clock, Copy, Building2, Wallet, Smartphone, Upload, Image as ImageIcon,
} from "lucide-react";

const METHODS = [
  { id: "bank_transfer", label: "تحويل بنكي",  icon: Building2  },
  { id: "reflect",       label: "Reflect",      icon: Wallet     },
  { id: "jawwal_pay",    label: "Jawwal Pay",   icon: Smartphone },
];

export default function DriverSubscriptionSection({ user }) {
  const qc = useQueryClient();

  // Passenger guard — even though the AccountHub link and mobile drawer
  // entry are already gated, the /driver route itself isn't account-type
  // protected, so a curious passenger could URL-hack to ?tab=subscription.
  // Show them a friendly "this isn't for you" instead of a working form
  // that could clutter the admin queue with no-op requests.
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";
  if (user && !isDriver) {
    return (
      <div className="bg-muted/40 border border-border rounded-2xl p-5">
        <h3 className="font-bold text-foreground mb-1">هذه الصفحة للسائقين فقط</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          الاشتراك الشهري يخص حسابات السائقين. إذا كنت تريد التسجيل كسائق، يمكنك ذلك من صفحة "كن سائقاً".
        </p>
      </div>
    );
  }

  // ── 1) Read app_settings (price + platform rails) ────────────────────────
  const { data: settingsArr = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => base44.entities.AppSettings.list(),
    staleTime: 60_000,
  });
  const settings = settingsArr[0] || {};
  const price = settings.subscription_price ?? 30;
  const periodDays = settings.subscription_period_days ?? 30;

  // ── 2) Read current subscription status from RPC ─────────────────────────
  // RPC may not exist if migration 009 hasn't been applied yet. We catch
  // the specific error and surface a clear "system not yet active" message
  // instead of crashing the page or showing a generic error toast.
  const { data: status = { status: "loading", allowed: true }, isLoading } = useQuery({
    queryKey: ["subscription-status", user?.email],
    queryFn: async () => {
      if (!user?.email) return { status: "loading", allowed: true };
      const { data, error } = await supabase.rpc("driver_subscription_status", {
        p_driver_email: user.email,
      });
      if (error) {
        // PostgREST returns 404 + code "PGRST202" (or similar) when an
        // RPC doesn't exist. Surface as a benign "not deployed yet" state
        // rather than throwing — keeps the page usable for the driver
        // even when the backend hasn't been migrated.
        if (
          error.code === "PGRST202" ||
          /function .* does not exist/i.test(error.message || "") ||
          /not found/i.test(error.message || "")
        ) {
          return { status: "not_deployed", allowed: true };
        }
        throw error;
      }
      return data || { status: "loading", allowed: true };
    },
    enabled: !!user?.email,
    refetchOnWindowFocus: true,
    retry: 0, // RPC presence shouldn't trigger retries; either it's there or it isn't
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="animate-pulse h-20 bg-muted/40 rounded-xl" />
      </div>
    );
  }

  // RPC not yet deployed (migration 009 not applied) — same UX as
  // "kill switch off": tell the driver no action is needed
  if (status.status === "not_deployed" || status.status === "not_required") {
    return (
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-foreground mb-1">اشتراك المنصة غير إلزامي حالياً</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              في الوقت الحالي يمكنك نشر رحلاتك بدون اشتراك. عند تفعيل نظام الاشتراك مستقبلاً ستصلك رسالة قبل أسبوعين.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── State banner ──────────────────────────────────────────────── */}
      <StatusBanner status={status} />

      {/* ── New subscription form (shown only when can/should subscribe) ── */}
      {(status.status === "expired" || status.status === "never_subscribed") && (
        <SubscribeForm
          user={user}
          price={price}
          periodDays={periodDays}
          settings={settings}
          onSubmitted={() => qc.invalidateQueries({ queryKey: ["subscription-status", user.email] })}
        />
      )}

      {/* Renewal CTA in grace period — driver should submit before expiry */}
      {status.status === "in_grace" && (
        <SubscribeForm
          user={user}
          price={price}
          periodDays={periodDays}
          settings={settings}
          variant="renewal"
          onSubmitted={() => qc.invalidateQueries({ queryKey: ["subscription-status", user.email] })}
        />
      )}
    </div>
  );
}

// ── Status banner — color + copy varies by state ─────────────────────────
function StatusBanner({ status }) {
  if (status.status === "active") {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-foreground mb-0.5">اشتراكك ساري ✓</h3>
            <p className="text-sm text-muted-foreground">
              ينتهي في {formatArabicDate(status.period_end)} — متبقي {status.days_remaining} يوماً
            </p>
            {status.days_remaining <= 7 && (
              <p className="text-[12px] text-yellow-700 dark:text-yellow-500 mt-2 font-medium">
                ⚠️ ينتهي اشتراكك قريباً — يفضّل التجديد قبل انتهاء المدة لتفادي الانقطاع
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status.status === "in_grace") {
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-foreground mb-0.5">انتهى اشتراكك — أنت في فترة سماح</h3>
            <p className="text-sm text-muted-foreground">
              متبقي {status.grace_days_left} أيام لتجديد الاشتراك. بعدها لن تتمكن من نشر رحلات جديدة.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status.status === "pending_review") {
    return (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-foreground mb-0.5">طلبك قيد المراجعة</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              نقوم بالتحقق من تحويل الدفع. عادةً تكتمل المراجعة خلال 24 ساعة. ستصلك رسالة فور التفعيل.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status.status === "expired") {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-foreground mb-0.5">انتهى اشتراكك</h3>
            <p className="text-sm text-muted-foreground">
              لا يمكنك نشر رحلات جديدة حتى تجدد الاشتراك. الرحلات المنشورة سابقاً تبقى متاحة للركاب.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // never_subscribed
  return (
    <div className="bg-muted/40 border border-border rounded-xl p-4">
      <h3 className="font-bold text-foreground mb-1">اشترك في مِشوار للسائقين</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        فعّل اشتراكك الشهري للنشر بلا قيود. نوفر لك إدارة كاملة لرحلاتك، تواصل مباشر مع الركاب، وحساب موثّق.
      </p>
    </div>
  );
}

// ── Subscription request form ─────────────────────────────────────────────
function SubscribeForm({ user, price, periodDays, settings, variant = "new", onSubmitted }) {
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  // Available rails — only show methods admin has actually configured
  const rails = [
    settings.platform_reflect_number && {
      id: "reflect", label: "Reflect", number: settings.platform_reflect_number, icon: Wallet,
    },
    settings.platform_jawwal_number && {
      id: "jawwal_pay", label: "Jawwal Pay", number: settings.platform_jawwal_number, icon: Smartphone,
    },
    settings.platform_bank_iban && {
      id: "bank_transfer",
      label: "تحويل بنكي",
      number: settings.platform_bank_iban,
      account_name: settings.platform_bank_account_name,
      icon: Building2,
    },
  ].filter(Boolean);

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`✓ تم نسخ ${label}`);
  };

  const onProofUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      toast.error("حجم الملف أكبر من 12 MB");
      return;
    }
    if (!file.type.startsWith("image/") && !file.type.includes("pdf")) {
      toast.error("صورة أو PDF فقط");
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressImage(file).catch(() => file);
      const ext = (compressed.name || file.name).split(".").pop();
      const path = `${user.id}/subscription-proof-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("uploads").upload(path, compressed, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("uploads").getPublicUrl(path);
      setProofUrl(publicUrl);
      toast.success("✓ تم رفع إثبات الدفع");
    } catch (err) {
      toast.error(`خطأ: ${friendlyError(err, "حاول مجدداً")}`);
    } finally {
      setUploading(false);
    }
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!method) throw new Error("اختر طريقة الدفع التي استخدمتها");
      if (!reference || reference.length < 3) throw new Error("أدخل رقم العملية أو المرجع");
      // amount is set server-side via the snapshot trigger, so we don't pass it
      const { data, error } = await supabase.from("driver_subscriptions").insert({
        driver_email:      user.email,
        amount:            price,         // overwritten by trigger; included for compatibility
        status:            "pending",
        payment_method:    method,
        payment_reference: reference,
        proof_url:         proofUrl || null,
        driver_note:       note || null,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("✓ تم إرسال طلبك. ستصلك رسالة فور المراجعة");
      onSubmitted?.();
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الإرسال")),
  });

  return (
    <div className="bg-card rounded-2xl border border-border p-5 space-y-5">
      {/* Heading */}
      <div>
        <h3 className="font-bold text-lg text-foreground mb-1">
          {variant === "renewal" ? "تجديد الاشتراك" : "اشترك الآن"}
        </h3>
        <p className="text-sm text-muted-foreground">
          الاشتراك الشهري <span className="font-bold text-primary">₪{price}</span> صالح لمدة {periodDays} يوماً
        </p>
      </div>

      {/* Step 1 — show platform rails */}
      <div>
        <h4 className="font-bold text-sm text-foreground mb-3">1. حوّل المبلغ لإحدى هذه الطرق</h4>
        {rails.length === 0 ? (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 text-sm text-muted-foreground">
            لم يتم إعداد طرق الدفع بعد. تواصل مع الإدارة.
          </div>
        ) : (
          <div className="space-y-2">
            {rails.map((rail) => (
              <div key={rail.id} className="bg-muted/30 rounded-xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
                  <rail.icon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{rail.label}</p>
                  <p className="text-sm font-mono font-bold text-foreground truncate" dir="ltr">{rail.number}</p>
                  {rail.account_name && (
                    <p className="text-[11px] text-muted-foreground">{rail.account_name}</p>
                  )}
                </div>
                <button
                  onClick={() => copyToClipboard(rail.number, rail.label)}
                  className="p-2 hover:bg-muted rounded-lg shrink-0"
                  type="button"
                  aria-label="نسخ"
                >
                  <Copy className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 2 — claim form */}
      <div className="space-y-4 pt-3 border-t border-border">
        <h4 className="font-bold text-sm text-foreground">2. أكمل النموذج بعد التحويل</h4>

        <div>
          <Label className="text-sm">طريقة الدفع المستخدمة *</Label>
          <div className="grid grid-cols-3 gap-2 mt-1.5">
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className={`p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  method === m.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/30"
                }`}
              >
                <m.icon className="w-4 h-4 mx-auto mb-1" />
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-sm">رقم العملية / المرجع *</Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === "reflect" ? "آخر 8 أرقام من العملية" : "رقم العملية البنكية"}
            className="rounded-xl h-10 mt-1"
          />
        </div>

        {/* Proof upload */}
        <div>
          <Label className="text-sm">إثبات الدفع (اختياري)</Label>
          <input
            id="sub-proof-file"
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={onProofUpload}
            disabled={uploading}
          />
          {proofUrl ? (
            <div className="mt-1.5 flex items-center gap-2 p-2 bg-green-500/5 border border-green-500/20 rounded-xl">
              <ImageIcon className="w-4 h-4 text-green-600" />
              <span className="text-xs flex-1">تم رفع الإثبات</span>
              <button
                type="button"
                onClick={() => document.getElementById("sub-proof-file").click()}
                className="text-xs text-muted-foreground underline"
              >
                تغيير
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => document.getElementById("sub-proof-file").click()}
              disabled={uploading}
              className="w-full mt-1.5 border-2 border-dashed border-border hover:border-primary/40 rounded-xl py-3 text-center disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <div className="w-4 h-4 mx-auto mb-1 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-primary">جاري الرفع...</p>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">اضغط لرفع لقطة شاشة (يساعد في تسريع المراجعة)</p>
                </>
              )}
            </button>
          )}
        </div>

        <div>
          <Label className="text-sm">ملاحظة للإدارة (اختياري)</Label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="أي تفاصيل تساعدنا في التحقق"
            rows={2}
            maxLength={500}
            className="w-full mt-1 bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm outline-none resize-none"
          />
        </div>

        <Button
          onClick={() => submit.mutate()}
          disabled={submit.isPending || uploading || !method || !reference}
          className="w-full bg-primary text-primary-foreground rounded-xl h-11"
        >
          {submit.isPending ? "جاري الإرسال..." : "إرسال للمراجعة"}
        </Button>
      </div>
    </div>
  );
}
