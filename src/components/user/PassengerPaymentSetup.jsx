/**
 * PassengerPaymentSetup — preferred payment method for passengers.
 */
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, Wallet, Building2, Smartphone, CreditCard, AlertCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

const METHODS = [
  { id: "cash",          label: "نقداً",        icon: Wallet,     color: "bg-green-500/10 text-green-600",   desc: "ادفع للسائق نقداً عند نهاية الرحلة" },
  { id: "bank_transfer", label: "تحويل بنكي",  icon: Building2,  color: "bg-blue-500/10 text-blue-600",     desc: "حوّل المبلغ للسائق قبل أو بعد الرحلة" },
  { id: "reflect",       label: "Reflect",      icon: Wallet,     color: "bg-purple-500/10 text-purple-600", desc: "أرسل عبر محفظة Reflect الإلكترونية" },
  { id: "jawwal_pay",    label: "Jawwal Pay",   icon: Smartphone, color: "bg-green-600/10 text-green-700",   desc: "ادفع عبر خدمة Jawwal Pay" },
  // Canonical 'credit_card' — aligns with CreateTrip emit, DriverDashboard
  // methodLabel decode, DriverPaymentSetup tab IDs (fixed in batch 6).
  // preferred_payment isn't cross-referenced with trip-accepted methods
  // yet, so 'card' vs 'credit_card' currently only changes the lookup
  // label, but aligning now future-proofs the value.
  { id: "credit_card",   label: "بطاقة",        icon: CreditCard, color: "bg-rose-500/10 text-rose-600",     desc: "بطاقة ائتمان أو خصم" },
];

// Existing passenger profiles may have the legacy ID 'card' saved.
// Normalize at read time so the new canonical 'credit_card' tile
// still highlights correctly and the bottom-of-page label still
// finds the right entry. New saves write canonical IDs.
function normalizeLegacy(id) {
  if (id === "card") return "credit_card";
  return id;
}

export default function PassengerPaymentSetup({ user }) {
  const [preferred, setPreferred] = useState(normalizeLegacy(user?.preferred_payment) || "cash");
  const qc = useQueryClient();

  // Sync preferred_payment from user. Two-phase patch (June 2026):
  //
  // The previous hydratedRef-keyed-on-email pattern had a race: if
  // user.email arrived in the first React tick (cached session) but
  // user.preferred_payment arrived later (fresh profile), the ref
  // locked on email=present and local state stayed at "cash" default.
  // Passenger clicked save → PATCH sent "cash" → real preference wiped.
  //
  // Fix: only adopt user.preferred_payment when local state is still
  // at the default "cash" AND user has a non-default preference.
  // That way:
  //   - A real saved preference flows in once it arrives, regardless
  //     of whether email or preference field landed first
  //   - A passenger who actively clicked "cash" or stayed on default
  //     isn't disrupted (their selection persists)
  //   - Re-fetches of `me` don't clobber in-progress tile selections
  useEffect(() => {
    if (!user?.email) return;
    const fromUser = normalizeLegacy(user.preferred_payment);
    if (!fromUser || fromUser === "cash") return;
    setPreferred((prev) => (prev === "cash" ? fromUser : prev));
  }, [user?.email, user?.preferred_payment]);

  const save = useMutation({
    mutationFn: () => api.auth.updateMe({ preferred_payment: preferred }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حفظ طريقة الدفع المفضلة ✅");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الحفظ")),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20">
        <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground">
          اختر طريقتك المفضلة للدفع. الدفع يتم مباشرة للسائق — مشوارو لا تتوسط في المدفوعات.
        </p>
      </div>

      <div className="space-y-2">
        {METHODS.map(m => (
          <button
            key={m.id}
            onClick={() => setPreferred(m.id)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-right ${
              preferred === m.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/30 bg-card"
            }`}
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${m.color}`}>
              <m.icon className="w-4.5 h-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{m.label}</p>
              <p className="text-xs text-muted-foreground">{m.desc}</p>
            </div>
            <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
              preferred === m.id ? "border-primary bg-primary" : "border-border"
            }`}>
              {preferred === m.id && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
            </div>
          </button>
        ))}
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full rounded-xl h-10 gap-2">
        <CheckCircle className="w-4 h-4" />
        {save.isPending ? "جاري الحفظ..." : "حفظ التفضيل"}
      </Button>

      {user?.preferred_payment && (
        <p className="text-xs text-center text-muted-foreground">
          طريقتك المفضلة الحالية: <span className="font-medium text-foreground">{METHODS.find(m=>m.id===normalizeLegacy(user.preferred_payment))?.label}</span>
        </p>
      )}
    </div>
  );
}
