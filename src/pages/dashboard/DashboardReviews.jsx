import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import { logAdminAction } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function DashboardReviews() {
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const { data: reviewsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["reviews", page],
    queryFn: () => base44.entities.Review.paginate({ page, pageSize: PAGE_SIZE, sort: "-created_date" }),
  });
  const reviews = reviewsData.rows;
  const totalPages = reviewsData.totalPages;

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Review.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reviews"] }); toast.success("تم حذف التقييم"); },
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">التقييمات والمراجعات</h1>
        <p className="text-sm text-muted-foreground">{reviews.length} تقييم</p>
      </div>

      {reviews.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Star className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">لا توجد تقييمات بعد</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div key={review.id} className="bg-card rounded-xl border border-border p-4 flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {review.reviewer_name?.[0] || "؟"}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{review.reviewer_name || "مجهول"}</p>
                    <p className="text-xs text-muted-foreground">{review.reviewer_email}</p>
                  </div>
                  <div className="flex items-center gap-0.5 mr-auto">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className={`w-4 h-4 ${s <= review.rating ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`} />
                    ))}
                    <span className="text-sm font-bold text-foreground mr-1">{review.rating}</span>
                  </div>
                </div>
                {review.comment && <p className="text-sm text-muted-foreground pr-12">{review.comment}</p>}
              </div>
              <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 w-8 h-8 shrink-0"
                onClick={() => deleteMutation.mutate(review.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}