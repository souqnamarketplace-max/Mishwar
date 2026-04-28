import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, CheckCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function StarPicker({ value, onChange }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onMouseEnter={() => setHovered(s)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(s)}
        >
          <Star
            className={`w-6 h-6 transition-colors ${
              s <= (hovered || value) ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export default function DriverRatePassengers({ trips, bookings }) {
  const qc = useQueryClient();
  const [ratings, setRatings] = useState({});
  const [comments, setComments] = useState({});

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  const { data: myReviews = [] } = useQuery({
    queryKey: ["driver-given-reviews", user?.email],
    queryFn: () => base44.entities.Review.filter({ reviewer_email: user?.email }),
    enabled: !!user?.email,
  });

  const reviewedIds = new Set(myReviews.map((r) => r.trip_id + "_" + r.driver_email));

  const submitReview = useMutation({
    mutationFn: (data) => base44.entities.Review.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver-given-reviews", user?.email] });
      toast.success("تم إرسال التقييم بنجاح ✅");
    },
  });

  // Completed trips by this driver
  const completedTrips = trips.filter((t) => t.status === "completed");

  // Get passengers for completed trips
  const passengerBookings = bookings.filter(
    (b) => completedTrips.some((t) => t.id === b.trip_id) && b.status !== "cancelled"
  );

  if (passengerBookings.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border p-12 text-center">
        <Users className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
        <p className="font-medium text-foreground mb-1">لا يوجد ركاب لتقييمهم</p>
        <p className="text-sm text-muted-foreground">بعد اكتمال الرحلات ستتمكن من تقييم ركابك</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-2">قيّم ركابك بعد اكتمال الرحلة لتعزيز الثقة في المجتمع</p>
      {passengerBookings.map((booking) => {
        const trip = completedTrips.find((t) => t.id === booking.trip_id);
        const key = booking.trip_id + "_" + booking.passenger_email;
        const alreadyRated = reviewedIds.has(key);

        return (
          <div key={booking.id} className="bg-card rounded-2xl border border-border p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                  {(booking.passenger_name || "ر")[0]}
                </div>
                <div>
                  <p className="font-bold text-sm">{booking.passenger_name || "راكب"}</p>
                  <p className="text-xs text-muted-foreground">
                    {trip?.from_city} → {trip?.to_city} • {trip?.date}
                  </p>
                </div>
              </div>
              {alreadyRated && (
                <span className="flex items-center gap-1 text-xs text-accent">
                  <CheckCircle className="w-4 h-4" /> تم التقييم
                </span>
              )}
            </div>

            {!alreadyRated ? (
              <div className="space-y-3">
                <StarPicker
                  value={ratings[booking.id] || 0}
                  onChange={(v) => setRatings((p) => ({ ...p, [booking.id]: v }))}
                />
                <textarea
                  value={comments[booking.id] || ""}
                  onChange={(e) => setComments((p) => ({ ...p, [booking.id]: e.target.value }))}
                  placeholder="أضف تعليقاً (اختياري)..."
                  className="w-full h-20 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm resize-none"
                />
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground rounded-xl"
                  disabled={!ratings[booking.id] || submitReview.isPending}
                  onClick={() =>
                    submitReview.mutate({
                      trip_id: booking.trip_id,
                      reviewer_name: user?.full_name,
                      reviewer_email: user?.email,
                      driver_email: booking.passenger_email, // storing passenger email in driver_email field for reverse lookup
                      rating: ratings[booking.id],
                      comment: comments[booking.id] || "",
                    })
                  }
                >
                  إرسال التقييم
                </Button>
              </div>
            ) : (
              <div className="flex gap-1 mt-1">
                {[1, 2, 3, 4, 5].map((s) => {
                  const rev = myReviews.find((r) => r.trip_id === booking.trip_id && r.driver_email === booking.passenger_email);
                  return (
                    <Star
                      key={s}
                      className={`w-4 h-4 ${s <= (rev?.rating || 0) ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}