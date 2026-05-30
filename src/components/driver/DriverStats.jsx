import React from "react";
import { DollarSign, Users, Car, CheckCircle } from "lucide-react";

// Defensive numeric formatter — handles undefined, null, NaN, Infinity, strings
const fmt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || isNaN(n)) return 0;
  return Math.max(0, n);
};

export default function DriverStats({ totalEarnings, totalPassengers, activeTrips, completedTrips }) {
  const stats = [
    { label: "الأرباح المحصّلة", value: `₪${fmt(totalEarnings).toLocaleString()}`, icon: DollarSign, bg: "bg-primary/10", color: "text-primary" },
    { label: "الركاب الكلي",     value: fmt(totalPassengers),                       icon: Users,      bg: "bg-accent/10",   color: "text-accent" },
    { label: "رحلات نشطة",       value: fmt(activeTrips),                           icon: Car,        bg: "bg-yellow-500/10", color: "text-yellow-600" },
    { label: "رحلات مكتملة",     value: fmt(completedTrips),                        icon: CheckCircle, bg: "bg-green-500/10", color: "text-green-600" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map((s) => (
        <div key={s.label} className="bg-card rounded-2xl border border-border p-4">
          <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
            <s.icon className={`w-5 h-5 ${s.color}`} />
          </div>
          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
        </div>
      ))}
    </div>
  );
}