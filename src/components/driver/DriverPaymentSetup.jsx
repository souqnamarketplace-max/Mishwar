import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign, CreditCard, Building2, AlertCircle, CheckCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function DriverPaymentSetup({ user }) {
  const [activeTab, setActiveTab] = useState("bank");
  const [bankForm, setBankForm] = useState({
    bank_name: user?.bank_name || "",
    bank_account_name: user?.bank_account_name || "",
    bank_account_number: user?.bank_account_number || "",
    bank_iban: user?.bank_iban || "",
  });
  const [cardForm, setCardForm] = useState({
    card_holder_name: user?.card_holder_name || "",
    card_last_four: user?.card_last_four || "",
  });
  const qc = useQueryClient();

  const saveBankMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حفظ بيانات البنك بنجاح! 🏦");
    },
  });

  const saveCardMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حفظ بيانات البطاقة بنجاح! 💳");
    },
  });

  const handleSaveBank = () => {
    if (!bankForm.bank_name || !bankForm.bank_account_name || !bankForm.bank_account_number) {
      toast.error("يرجى ملء جميع الحقول المطلوبة");
      return;
    }
    saveBankMutation.mutate(bankForm);
  };

  const handleSaveCard = () => {
    if (!cardForm.card_holder_name || !cardForm.card_last_four) {
      toast.error("يرجى ملء جميع الحقول المطلوبة");
      return;
    }
    saveCardMutation.mutate(cardForm);
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 bg-muted/50 p-1 rounded-xl w-fit">
        {[
          { id: "bank", label: "تحويل بنكي", icon: Building2 },
          { id: "card", label: "بطاقة ائتمان", icon: CreditCard },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Bank Transfer */}
      {activeTab === "bank" && (
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <div className="flex items-start gap-3 p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-900">معلومة أمان</p>
              <p className="text-xs text-blue-800 mt-1">بيانات حسابك البنكي آمنة ومشفرة ولن تُعرض للركاب</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>اسم البنك <span className="text-destructive">*</span></Label>
              <Input
                value={bankForm.bank_name}
                onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })}
                placeholder="مثال: البنك الفلسطيني"
                className="h-11 rounded-xl mt-1"
              />
            </div>
            <div>
              <Label>اسم صاحب الحساب <span className="text-destructive">*</span></Label>
              <Input
                value={bankForm.bank_account_name}
                onChange={(e) => setBankForm({ ...bankForm, bank_account_name: e.target.value })}
                placeholder="اسمك كاملاً"
                className="h-11 rounded-xl mt-1"
              />
            </div>
            <div>
              <Label>رقم الحساب البنكي <span className="text-destructive">*</span></Label>
              <Input
                value={bankForm.bank_account_number}
                onChange={(e) => setBankForm({ ...bankForm, bank_account_number: e.target.value })}
                placeholder="رقم الحساب"
                className="h-11 rounded-xl mt-1"
              />
            </div>
            <div>
              <Label>IBAN (اختياري)</Label>
              <Input
                value={bankForm.bank_iban}
                onChange={(e) => setBankForm({ ...bankForm, bank_iban: e.target.value })}
                placeholder="PS..."
                className="h-11 rounded-xl mt-1"
              />
            </div>
          </div>

          <Button
            onClick={handleSaveBank}
            disabled={saveBankMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl w-full gap-2"
          >
            {saveBankMutation.isPending ? "جاري الحفظ..." : (
              <>
                <CheckCircle className="w-4 h-4" />
                حفظ بيانات البنك
              </>
            )}
          </Button>

          {user?.bank_account_number && (
            <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/20 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <p className="text-sm text-green-900">✓ تم حفظ بيانات حسابك البنكي</p>
            </div>
          )}
        </div>
      )}

      {/* Card Payment */}
      {activeTab === "card" && (
        <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
          <div className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-900">قيد الإعداد</p>
              <p className="text-xs text-amber-800 mt-1">معالجة الدفع بالبطاقة جاري إعدادها. حالياً يمكنك حفظ البيانات الأساسية.</p>
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
              <p className="text-sm text-green-900">✓ تم حفظ بيانات البطاقة (****{user.card_last_four})</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}