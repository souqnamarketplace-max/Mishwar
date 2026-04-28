import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import StarRating from "./StarRating";

export default function RatingSummary({ driverEmail }) {
  const { data: reviews = [] } = useQuery({
    queryKey: ["reviews", driverEmail],
    queryFn: () =>
      base44.entities.Review.filter({ driver_email: driverEmail }, "-created_date", 100),
    enabled: !!driverEmail,
  });

  if (reviews.length === 0) return null;

  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const counts = [5, 4, 3, 2, 1].map((s) => ({
    star: s,
    count: reviews.filter((r) => r.rating === s).length,
  }));

  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
        التقييمات
      </h3>
      <div className="flex items-center gap-6 mb-4">
        <div className="text-center">
          <p className="text-4xl font-bold text-foreground">{avg.toFixed(1)}</p>
          <StarRating value={Math.round(avg)} readonly size="sm" />
          <p className="text-xs text-muted-foreground mt-1">{reviews.length} تقييم</p>
        </div>
        <div className="flex-1 space-y-1.5">
          {counts.map(({ star, count }) => (
            <div key={star} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-2">{star}</span>
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 shrink-0" />
              <div className="flex-1 bg-muted rounded-full h-1.5">
                <div
                  className="bg-yellow-500 h-1.5 rounded-full transition-all"
                  style={{ width: reviews.length ? `${(count / reviews.length) * 100}%` : "0%" }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-4">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}