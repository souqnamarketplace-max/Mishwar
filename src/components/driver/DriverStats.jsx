import React from "react";
import { DollarSign, Users, Car, CheckCircle } from "lucide-react";

const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || isNaN(n)) return 0;
  return Math.max(0, n);
};

export default function DriverStats({ totalEarnings, totalPassengers, activeTrips, completedTrips }) {
  return (
    <div className="mb-5" dir="rtl">
      {/* ── Row 1: earnings (full width hero card) ── */}
      <div className="bg-primary rounded-2xl p-4 mb-3 flex items-center justify-between">
        <div>
          <p className="text-primary-foreground/70 text-xs mb-0.5">إجمالي الأرباح المحصّلة</p>
          <p className="text-primary-foreground text-3xl font-black tracking-tight">
            ₪{fmt(totalEarnings).toLocaleString("ar-EG")}
          </p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center">
          <DollarSign className="w-6 h-6 text-primary-foreground" />
        </div>
      </div>

      {/* ── Row 2: 3 small stat chips ── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card rounded-xl border border-border p-3 flex flex-col items-center">
          <div className="w-8 h-8 rounded-xl bg-yellow-500/10 flex items-center justify-center mb-1.5">
            <Car className="w-4 h-4 text-yellow-600" />
          </div>
          <p className="text-xl font-bold text-foreground">{fmt(activeTrips)}</p>
          <p className="text-[10px] text-muted-foreground text-center leading-tight mt-0.5">رحلات نشطة</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3 flex flex-col items-center">
          <div className="w-8 h-8 rounded-xl bg-green-500/10 flex items-center justify-center mb-1.5">
            <CheckCircle className="w-4 h-4 text-green-600" />
          </div>
          <p className="text-xl font-bold text-foreground">{fmt(completedTrips)}</p>
          <p className="text-[10px] text-muted-foreground text-center leading-tight mt-0.5">رحلات مكتملة</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3 flex flex-col items-center">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center mb-1.5">
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-xl font-bold text-foreground">{fmt(totalPassengers)}</p>
          <p className="text-[10px] text-muted-foreground text-center leading-tight mt-0.5">إجمالي الركاب</p>
        </div>
      </div>
    </div>
  );
}
