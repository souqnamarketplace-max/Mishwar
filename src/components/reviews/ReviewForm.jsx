import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Star, Send, X } from "lucide-react";
import StarRating from "./StarRating";
import { toast } from "sonner";

export default function ReviewForm({ trip, reviewerUser, targetEmail, targetName, onClose }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const qc = useQueryClient();

  const submit = useMutation({
    mutationFn: async () => {
      await base44.entities.Review.create({
        trip_id: trip.id,
        reviewer_name: reviewerUser?.full_name || "مجهول",
        reviewer_email: reviewerUser?.email,
        driver_email: targetEmail,
        rated_user_email: targetEmail,
        review_type: "passenger_rates_driver",
        rating,
        comment,
      });
      // Notify driver of review
      await base44.entities.Notification.create({
        user_email: targetEmail,
        title: `تقييم جديد من ${reviewerUser?.full_name || "راكب"}`,
        message: `حصلت على تقييم ${rating} نجوم للرحلة من ${trip.from_city} إلى ${trip.to_city}${comment ? `: "${comment}"` : ""}`,
        type: "system",
        trip_id: trip.id,
        is_read: false,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["all-notifications"] });
      toast.success("شكراً! تم إرسال تقييمك ✅");
      onClose?.();
    },
  });

  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-500" />
          قيّم رحلتك مع {targetName}
        </h3>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Route Info */}
      <div className="bg-muted/40 rounded-xl px-4 py-2 text-sm text-muted-foreground mb-4">
        {trip.from_city} ← {trip.to_city} · {trip.date}
      </div>

      {/* Stars */}
      <div className="flex flex-col items-center gap-2 my-5">
        <StarRating value={rating} onChange={setRating} size="lg" />
        <p className="text-sm text-muted-foreground">
          {rating === 0 && "اختر تقييمك"}
          {rating === 1 && "سيء جداً 😞"}
          {rating === 2 && "سيء 😕"}
          {rating === 3 && "مقبول 😐"}
          {rating === 4 && "جيد 😊"}
          {rating === 5 && "ممتاز! 🌟"}
        </p>
      </div>

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="أضف تعليقاً... (اختياري)"
        rows={3}
        className="w-full rounded-xl border border-input bg-muted/30 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring mb-4"
      />

      <Button
        onClick={() => {
          if (rating === 0) { toast.error("يرجى اختيار تقييم بالنجوم ⚠️"); return; }
          submit.mutate();
        }}
        disabled={submit.isPending}
        className="w-full bg-primary text-primary-foreground rounded-xl gap-2"
      >
        <Send className="w-4 h-4" />
        {submit.isPending ? "جاري الإرسال..." : "إرسال التقييم"}
      </Button>
    </div>
  );
}