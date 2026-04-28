import React from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, MapPin, ArrowLeft, Phone, Star, CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const statusConfig = {
  pending: { label: "معلق", className: "bg-yellow-500/10 text-yellow-600" },
  confirmed: { label: "مؤكد", className: "bg-primary/10 text-primary" },
  cancelled: { label: "ملغى", className: "bg-destructive/10 text-destructive" },
  completed: { label: "مكتمل", className: "bg-green-500/10 text-green-600" },
};

export default function DriverPassengers({ trips, bookings, selectedTripId, onSelectTrip }) {
  const qc = useQueryClient();

  const updateBooking = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Booking.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bookings"] }); toast.success("تم تحديث الحجز"); },
  });

  const selectedTrip = trips.find((t) => t.id === selectedTripId) || trips[0];
  const tripBookings = bookings.filter((b) => b.trip_id === selectedTrip?.id);
  const activeBookings = tripBookings.filter((b) => b.status !== "cancelled");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Trip Selector */}
      <div className="lg:col-span-1">
        <h3 className="font-bold text-sm text-muted-foreground mb-3">اختر رحلة</h3>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {trips.map((trip) => {
            const pax = bookings.filter((b) => b.trip_id === trip.id && b.status !== "cancelled").length;
            const isSelected = trip.id === selectedTrip?.id;
            return (
              <button
                key={trip.id}
                onClick={() => onSelectTrip(trip.id)}
                className={`w-full text-right p-3 rounded-xl border transition-all ${
                  isSelected ? "bg-primary/5 border-primary/30" : "bg-card border-border hover:border-primary/20"
                }`}
              >
                <div className="flex items-center gap-1 font-medium text-sm text-foreground">
                  <span>{trip.from_city}</span>
                  <ArrowLeft className="w-3 h-3 text-muted-foreground" />
                  <span>{trip.to_city}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted-foreground">{trip.date} • {trip.time}</p>
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{pax} راكب</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Passengers List */}
      <div className="lg:col-span-2">
        {selectedTrip ? (
          <>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-foreground">
                {selectedTrip.from_city} ← {selectedTrip.to_city}
              </h3>
              <Badge className="bg-primary/10 text-primary text-xs">{activeBookings.length} راكب</Badge>
            </div>

            {tripBookings.length === 0 ? (
              <div className="bg-card rounded-2xl border border-border p-10 text-center">
                <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">لا يوجد ركاب محجوزون لهذه الرحلة</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tripBookings.map((booking) => {
                  const cfg = statusConfig[booking.status] || statusConfig.pending;
                  return (
                    <div key={booking.id} className="bg-card rounded-2xl border border-border p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-lg">
                            {(booking.passenger_name || "ر")[0]}
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">{booking.passenger_name || "راكب"}</h4>
                            <p className="text-xs text-muted-foreground">{booking.passenger_email || ""}</p>
                          </div>
                        </div>
                        <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                        <span>{booking.seats_booked || 1} مقعد</span>
                        <span className="font-bold text-primary">₪{booking.total_price || 0}</span>
                        <span>{booking.payment_method || "نقداً"}</span>
                      </div>

                      {booking.status === "pending" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="rounded-lg text-xs gap-1 bg-primary text-primary-foreground"
                            onClick={() => updateBooking.mutate({ id: booking.id, status: "confirmed" })}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            قبول
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg text-xs gap-1 text-destructive border-destructive/20"
                            onClick={() => updateBooking.mutate({ id: booking.id, status: "cancelled" })}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            رفض
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="bg-card rounded-2xl border border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">اختر رحلة لعرض الركاب</p>
          </div>
        )}
      </div>
    </div>
  );
}