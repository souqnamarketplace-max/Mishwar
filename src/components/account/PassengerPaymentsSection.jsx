import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { CreditCard, MapPin, Calendar } from "lucide-react";

/**
 * PassengerPaymentsSection — booking payment history for passengers.
 */
export default function PassengerPaymentsSection({ user }) {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["passenger-payments", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Booking.filter({ passenger_email: user.email }, "-created_date", 100)
      : [],
    enabled: !!user?.email,
  });

  const { data: allTrips = [] } = useQuery({
    queryKey: ["all-trips-payments-lookup"],
    queryFn: () => base44.entities.Trip.list("-created_date", 200),
  });

  const yearBookings = bookings.filter(b => {
    const d = new Date(b.created_date || b.created_at);
    return d.getFullYear() === year;
  });

  const totalSpent = yearBookings
    .filter(b => b.status !== "cancelled")
    .reduce((sum, b) => sum + (Number(b.total_price) || 0), 0);

  const tripById = (id) => allTrips.find(t => t.id === id);

  const statusConfig = {
    paid:      { label: "مدفوع",   className: "bg-green-100 text-green-700" },
    pending:   { label: "بانتظار", className: "bg-yellow-100 text-yellow-700" },
    confirmed: { label: "محجوز",   className: "bg-blue-100 text-blue-700" },
    completed: { label: "مكتمل",   className: "bg-gray-100 text-gray-700" },
    cancelled: { label: "ملغي",    className: "bg-red-100 text-red-700" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="px-3 py-1.5 rounded-xl border border-input bg-card text-sm"
        >
          {[0, 1, 2].map(off => {
            const y = new Date().getFullYear() - off;
            return <option key={y} value={y}>{y}</option>;
          })}
        </select>
        <p className="text-sm text-muted-foreground">
          المجموع: <span className="font-bold text-primary">₪{totalSpent.toFixed(2)}</span>
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : yearBookings.length === 0 ? (
        <div className="text-center py-12">
          <CreditCard className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">لا توجد مدفوعات في {year}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {yearBookings.map(b => {
            const trip = tripById(b.trip_id);
            const cfg = statusConfig[b.payment_status] || statusConfig[b.status] || statusConfig.confirmed;
            return (
              <div key={b.id} className="bg-card border border-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                    <MapPin className="w-3.5 h-3.5 text-primary" />
                    {trip ? `${trip.from_city} ← ${trip.to_city}` : "رحلة"}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.className}`}>
                    {cfg.label}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {trip?.date || new Date(b.created_date || b.created_at).toLocaleDateString("ar")}
                    {b.payment_method && ` · ${b.payment_method === "cash" ? "نقداً" : b.payment_method}`}
                  </span>
                  <span className="font-bold text-primary text-sm">
                    ₪{Number(b.total_price || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
