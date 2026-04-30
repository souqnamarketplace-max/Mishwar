/**
 * PassengerPaymentSetup — preferred payment method for passengers.
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, Wallet, Building2, Smartphone, CreditCard, AlertCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const METHODS = [
  { id: "cash",          label: "نقداً",        icon: Wallet,     color: "bg-green-500/10 text-green-600",   desc: "ادفع للسائق نقداً عند نهاية الرحلة" },
  { id: "bank_transfer", label: "تحويل بنكي",  icon: Building2,  color: "bg-blue-500/10 text-blue-600",     desc: "حوّل المبلغ للسائق قبل أو بعد الرحلة" },
  { id: "reflect",       label: "Reflect",      icon: Wallet,     color: "bg-purple-500/10 text-purple-600", desc: "أرسل عبر محفظة Reflect الإلكترونية" },
  { id: "jawwal_pay",    label: "Jawwal Pay",   icon: Smartphone, color: "bg-green-600/10 text-green-700",   desc: "ادفع عبر خدمة Jawwal Pay" },
  { id: "card",          label: "بطاقة",        icon: CreditCard, color: "bg-rose-500/10 text-rose-600",     desc: "بطاقة ائتمان أو خصم" },
];

export default function PassengerPaymentSetup({ user }) {
  const [preferred, setPreferred] = useState(user?.preferred_payment || "cash");
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => base44.auth.updateMe({ preferred_payment: preferred }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حفظ طريقة الدفع المفضلة ✅");
    },
    onError: (err) => toast.error(err?.message || "فشل الحفظ"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20">
        <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground">
          اختر طريقتك المفضلة للدفع. الدفع يتم مباشرة للسائق — مِشوار لا تتوسط في المدفوعات.
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
          طريقتك المفضلة الحالية: <span className="font-medium text-foreground">{METHODS.find(m=>m.id===user.preferred_payment)?.label}</span>
        </p>
      )}
    </div>
  );
}
