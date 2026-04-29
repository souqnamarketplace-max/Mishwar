import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Wallet, AlertCircle, CheckCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function PassengerPaymentSetup({ user }) {
  const [cardForm, setCardForm] = useState({
    card_holder_name: user?.card_holder_name || "",
    card_last_four: user?.card_last_four || "",
  });
  const qc = useQueryClient();

  const saveCardMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حفظ بيانات البطاقة بنجاح! 💳");
    },
  });

  const handleSaveCard = () => {
    if (!cardForm.card_holder_name || !cardForm.card_last_four) {
      toast.error("يرجى ملء جميع الحقول المطلوبة");
      return;
    }
    saveCardMutation.mutate(cardForm);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-lg text-foreground mb-4">طرق الدفع</h3>
        <p className="text-sm text-muted-foreground mb-6">أضف وأدِر طرق دفعك المفضلة للحجوزات</p>
      </div>

      {/* Payment Methods Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { id: "cash", label: "نقداً", icon: Wallet, color: "text-green-600" },
          { id: "card", label: "بطاقة ائتمان", icon: CreditCard, color: "text-blue-600" },
          { id: "bank", label: "تحويل بنكي", icon: Wallet, color: "text-purple-600" },
        ].map((method) => (
          <div
            key={method.id}
            className="bg-card rounded-2xl border border-border p-5 text-center"
          >
            <div className={`w-12 h-12 rounded-xl ${method.color.replace("text-", "bg-").replace("-600", "/10")} flex items-center justify-center mx-auto mb-3`}>
              <method.icon className={`w-6 h-6 ${method.color}`} />
            </div>
            <p className="font-medium text-foreground text-sm">{method.label}</p>
            <p className="text-xs text-muted-foreground mt-1">متاح دائماً</p>
          </div>
        ))}
      </div>

      {/* Card Details Section */}
      <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-primary" />
          <h4 className="font-bold text-foreground">بطاقة الائتمان</h4>
        </div>

        <div className="flex items-start gap-3 p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
          <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-900">معلومة أمان</p>
            <p className="text-xs text-blue-800 mt-1">نحفظ فقط آخر 4 أرقام من بطاقتك لتسهيل عملية الدفع بأمان</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>اسم صاحب البطاقة <span className="text-destructive">*</span></Label>
            <Input
              value={cardForm.card_holder_name}
              onChange={(e) => setCardForm({ ...cardForm, card_holder_name: e.target.value })}
              placeholder="الاسم الكامل"
              className="h-11 rounded-xl mt-1"
            />
          </div>
          <div>
            <Label>آخر 4 أرقام من البطاقة <span className="text-destructive">*</span></Label>
            <Input
              value={cardForm.card_last_four}
              onChange={(e) => setCardForm({ ...cardForm, card_last_four: e.target.value.slice(0, 4) })}
              placeholder="1234"
              maxLength="4"
              className="h-11 rounded-xl mt-1"
            />
          </div>
        </div>

        <Button
          onClick={handleSaveCard}
          disabled={saveCardMutation.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl w-full gap-2"
        >
          {saveCardMutation.isPending ? "جاري الحفظ..." : (
            <>
              <CheckCircle className="w-4 h-4" />
              حفظ بيانات البطاقة
            </>
          )}
        </Button>

        {user?.card_last_four && (
          <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/20 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-sm text-green-900">✓ تم حفظ بطاقتك (****{user.card_last_four})</p>
          </div>
        )}
      </div>

      {/* Cash & Bank Info */}
      <div className="bg-muted/50 rounded-2xl border border-border p-6 space-y-4">
        <h4 className="font-bold text-foreground">طرق دفع إضافية</h4>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Wallet className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm text-foreground">الدفع النقدي</p>
              <p className="text-xs text-muted-foreground mt-0.5">ادفع للسائق نقداً عند نهاية الرحلة</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Wallet className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm text-foreground">التحويل البنكي</p>
              <p className="text-xs text-muted-foreground mt-0.5">حول المبلغ مباشرة قبل أو بعد الرحلة</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}