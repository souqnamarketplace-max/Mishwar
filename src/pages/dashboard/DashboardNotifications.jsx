import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Bell, Car, CalendarCheck, Star, XCircle, CheckCircle } from "lucide-react";

function getEventType(item, type) {
  if (type === "booking") {
    if (item.status === "cancelled") return { icon: XCircle, color: "text-destructive bg-destructive/10", text: `حجز جديد ملغي من ${item.passenger_name || "راكب"}` };
    return { icon: CalendarCheck, color: "text-accent bg-accent/10", text: `حجز جديد من ${item.passenger_name || "راكب"} — ₪${item.total_price || 0}` };
  }
  if (type === "trip") {
    if (item.status === "cancelled") return { icon: XCircle, color: "text-destructive bg-destructive/10", text: `رحلة ملغاة: ${item.from_city} → ${item.to_city}` };
    if (item.status === "completed") return { icon: CheckCircle, color: "text-green-600 bg-green-500/10", text: `رحلة مكتملة: ${item.from_city} → ${item.to_city}` };
    return { icon: Car, color: "text-primary bg-primary/10", text: `رحلة جديدة: ${item.from_city} → ${item.to_city} بواسطة ${item.driver_name || "سائق"}` };
  }
  if (type === "review") {
    return { icon: Star, color: "text-yellow-600 bg-yellow-500/10", text: `تقييم جديد: ${item.rating}/5 من ${item.reviewer_name || "مستخدم"}` };
  }
  return { icon: Bell, color: "text-primary bg-primary/10", text: "حدث جديد" };
}

export default function DashboardNotifications() {
  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: () => base44.entities.Booking.list("-created_date", 20) });
  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => base44.entities.Trip.list("-created_date", 20) });
  const { data: reviews = [] } = useQuery({ queryKey: ["reviews"], queryFn: () => base44.entities.Review.list("-created_date", 20) });

  const events = [
    ...bookings.map((b) => ({ ...b, _type: "booking", _date: b.created_date })),
    ...trips.map((t) => ({ ...t, _type: "trip", _date: t.created_date })),
    ...reviews.map((r) => ({ ...r, _type: "review", _date: r.created_date })),
  ].sort((a, b) => new Date(b._date) - new Date(a._date)).slice(0, 40);

  return (
    <div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">سجل الإشعارات</h3>
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{events.length}</span>
        </div>
        <div className="divide-y divide-border">
          {events.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">لا توجد إشعارات</div>
          ) : events.map((event, i) => {
            const { icon: Icon, color, text } = getEventType(event, event._type);
            return (
              <div key={i} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm">{text}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(event._date).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}