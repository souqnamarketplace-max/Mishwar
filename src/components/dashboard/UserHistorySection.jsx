import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Car, Users as UsersIcon, AlertTriangle, Star, MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * UserHistorySection — admin-facing history panel inside the user
 * detail modal in DashboardUsers. Shows counts + recency for the four
 * surfaces an admin needs at-a-glance when investigating a user:
 *
 *   1. Trips posted (only if account_type ∈ {driver, both})
 *   2. Bookings made
 *   3. Reports FILED AGAINST this user (the moderation signal)
 *   4. Average rating + review count (if a driver)
 *
 * Counts are computed client-side from filtered queries because that's
 * what the existing entities client gives us. For tens-of-thousands-of-
 * users scale this is fine; if it becomes slow, migration 014 already
 * has user_activity_counts triggers that we could read instead.
 *
 * Each card is clickable when it makes sense: report card links to a
 * filtered DashboardReports view so the admin can drill in immediately.
 */
export default function UserHistorySection({ user }) {
  const email = user?.email;

  // Trips posted by this user (only relevant for drivers)
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";
  const { data: trips = [] } = useQuery({
    queryKey: ["admin-user-trips", email],
    queryFn: () => base44.entities.Trip.filter({ driver_email: email }, "-created_at", 500),
    enabled: !!email && isDriver,
    staleTime: 30_000,
  });

  // Bookings made by this user
  const { data: bookings = [] } = useQuery({
    queryKey: ["admin-user-bookings", email],
    queryFn: () => base44.entities.Booking.filter({ passenger_email: email }, "-created_at", 500),
    enabled: !!email,
    staleTime: 30_000,
  });

  // Reports filed AGAINST this user
  const { data: reports = [] } = useQuery({
    queryKey: ["admin-user-reports", email],
    queryFn: () => base44.entities.Report.filter({ reported_email: email }, "-created_at", 500),
    enabled: !!email,
    staleTime: 30_000,
  });

  // Reviews of this user (only meaningful if driver)
  const { data: reviews = [] } = useQuery({
    queryKey: ["admin-user-reviews", email],
    queryFn: () => base44.entities.Review.filter({ driver_email: email }, "-created_at", 500),
    enabled: !!email && isDriver,
    staleTime: 30_000,
  });

  // ─── Aggregates ─────────────────────────────────────────────
  const tripsCount    = trips.length;
  const tripsActive   = trips.filter(t => t.status === "confirmed" || t.status === "in_progress").length;

  const bookingsCount = bookings.length;
  const bookingsCancelled = bookings.filter(b => b.status === "cancelled").length;
  // Cancellation rate as a percentage. Useful "behavior signal" — chronic
  // cancellers stand out without admin needing to scroll the list.
  const cancelRate    = bookingsCount > 0 ? (bookingsCancelled / bookingsCount) * 100 : 0;

  const reportsCount    = reports.length;
  const reportsPending  = reports.filter(r => r.status === "pending").length;
  const reportsActioned = reports.filter(r => r.status === "action_taken").length;

  const reviewsCount  = reviews.length;
  const ratingAvg     = reviewsCount > 0
    ? reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviewsCount
    : 0;

  // Severity tint on the reports card — green if 0, amber if some pending,
  // red if any action_taken. Helps admins triage the list at a glance.
  let reportsTone = "neutral";
  if (reportsActioned > 0) reportsTone = "danger";
  else if (reportsPending > 0) reportsTone = "warn";

  return (
    <div className="col-span-2 space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">سجل المستخدم</h3>
        <p className="text-[10px] text-muted-foreground">
          تحديث تلقائي كل 30 ثانية
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isDriver && (
          <Stat
            icon={Car}
            color="text-primary"
            bg="bg-primary/10"
            label="رحلات نشرها"
            value={tripsCount}
            sub={tripsActive > 0 ? `${tripsActive} نشطة الآن` : "لا توجد نشطة"}
          />
        )}
        <Stat
          icon={UsersIcon}
          color="text-blue-600"
          bg="bg-blue-500/10"
          label="حجوزات قام بها"
          value={bookingsCount}
          sub={bookingsCount > 0
            ? `معدل الإلغاء: ${cancelRate.toFixed(0)}%`
            : "لم يحجز بعد"}
          subTone={cancelRate >= 30 ? "warn" : cancelRate >= 50 ? "danger" : "neutral"}
        />
        <Stat
          icon={AlertTriangle}
          color={reportsTone === "danger" ? "text-destructive"
               : reportsTone === "warn"   ? "text-amber-600"
               : "text-green-600"}
          bg={reportsTone === "danger" ? "bg-destructive/10"
            : reportsTone === "warn"   ? "bg-amber-500/10"
            : "bg-green-500/10"}
          label="بلاغات ضده"
          value={reportsCount}
          sub={reportsCount === 0 ? "لا توجد بلاغات"
             : reportsActioned > 0 ? `${reportsActioned} تم اتخاذ إجراء فيها`
             : reportsPending  > 0 ? `${reportsPending} قيد المراجعة`
             : "تمت مراجعتها"}
          link={reportsCount > 0
            ? `/dashboard/reports?reported=${encodeURIComponent(email)}`
            : null}
        />
        {isDriver && (
          <Stat
            icon={Star}
            color="text-yellow-600"
            bg="bg-yellow-500/10"
            label="متوسط التقييم"
            value={reviewsCount > 0 ? ratingAvg.toFixed(1) : "—"}
            sub={reviewsCount === 0
              ? "لا توجد تقييمات"
              : `من ${reviewsCount} ${reviewsCount === 1 ? "تقييم" : "تقييماً"}`}
          />
        )}
      </div>

      {/* Recent activity strip — abbreviated history (5 most recent reports
          if any, else 3 most recent bookings). Gives admin context without
          forcing a navigation. */}
      {reports.length > 0 && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-3 mt-3">
          <p className="text-xs font-bold text-destructive mb-2 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            آخر البلاغات
          </p>
          <div className="space-y-1.5">
            {reports.slice(0, 5).map((r) => (
              <div key={r.id} className="text-xs flex items-start gap-2">
                <span className="text-muted-foreground shrink-0 w-20">
                  {r.created_at && new Date(r.created_at).toLocaleDateString("ar-EG", { day: "numeric", month: "short" })}
                </span>
                <span className="text-foreground flex-1">
                  {r.category} — <span className="text-muted-foreground">من {r.reporter_email}</span>
                </span>
                <span className={`shrink-0 text-[10px] font-bold ${
                  r.status === "action_taken" ? "text-destructive" :
                  r.status === "dismissed"    ? "text-muted-foreground" :
                  "text-amber-600"
                }`}>
                  {r.status === "action_taken" ? "إجراء" :
                   r.status === "reviewed"     ? "روجعت" :
                   r.status === "dismissed"    ? "رفضت" :
                                                  "قيد المراجعة"}
                </span>
              </div>
            ))}
          </div>
          {reports.length > 5 && (
            <Link
              to={`/dashboard/reports?reported=${encodeURIComponent(email)}`}
              className="block text-xs text-primary underline mt-2"
            >
              عرض جميع البلاغات ({reports.length})
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Small stat tile used in the grid. */
function Stat({ icon: Icon, color, bg, label, value, sub, subTone, link }) {
  const subColor = subTone === "danger" ? "text-destructive font-bold"
                 : subTone === "warn"   ? "text-amber-600 font-semibold"
                 :                        "text-muted-foreground";
  const Wrapper = link ? Link : "div";
  const wrapperProps = link ? { to: link } : {};
  return (
    <Wrapper
      {...wrapperProps}
      className={`bg-card rounded-xl border border-border p-3 ${link ? "hover:border-primary/40 transition-colors" : ""}`}
    >
      <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center mb-2`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      <p className={`text-[10px] mt-1 ${subColor}`}>{sub}</p>
    </Wrapper>
  );
}
