import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Activity, Car, CalendarCheck, Star, Users, Filter } from "lucide-react";

const typeConfig = {
  booking: { label: "حجز", icon: CalendarCheck, color: "text-accent bg-accent/10" },
  trip: { label: "رحلة", icon: Car, color: "text-primary bg-primary/10" },
  review: { label: "تقييم", icon: Star, color: "text-yellow-600 bg-yellow-500/10" },
  user: { label: "مستخدم", icon: Users, color: "text-blue-600 bg-blue-500/10" },
};

export default function DashboardLogs() {
  const [filter, setFilter] = useState("all");

  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: () => base44.entities.Booking.list("-created_date", 50) });
  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => base44.entities.Trip.list("-created_date", 50) });
  const { data: reviews = [] } = useQuery({ queryKey: ["reviews"], queryFn: () => base44.entities.Review.list("-created_date", 50) });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => base44.entities.User.list("-created_date", 50) });

  const logs = [
    ...bookings.map((b) => ({
      type: "booking", date: b.created_date,
      text: `حجز جديد من ${b.passenger_name || "راكب"} — ₪${b.total_price || 0} — الحالة: ${b.status}`,
      id: b.id,
    })),
    ...trips.map((t) => ({
      type: "trip", date: t.created_date,
      text: `رحلة جديدة: ${t.from_city} → ${t.to_city} بواسطة ${t.driver_name || "سائق"} — الحالة: ${t.status}`,
      id: t.id,
    })),
    ...reviews.map((r) => ({
      type: "review", date: r.created_date,
      text: `تقييم جديد: ${r.rating}/5 ⭐ من ${r.reviewer_name || "مستخدم"} — "${r.comment || ""}"`,
      id: r.id,
    })),
    ...users.map((u) => ({
      type: "user", date: u.created_date,
      text: `مستخدم جديد: ${u.full_name || u.email} — الدور: ${u.role}`,
      id: u.id,
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .filter((l) => filter === "all" || l.type === filter);

  return (
    <div>
      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { id: "all", label: "الكل" },
          { id: "booking", label: "الحجوزات" },
          { id: "trip", label: "الرحلات" },
          { id: "review", label: "التقييمات" },
          { id: "user", label: "المستخدمون" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${filter === f.id ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:bg-muted"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Log List */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">سجل النشاطات</h3>
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{logs.length}</span>
        </div>
        <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
          {logs.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">لا توجد نشاطات</div>
          ) : logs.map((log, i) => {
            const cfg = typeConfig[log.type];
            const Icon = cfg.icon;
            return (
              <div key={i} className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-relaxed">{log.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(log.date).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${cfg.color}`}>{cfg.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}