/**
 * DriverPaymentSetup — complete payout method configuration for drivers.
 * Supports: Bank Transfer, Reflect, Jawwal Pay, Card (info only)
 */
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, CreditCard, CheckCircle, AlertCircle, Wallet, Smartphone } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

// Tab IDs aligned with the canonical payment-method IDs that CreateTrip
// emits and DriverDashboard.methodLabel decodes. This is setup-time UI
// only — the tab ID never reaches a booking/trip row — but using the
// canonical IDs avoids future surprises (e.g. if someone later wires
// /driver?tab=payments&method=bank_transfer URL routing). Resolves the
// documented follow-up from phase 1 batch 3.
const TABS = [
  { id: "bank_transfer", label: "تحويل بنكي",  icon: Building2,  color: "text-blue-600"   },
  { id: "reflect",       label: "Reflect",      icon: Wallet,     color: "text-purple-600" },
  { id: "jawwal_pay",    label: "Jawwal Pay",   icon: Smartphone, color: "text-green-600"  },
  { id: "credit_card",   label: "بطاقة",        icon: CreditCard, color: "text-rose-600"   },
];

function SavedBadge({ text }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-xl border border-green-500/20">
      <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
      <p className="text-sm text-green-800">{text}</p>
    </div>
  );
}

export default function DriverPaymentSetup({ user }) {
  const [tab, setTab] = useState("bank_transfer");
  const qc = useQueryClient();

  const [bank, setBank] = useState({
    bank_name:           user?.bank_name           || "",
    bank_account_name:   user?.bank_account_name   || "",
    bank_account_number: user?.bank_account_number || "",
    bank_iban:           user?.bank_iban           || "",
  });
  const [reflect,   setReflect]   = useState({ reflect_number:    user?.reflect_number    || "" });
  const [jawwal,    setJawwal]    = useState({ jawwal_pay_number: user?.jawwal_pay_number || "" });
  const [card,      setCard]      = useState({
    card_holder_name: user?.card_holder_name || "",
    card_last_four:   user?.card_last_four   || "",
  });

  // Sync state from user. Two-phase patch (June 2026):
  //
  // The previous hydratedRef-keyed-on-email approach had a race:
  // user.email arrives in the first React tick (cached session) while
  // bank_*/reflect_*/jawwal_*/card_* fields arrive in a later tick
  // (fresh profile). The ref locked on email=present and the state
  // stayed empty. Drivers opened payment setup, saw blank fields,
  // saved "to refresh" → empty values wiped real bank/payout details.
  //
  // The fix: merge from user into local state ONLY for fields the
  // local state doesn't already have a value for. Never clobber a
  // driver's in-progress edits, and never reset to empty.
  useEffect(() => {
    if (!user?.email) return;
    setBank((prev) => {
      const patch = {};
      if (!prev.bank_name           && user.bank_name)           patch.bank_name           = user.bank_name;
      if (!prev.bank_account_name   && user.bank_account_name)   patch.bank_account_name   = user.bank_account_name;
      if (!prev.bank_account_number && user.bank_account_number) patch.bank_account_number = user.bank_account_number;
      if (!prev.bank_iban           && user.bank_iban)           patch.bank_iban           = user.bank_iban;
      return Object.keys(patch).length ? { ...prev, ...patch } : prev;
    });
    setReflect((prev) =>
      !prev.reflect_number && user.reflect_number
        ? { reflect_number: user.reflect_number }
        : prev
    );
    setJawwal((prev) =>
      !prev.jawwal_pay_number && user.jawwal_pay_number
        ? { jawwal_pay_number: user.jawwal_pay_number }
        : prev
    );
    setCard((prev) => {
      const patch = {};
      if (!prev.card_holder_name && user.card_holder_name) patch.card_holder_name = user.card_holder_name;
      if (!prev.card_last_four   && user.card_last_four)   patch.card_last_four   = user.card_last_four;
      return Object.keys(patch).length ? { ...prev, ...patch } : prev;
    });
  }, [user?.email, user?.bank_name, user?.bank_account_name, user?.bank_account_number,
      user?.bank_iban, user?.reflect_number, user?.jawwal_pay_number,
      user?.card_holder_name, user?.card_last_four]);

  const save = useMutation({
    mutationFn: (data) => api.auth.updateMe(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حفظ بيانات الدفع ✅");
    },
    onError: (err) => toast.error(friendlyError(err, "فشل الحفظ")),
  });

  const handleSave = () => {
    if (tab === "bank_transfer") {
      if (!bank.bank_name || !bank.bank_account_name || !bank.bank_account_number) {
        toast.error("يرجى ملء اسم البنك واسم الحساب ورقمه");
        return;
      }
      save.mutate(bank);
    } else if (tab === "reflect") {
      if (!reflect.reflect_number) { toast.error("أدخل رقم Reflect"); return; }
      save.mutate(reflect);
    } else if (tab === "jawwal_pay") {
      if (!jawwal.jawwal_pay_number) { toast.error("أدخل رقم هاتف Jawwal Pay"); return; }
      save.mutate(jawwal);
    } else if (tab === "credit_card") {
      if (!card.card_holder_name || !card.card_last_four) {
        toast.error("يرجى ملء اسم صاحب البطاقة وآخر 4 أرقام");
        return;
      }
      save.mutate(card);
    }
  };

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
        <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground">
          أضف طرق استلام المدفوعات — يستطيع الركاب رؤية الطرق المتاحة بعد تأكيد حجزهم.
          بياناتك البنكية لن تُعرض للعموم.
        </p>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 bg-muted/50 p-1 rounded-xl">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg text-xs font-medium transition-all ${
              tab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className={`w-4 h-4 ${tab === t.id ? t.color : ""}`} />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Bank Transfer */}
      {tab === "bank_transfer" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">اسم البنك *</Label>
              <Input value={bank.bank_name} onChange={e => setBank({...bank, bank_name: e.target.value})}
                placeholder="مثال: البنك الفلسطيني، بنك القاهرة عمّان" className="h-10 rounded-xl mt-1 text-sm" />
            </div>
            <div>
              <Label className="text-xs">اسم صاحب الحساب *</Label>
              <Input value={bank.bank_account_name} onChange={e => setBank({...bank, bank_account_name: e.target.value})}
                placeholder="اسمك كاملاً" className="h-10 rounded-xl mt-1 text-sm" />
            </div>
            <div>
              <Label className="text-xs">رقم الحساب *</Label>
              <Input value={bank.bank_account_number} onChange={e => setBank({...bank, bank_account_number: e.target.value})}
                placeholder="رقم الحساب البنكي" className="h-10 rounded-xl mt-1 text-sm" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">IBAN (اختياري)</Label>
              <Input value={bank.bank_iban} onChange={e => setBank({...bank, bank_iban: e.target.value})}
                placeholder="PS86PALS000000000400123456702" className="h-10 rounded-xl mt-1 text-sm" dir="ltr" />
            </div>
          </div>
          {user?.bank_account_number && <SavedBadge text={`✓ ${user.bank_name || "البنك"} — ${user.bank_account_number}`} />}
        </div>
      )}

      {/* Reflect */}
      {tab === "reflect" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-4 bg-purple-500/8 rounded-xl border border-purple-500/20">
            <Wallet className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Reflect — المحفظة الإلكترونية</p>
              <p className="text-xs text-muted-foreground mt-1">
                أدخل رقم محفظة Reflect الخاص بك. سيتمكن الراكب من إرسال المبلغ مباشرة.
              </p>
            </div>
          </div>
          <div>
            <Label className="text-xs">رقم محفظة Reflect *</Label>
            <Input value={reflect.reflect_number}
              onChange={e => setReflect({ reflect_number: e.target.value })}
              placeholder="رقم هاتفك أو معرّف Reflect"
              className="h-10 rounded-xl mt-1 text-sm" dir="ltr" />
          </div>
          {user?.reflect_number && <SavedBadge text={`✓ Reflect: ${user.reflect_number}`} />}
        </div>
      )}

      {/* Jawwal Pay */}
      {tab === "jawwal_pay" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-4 bg-green-500/8 rounded-xl border border-green-500/20">
            <Smartphone className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Jawwal Pay — الدفع عبر جوال</p>
              <p className="text-xs text-muted-foreground mt-1">
                أدخل رقم هاتف جوال المرتبط بخدمة Jawwal Pay.
              </p>
            </div>
          </div>
          <div>
            <Label className="text-xs">رقم Jawwal Pay *</Label>
            <Input value={jawwal.jawwal_pay_number}
              onChange={e => setJawwal({ jawwal_pay_number: e.target.value })}
              placeholder="059XXXXXXX أو +970591234567"
              className="h-10 rounded-xl mt-1 text-sm" dir="ltr" />
          </div>
          {user?.jawwal_pay_number && <SavedBadge text={`✓ Jawwal Pay: ${user.jawwal_pay_number}`} />}
        </div>
      )}

      {/* Card (info only) */}
      {tab === "credit_card" && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-4 bg-amber-500/8 rounded-xl border border-amber-500/20">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">بطاقة ائتمان / خصم</p>
              <p className="text-xs text-muted-foreground mt-1">
                نحفظ آخر 4 أرقام فقط كمرجع. الدفع الفعلي يتم بالاتفاق مع الراكب.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">اسم صاحب البطاقة *</Label>
              <Input value={card.card_holder_name}
                onChange={e => setCard({...card, card_holder_name: e.target.value})}
                placeholder="الاسم على البطاقة" className="h-10 rounded-xl mt-1 text-sm" />
            </div>
            <div>
              <Label className="text-xs">آخر 4 أرقام *</Label>
              <Input value={card.card_last_four}
                onChange={e => setCard({...card, card_last_four: e.target.value.replace(/\D/g,'').slice(0,4)})}
                placeholder="1234" maxLength={4} className="h-10 rounded-xl mt-1 text-sm" dir="ltr" />
            </div>
          </div>
          {user?.card_last_four && <SavedBadge text={`✓ بطاقة تنتهي بـ ****${user.card_last_four}`} />}
        </div>
      )}

      <Button onClick={handleSave} disabled={save.isPending} className="w-full rounded-xl h-10 gap-2">
        <CheckCircle className="w-4 h-4" />
        {save.isPending ? "جاري الحفظ..." : "حفظ طريقة الاستلام"}
      </Button>
    </div>
  );
}
