import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Star, MessageCircle, TrendingUp } from "lucide-react";

/**
 * DriverRatingsDashboard — shows the driver THEIR OWN ratings/reviews
 * left by passengers. The pre-existing DriverRatePassengers component
 * is for the inverse direction (driver rating their passengers); this
 * is the "how am I doing" view that was missing.
 *
 * Key stats:
 *   - Average rating (1-5, computed from active reviews)
 *   - Total review count
 *   - Star distribution histogram (5★, 4★, 3★, 2★, 1★)
 *   - List of recent reviews with reviewer name, comment, date
 */
export default function DriverRatingsDashboard({ user }) {
  // Pull all reviews for this driver. Reviews table is publicly readable
  // (trust/rating system), so this works without admin escalation.
  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ["my-driver-reviews", user?.email],
    queryFn: () => base44.entities.Review.filter(
      { driver_email: user.email },
      "-created_at",
      500
    ),
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" dir="rtl">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Empty state — no reviews yet (driver is new or hasn't completed
  // any trips). Encouraging message rather than a sad zero state.
  if (reviews.length === 0) {
    return (
      <div className="bg-card rounded-2xl border border-border p-8 text-center" dir="rtl">
        <div className="w-16 h-16 mx-auto bg-yellow-500/10 rounded-2xl flex items-center justify-center mb-4">
          <Star className="w-8 h-8 text-yellow-500" />
        </div>
        <h3 className="font-bold text-foreground mb-2">لا توجد تقييمات بعد</h3>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          عندما يقيّمك الركاب بعد رحلاتهم معك، ستظهر تقييماتهم هنا. أكمل رحلاتك بدقة واحترافية لتبدأ في بناء سمعتك.
        </p>
      </div>
    );
  }

  // ─── Aggregate stats ─────────────────────────────────────────
  const total = reviews.length;
  const sum   = reviews.reduce((acc, r) => acc + Number(r.rating || 0), 0);
  const avg   = total > 0 ? sum / total : 0;

  // Star distribution: counts of how many reviews are 1★, 2★, ..., 5★.
  // Used for the histogram bars below.
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => Math.round(Number(r.rating)) === star).length,
  }));
  const maxCount = Math.max(...dist.map((d) => d.count), 1);

  // Recency: count reviews from last 30 days vs total. Tells the driver
  // if they're trending up/active vs dormant.
  const thirty   = 30 * 24 * 60 * 60 * 1000;
  const recentN  = reviews.filter(
    (r) => Date.now() - new Date(r.created_at).getTime() < thirty
  ).length;

  return (
    <div className="space-y-5" dir="rtl">
      {/* ─── Hero stat card ─── */}
      <div className="bg-gradient-to-br from-yellow-500 to-amber-500 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="text-5xl font-black">{avg.toFixed(1)}</div>
          <div className="flex-1">
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-5 h-5 ${s <= Math.round(avg) ? "fill-white text-white" : "text-white/40"}`}
                />
              ))}
            </div>
            <p className="text-sm opacity-90">
              من {total.toLocaleString("ar-EG")} {total === 1 ? "تقييم" : "تقييماً"}
              {recentN > 0 && (
                <> — <span className="font-bold">{recentN.toLocaleString("ar-EG")}</span> هذا الشهر</>
              )}
            </p>
          </div>
          <TrendingUp className="w-10 h-10 opacity-50" />
        </div>
      </div>

      {/* ─── Star distribution histogram ─── */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h3 className="font-bold text-foreground mb-4">توزيع التقييمات</h3>
        <div className="space-y-2">
          {dist.map(({ star, count }) => {
            const pct = total > 0 ? (count / total) * 100 : 0;
            const barWidth = (count / maxCount) * 100;
            return (
              <div key={star} className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1 w-10 shrink-0">
                  <span className="font-semibold">{star}</span>
                  <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500" />
                </div>
                <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-400 to-amber-500 rounded-full transition-all"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <div className="w-20 text-left text-xs text-muted-foreground tabular-nums">
                  {count.toLocaleString("ar-EG")} ({pct.toFixed(0)}%)
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Recent reviews list ─── */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
          <MessageCircle className="w-4 h-4" />
          آخر التقييمات
        </h3>
        <div className="space-y-3">
          {reviews.slice(0, 20).map((r) => (
            <ReviewRow key={r.id} review={r} />
          ))}
        </div>
        {reviews.length > 20 && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            تعرض أحدث 20 تقييماً من أصل {reviews.length.toLocaleString("ar-EG")}
          </p>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ review }) {
  const stars = Math.round(Number(review.rating || 0));
  const date = review.created_at
    ? new Date(review.created_at).toLocaleDateString("ar-EG", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
  return (
    <div className="border-b border-border/60 last:border-0 pb-3 last:pb-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-semibold text-sm text-foreground truncate">
            {review.reviewer_name || "راكب"}
          </p>
          <div className="flex items-center gap-0.5 shrink-0">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className={`w-3.5 h-3.5 ${s <= stars ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`}
              />
            ))}
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{date}</span>
      </div>
      {review.comment && (
        <p className="text-sm text-muted-foreground leading-relaxed mt-1 whitespace-pre-wrap">
          {review.comment}
        </p>
      )}
    </div>
  );
}
