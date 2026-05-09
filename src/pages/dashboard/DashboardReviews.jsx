import React, { useState } from "react";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";
import { logAdminAction } from "@/lib/adminAudit";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function DashboardReviews() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const setSearchAndReset     = (v) => { setSearch(v); setPage(1); };
  const setRatingAndReset     = (v) => { setRatingFilter(v); setPage(1); };
  const setDateRangeAndReset  = (v) => { setDateRangePreset(v); setPage(1); };
  const setCustomFromAndReset = (v) => { setCustomFrom(v); setPage(1); };
  const setCustomToAndReset   = (v) => { setCustomTo(v); setPage(1); };

  const { dateFrom, dateTo } = resolveDateRange(dateRangePreset, customFrom, customTo);

  const { data: reviewsData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["reviews", page, search, ratingFilter, dateRangePreset, customFrom, customTo],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      let q = supabase
        .from("reviews")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (ratingFilter) q = q.eq("rating", parseInt(ratingFilter, 10));
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo)   q = q.lte("created_at", dateTo);
      if (search?.trim()) {
        const s = search.trim();
        q = q.or(`reviewer_name.ilike.%${s}%,reviewer_email.ilike.%${s}%,comment.ilike.%${s}%`);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return {
        rows:       data || [],
        total:      count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
      };
    },
  });
  const reviews = reviewsData.rows;
  const totalReviews = reviewsData.total;
  const totalPages = reviewsData.totalPages;

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from("reviews").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reviews"] }); toast.success("تم حذف التقييم"); },
    onError: (err) => toast.error(err?.message || "تعذر تنفيذ الإجراء"),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">التقييمات والمراجعات</h1>
        <p className="text-sm text-muted-foreground">{totalReviews.toLocaleString("ar-EG")} تقييم</p>
      </div>

      <DashboardFilterBar
        searchValue={search}
        onSearch={setSearchAndReset}
        searchPlaceholder="ابحث في اسم المُقيِّم أو نص التعليق..."
        selects={[
          {
            key: "rating",
            value: ratingFilter,
            onChange: setRatingAndReset,
            placeholder: "كل التقييمات",
            options: [
              { value: "5", label: "⭐⭐⭐⭐⭐ (5)" },
              { value: "4", label: "⭐⭐⭐⭐ (4)" },
              { value: "3", label: "⭐⭐⭐ (3)" },
              { value: "2", label: "⭐⭐ (2)" },
              { value: "1", label: "⭐ (1)" },
            ],
          },
        ]}
        dateRange={{
          value: dateRangePreset,
          onChange: setDateRangeAndReset,
          dateFrom: customFrom,
          dateTo: customTo,
          onDateFromChange: setCustomFromAndReset,
          onDateToChange: setCustomToAndReset,
        }}
        resultCount={totalReviews}
      />

      {isLoading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">جاري التحميل...</div>
      ) : reviews.length === 0 ? (
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