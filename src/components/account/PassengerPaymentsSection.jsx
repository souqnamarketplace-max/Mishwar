import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { CreditCard, MapPin, Calendar } from "lucide-react";

/**
 * PassengerPaymentsSection — booking payment history for passengers.
 */
export default function PassengerPaymentsSection({ user }) {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["passenger-payments", user?.email],
    queryFn: () => user?.email
      ? api.entities.Booking.filter({ passenger_email: user.email }, "-created_date", 100)
      : [],
    enabled: !!user?.email,
  });

  // Collect distinct trip_ids referenced by the user's bookings, then
  // fetch ONLY those trips (not the latest 200 platform-wide trips).
  // The previous Trip.list("-created_date", 200) approach had two real
  // problems:
  //   1. If the user's booking was on a trip older than the latest
  //      200 platform trips (likely on a busy week), the .find()
  //      lookup returned undefined and the row degraded to "رحلة"
  //      with no route — confusing for someone reviewing their own
  //      payment history.
  //   2. Wasteful — fetching 200 trips to look up at most 100 of the
  //      user's bookings, often duplicating ids when the user takes
  //      the same route weekly.
  // Using supabase.from('trips').select(...).in('id', ids) hits the
  // exact rows needed, scoped by the user's actual bookings. RLS
  // (trips_select_public) returns these for any authenticated user
  // since trips are public for browse.
  const tripIds = [...new Set(bookings.map(b => b.trip_id).filter(Boolean))];
  const { data: trips = [] } = useQuery({
    queryKey: ["passenger-payments-trips", tripIds.join(",")],
    queryFn: async () => {
      if (tripIds.length === 0) return [];
      const { data, error } = await supabase
        .from("trips")
        .select("id, from_city, to_city, date")
        .in("id", tripIds);
      if (error) throw error;
      return data || [];
    },
    enabled: tripIds.length > 0,
  });

  const yearBookings = bookings.filter(b => {
    const d = new Date(b.created_date || b.created_at);
    return d.getFullYear() === year;
  });

  // Cancelled bookings don't represent payments — they represent
  // nullified intents to pay. The previous code included them in the
  // rendered list, which surfaced as the user complaint that cancelled
  // trips were showing up in their payment history. The total at the
  // top of the page was already filtering them out (line below), so
  // hiding them from the rows below makes the list consistent with
  // the total. The list still shows pending bookings (cash not yet
  // exchanged) and completed bookings so the user has a real ledger.
  const paymentRows = yearBookings.filter(b => b.status !== "cancelled");

  const totalSpent = yearBookings
    .filter(b => b.status !== "cancelled")
    .reduce((sum, b) => sum + (Number(b.total_price) || 0), 0);

  const tripById = (id) => trips.find(t => t.id === id);

  const statusConfig = {
    paid:      { label: "مدفوع",   className: "bg-green-100 text-green-700" },
    pending:   { label: "بانتظار", className: "bg-yellow-100 text-yellow-700" },
    confirmed: { label: "محجوز",   className: "bg-blue-100 text-blue-700" },
    completed: { label: "مكتمل",   className: "bg-gray-100 text-gray-700" },
    cancelled: { label: "ملغي",    className: "bg-red-100 text-red-700" },
  };

  // Pick the right pill for a booking row.
  // The previous order was: payment_status || status — which broke
  // for cancelled bookings because cancel_booking() (migration 032)
  // intentionally does NOT touch payment_status; it only flips
  // bookings.status to 'cancelled' and refunds the seat. For a cash
  // booking that's the right server behaviour (the row was never
  // paid, and 'paid' would be a lie), but it leaves payment_status
  // stuck at 'pending' on a cancelled row. The lookup then resolved
  // to the yellow 'بانتظار' pill on cancelled trips — exactly the
  // mislabel in the user's screenshot.
  //
  // Booking-level lifecycle (status) wins over payment-level
  // lifecycle (payment_status) for the terminal states 'cancelled'
  // and 'completed', because those are facts about the booking that
  // a stale payment_status can't override. For everything else the
  // payment_status carries more useful info (paid vs pending cash)
  // so we still prefer it. paymentRows already filters cancelled
  // out of the list, so this is also defence-in-depth — if anyone
  // later removes that filter, the badge will at least be honest.
  const badgeFor = (b) => {
    if (b.status === "cancelled" || b.status === "completed") {
      return statusConfig[b.status];
    }
    return statusConfig[b.payment_status] || statusConfig[b.status] || statusConfig.confirmed;
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
      ) : paymentRows.length === 0 ? (
        <div className="text-center py-12">
          <CreditCard className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">لا توجد مدفوعات في {year}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {paymentRows.map(b => {
            const trip = tripById(b.trip_id);
            const cfg = badgeFor(b);
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
                    {trip?.date || new Date(b.created_date || b.created_at).toLocaleDateString("ar-EG")}
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
