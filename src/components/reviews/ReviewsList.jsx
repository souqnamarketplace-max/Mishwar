import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Star, MessageSquare } from "lucide-react";
import StarRating from "./StarRating";

export default function ReviewsList({ driverEmail }) {
  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ["reviews", driverEmail],
    queryFn: () =>
      base44.entities.Review.filter({ driver_email: driverEmail }, "-created_date", 20),
    enabled: !!driverEmail,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="bg-muted/30 rounded-xl p-4 animate-pulse h-20" />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">لا توجد تقييمات بعد</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <div key={review.id} className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                {review.reviewer_name?.[0] || "؟"}
              </div>
              <span className="font-medium text-sm">{review.reviewer_name || "مستخدم"}</span>
            </div>
            <StarRating value={review.rating} readonly size="sm" />
          </div>
          {review.comment && (
            <p className="text-sm text-muted-foreground pr-10">{review.comment}</p>
          )}
          <p className="text-xs text-muted-foreground/60 mt-2 pr-10">
            {new Date(review.created_date).toLocaleDateString("ar")}
          </p>
        </div>
      ))}
    </div>
  );
}