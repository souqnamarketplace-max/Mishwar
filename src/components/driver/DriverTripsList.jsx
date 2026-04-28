import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Clock, Users, ArrowLeft, Trash2, CheckCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const statusConfig = {
  confirmed: { label: "مؤكدة", className: "bg-primary/10 text-primary" },
  in_progress: { label: "جارية", className: "bg-yellow-500/10 text-yellow-600" },
  completed: { label: "مكتملة", className: "bg-green-500/10 text-green-600" },
  cancelled: { label: "ملغاة", className: "bg-destructive/10 text-destructive" },
};

export default function DriverTripsList({ trips, bookings, loading, onSelectTrip }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Trip.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trips"] }); toast.success("تم تحديث الحالة"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Trip.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trips"] }); toast.success("تم حذف الرحلة"); },
  });

  const filters = [
    { id: "all", label: "الكل" },
    { id: "confirmed", label: "مؤكدة" },
    { id: "in_progress", label: "جارية" },
    { id: "completed", label: "مكتملة" },
  ];

  const filtered = filter === "all" ? trips : trips.filter((t) => t.status === filter);

  const getTripPassengers = (tripId) =>
    bookings.filter((b) => b.trip_id === tripId && b.status !== "cancelled").length;

  if (loading) return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-card rounded-2xl border border-border p-5 animate-pulse h-28" />
      ))}
    </div>
  );

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">لا توجد رحلات</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((trip) => {
            const pax = getTripPassengers(trip.id);
            const cfg = statusConfig[trip.status] || statusConfig.confirmed;
            return (
              <div key={trip.id} className="bg-card rounded-2xl border border-border p-4 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 font-bold text-foreground">
                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                    <span>{trip.from_city}</span>
                    <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                    <span>{trip.to_city}</span>
                  </div>
                  <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{trip.date} • {trip.time}</span>
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{pax} راكب</span>
                  <span className="font-bold text-primary">₪{trip.price}</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg text-xs gap-1"
                    onClick={() => onSelectTrip(trip.id)}
                  >
                    <Users className="w-3.5 h-3.5" />
                    عرض الركاب ({pax})
                  </Button>

                  {trip.status === "confirmed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg text-xs gap-1 text-yellow-600 border-yellow-200"
                      onClick={() => updateMutation.mutate({ id: trip.id, data: { status: "in_progress" } })}
                    >
                      بدء الرحلة
                    </Button>
                  )}

                  {trip.status === "in_progress" && (
                    <Button
                      size="sm"
                      className="rounded-lg text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => updateMutation.mutate({ id: trip.id, data: { status: "completed" } })}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      إنهاء الرحلة
                    </Button>
                  )}

                  {trip.status !== "completed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-lg text-xs text-destructive hover:bg-destructive/10 mr-auto"
                      onClick={() => {
                        if (confirm("هل تريد حذف هذه الرحلة؟")) deleteMutation.mutate(trip.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}