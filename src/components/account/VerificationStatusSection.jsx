import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import { checkDriverEligibility, daysUntil } from "@/lib/driverEligibility";
import { ShieldCheck, Clock, AlertTriangle, XCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VerificationStatusSection() {
  const { user } = useAuth();

  const { data: licenses = [], isLoading } = useQuery({
    queryKey: ["driver-licenses-all", user?.email],
    queryFn: () =>
      user?.email
        ? api.entities.DriverLicense.filter({ driver_email: user.email }, "-created_date", 10)
        : [],
    enabled: !!user?.email,
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">جارٍ التحميل…</div>;
  }

  const eligibility = checkDriverEligibility(licenses);
  const { latest, pending, lastRejected } = eligibility;

  return (
    <div className="p-6 space-y-4" dir="rtl">
      {/* State 1: Has pending submission */}
      {pending && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-foreground mb-1">قيد المراجعة</h3>
              <p className="text-sm text-muted-foreground">
                وثائقك الجديدة قيد مراجعة الإدارة. سيتم إعلامك بمجرد اعتمادها.
              </p>
              {latest && eligibility.allowed && (
                <p className="text-xs text-muted-foreground mt-2">
                  ✓ يمكنك نشر الرحلات حالياً باستخدام وثائقك السابقة الموافق عليها.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* State 2: Last submission was rejected */}
      {lastRejected && !pending && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-foreground mb-1">تم رفض آخر تحديث</h3>
              <p className="text-sm text-muted-foreground mb-2">
                سبب الرفض: {lastRejected.rejection_reason || "لم يحدد سبب"}
              </p>
              <p className="text-xs text-muted-foreground">
                يمكنك إعادة رفع وثائق جديدة في أي وقت.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* State 3: Active approved with expiry status */}
      {latest && eligibility.allowed && !pending && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-foreground mb-1">موثَّق</h3>
              <ExpiryRows license={latest} />
              {eligibility.expiringSoon && (
                <p className="text-xs text-yellow-600 mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  بعض الوثائق ستنتهي قريباً — يُنصح بالتحديث
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* State 4: Cannot publish trips. Three sub-cases:
            - first_time_pending: brand-new driver awaiting initial approval
            - expired_no_pending: previously approved, docs expired, no resubmit yet
            - no_docs: never submitted */}
      {!eligibility.allowed && (
        <div className={`rounded-xl p-4 border ${
          eligibility.reason === "first_time_pending"
            ? "bg-yellow-500/10 border-yellow-500/30"
            : "bg-red-500/10 border-red-500/30"
        }`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${
              eligibility.reason === "first_time_pending" ? "text-yellow-600" : "text-red-600"
            }`} />
            <div className="flex-1">
              <h3 className="font-bold text-foreground mb-1">
                {eligibility.reason === "no_docs"
                  ? "لم ترفع وثائق بعد"
                  : eligibility.reason === "first_time_pending"
                  ? "وثائقك قيد المراجعة"
                  : "انتهت صلاحية الوثائق"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {eligibility.reason === "first_time_pending"
                  ? "ستتمكن من نشر الرحلات فور قبول وثائقك. مدة المراجعة عادة 1-3 أيام عمل."
                  : "لا يمكنك نشر رحلات حالياً. يرجى رفع وثائق محدثة."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Upload button — always visible so driver can upload renewals anytime */}
      <Link to="/account-settings/profile#license">
        <Button className="w-full bg-primary text-primary-foreground rounded-xl">
          <Upload className="w-4 h-4 ml-2" />
          {eligibility.allowed ? "رفع وثائق محدثة" : "رفع وثائق جديدة"}
        </Button>
      </Link>
    </div>
  );
}

function ExpiryRows({ license }) {
  const rows = [
    { label: "رخصة القيادة", date: license.expiry_date },
    { label: "رخصة المركبة", date: license.car_registration_expiry_date },
    { label: "تأمين المركبة", date: license.insurance_expiry_date },
  ].filter((r) => r.date);

  return (
    <div className="space-y-1 mt-2">
      {rows.map(({ label, date }) => {
        const days = daysUntil(date);
        const color = days < 0 ? "text-red-600" : days <= 30 ? "text-yellow-600" : "text-muted-foreground";
        const status = days < 0 ? "منتهية" : days === 0 ? "تنتهي اليوم" : `${days} يوم`;
        return (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className={`font-medium ${color}`}>
              {date} · {status}
            </span>
          </div>
        );
      })}
    </div>
  );
}
