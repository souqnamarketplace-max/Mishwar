import React, { useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Navigate, useSearchParams, Link } from "react-router-dom";
import DashboardSidebar, { DashboardMobileTabSelector } from "../components/dashboard/DashboardSidebar";
import DashboardUsers from "./dashboard/DashboardUsers";
import DashboardTrips from "./dashboard/DashboardTrips";
import DashboardBookings from "./dashboard/DashboardBookings";
import DashboardRequests from "./dashboard/DashboardRequests";
import DashboardPassengerVerifications from "./dashboard/DashboardPassengerVerifications";
import DashboardReviews from "./dashboard/DashboardReviews";
import DashboardPayments from "./dashboard/DashboardPayments";
import DashboardSubscriptions from "./dashboard/DashboardSubscriptions";
import DashboardReports from "./dashboard/DashboardReports";
import DashboardNotifications from "./dashboard/DashboardNotifications";
import DashboardBroadcasts from "./dashboard/DashboardBroadcasts";
import DashboardSupport from "./dashboard/DashboardSupport";
import DashboardFeedback from "./dashboard/DashboardFeedback";
import DashboardContent from "./dashboard/DashboardContent";
import DashboardDeletions from "./dashboard/DashboardDeletions";
// DashboardOffers import removed — coupons hidden for v1.0 launch (M-06).
// File kept on disk; re-import when redemption pipeline ships.
import DashboardSettings from "./dashboard/DashboardSettings";
import DashboardHeroSlides from "./dashboard/DashboardHeroSlides";
import DashboardLogs from "./dashboard/DashboardLogs";
import DashboardCities from "./dashboard/DashboardCities";
import DashboardLicenses from "./dashboard/DashboardLicenses";
import AdminNotificationBell from "@/components/notifications/AdminNotificationBell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useState as useBroadcastState } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  DollarSign, Users, Car, CalendarCheck, TrendingUp, TrendingDown,
  Star, AlertCircle, Bell, Clock, CreditCard
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
// Recharts is heavy (~420KB / 113KB gzipped). Pull it into a lazy chunk
// so even admins don't pay for it on initial dashboard nav — the charts
// stream in after the rest of the dashboard renders.
const DashboardCharts = lazy(() => import("@/components/dashboard/DashboardCharts"));

import { useSEO } from "@/hooks/useSEO";
const statusColors = {
  "completed": "bg-accent/10 text-accent",
  "confirmed": "bg-primary/10 text-primary",
  "in_progress": "bg-yellow-500/10 text-yellow-600",
  "cancelled": "bg-destructive/10 text-destructive",
};

function Overview() {
  // Row-level data — used for charts, recent activity, status histograms,
  // rate calculations. Bounded at 100 for performance; the per-row
  // derivations (last-7-days bucket, revenue from confirmed/completed)
  // are still accurate at the 100-row scale.
  const { data: trips = [] } = useQuery({
    queryKey: ["all-trips-stats"],
    queryFn: () => api.entities.Trip.list("-created_date", 100),
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["all-bookings-stats"],
    queryFn: () => api.entities.Booking.list("-created_date", 100),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["all-users-stats"],
    queryFn: () => api.entities.User.list("-created_date", 100),
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["all-notifications"],
    queryFn: () => api.entities.Notification.list("-created_date", 10),
  });

  // Server-side TOTALS. Previously totalTrips/totalBookings/totalUsers
  // were computed as `trips.length` etc — but `trips` was the 100-row
  // list above, so the dashboard's "إجمالي الرحلات / الحجوزات /
  // المستخدمين" stat cards SILENTLY CAPPED AT 100 once those tables
  // grew. Admin saw "إجمالي الرحلات: 100" for weeks while the real
  // total climbed past 500. Now uses Entity.count() — single HEAD
  // request, no row data, accurate at any scale.
  const { data: totalTrips = 0 }    = useQuery({ queryKey: ["dash-trips-count"],    queryFn: () => api.entities.Trip.count(),    staleTime: 30_000 });
  const { data: totalBookings = 0 } = useQuery({ queryKey: ["dash-bookings-count"], queryFn: () => api.entities.Booking.count(), staleTime: 30_000 });
  const { data: totalUsers = 0 }    = useQuery({ queryKey: ["dash-users-count"],    queryFn: () => api.entities.User.count(),    staleTime: 30_000 });

  // Reviews — separate query just for the average-rating stat card.
  // The previous Dashboard didn't pull reviews at all so 'متوسط تقييم
  // الرحلات' was a permanent '—'. Filter to passenger→driver direction
  // (matches every other rating average surface). The same null-rating
  // defensive filter as RatingSummary/StatsBar.
  const { data: reviews = [] } = useQuery({
    queryKey: ["dash-reviews-stats"],
    queryFn: () => api.entities.Review.filter({ review_type: "passenger_rates_driver" }, "-created_date", 500),
    staleTime: 60_000,
  });

  // Month-over-month delta computation.
  // 'Now' window: start of current month → now
  // 'Prev' window: start of previous month → start of current month
  // For each stat, fetch a count restricted to created_at in each window
  // and compute the percentage delta. PostgREST doesn't accept range
  // operators via the eq-only conditions object, so we use the supabase
  // client directly inline rather than threading new params through
  // Entity.count.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthIso = prevMonthStart.toISOString();
  const monthIso     = monthStart.toISOString();

  const useMonthCount = (table, prevKey, nowKey) => {
    const prev = useQuery({
      queryKey: [prevKey],
      queryFn: async () => {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .gte('created_at', prevMonthIso)
          .lt('created_at', monthIso);
        return count ?? 0;
      },
      staleTime: 5 * 60_000, // previous-month count rarely changes
    });
    const cur = useQuery({
      queryKey: [nowKey],
      queryFn: async () => {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .gte('created_at', monthIso);
        return count ?? 0;
      },
      staleTime: 60_000,
    });
    return { prev: prev.data ?? 0, cur: cur.data ?? 0 };
  };

  const usersDelta    = useMonthCount('profiles',     'dash-users-prev-month',    'dash-users-cur-month');
  const tripsDelta    = useMonthCount('trips',        'dash-trips-prev-month',    'dash-trips-cur-month');
  const bookingsDelta = useMonthCount('bookings',     'dash-bookings-prev-month', 'dash-bookings-cur-month');

  // Revenue MoM — compute from bookings.total_price in each window.
  // Filter on confirmed/completed to match the totalRevenue computation
  // below. Two separate queries because we want the per-row prices,
  // not just the count.
  const { data: prevMonthRevenueBookings = [] } = useQuery({
    queryKey: ["dash-revenue-prev-month"],
    queryFn: async () => {
      const { data } = await supabase
        .from('bookings')
        .select('total_price, status')
        .gte('created_at', prevMonthIso)
        .lt('created_at', monthIso)
        .in('status', ['confirmed', 'completed']);
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
  const { data: curMonthRevenueBookings = [] } = useQuery({
    queryKey: ["dash-revenue-cur-month"],
    queryFn: async () => {
      const { data } = await supabase
        .from('bookings')
        .select('total_price, status')
        .gte('created_at', monthIso)
        .in('status', ['confirmed', 'completed']);
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const prevMonthRevenue = prevMonthRevenueBookings.reduce((s, b) => s + (Number(b.total_price) || 0), 0);
  const curMonthRevenue  = curMonthRevenueBookings.reduce((s, b) => s + (Number(b.total_price) || 0), 0);

  // Format a delta as "+12%" / "−5%" / "—" with up/down boolean for
  // colour coding. Handle the edge cases:
  //   prev=0 → can't compute a percentage; if cur>0 show "جديد" (new),
  //            else dash. Showing "+∞%" looks broken.
  //   prev=0 cur=0 → dash, nothing happened.
  //   both numbers > 0 → standard percentage with rounding.
  const formatDelta = (cur, prev) => {
    if (prev === 0 && cur === 0) return { text: "—", up: true };
    if (prev === 0) return { text: "جديد", up: true };
    const pct = ((cur - prev) / prev) * 100;
    const rounded = Math.round(pct);
    const sign = rounded > 0 ? "+" : "";
    return { text: `${sign}${rounded}%`, up: rounded >= 0 };
  };

  const usersChange    = formatDelta(usersDelta.cur,    usersDelta.prev);
  const tripsChange    = formatDelta(tripsDelta.cur,    tripsDelta.prev);
  const bookingsChange = formatDelta(bookingsDelta.cur, bookingsDelta.prev);
  const revenueChange  = formatDelta(curMonthRevenue,   prevMonthRevenue);

  // Today vs all-time: previously the stat cards LABELED 'Active users
  // today' / 'Bookings today' but the values were totalUsers and
  // confirmedBookings (all-time). Admin saw inflated 'today' numbers.
  // Compute real today counts now.
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const usersToday    = users.filter((u)    => u.created_at && new Date(u.created_at) >= todayStart).length;
  const bookingsToday = bookings.filter((b) => b.created_at && new Date(b.created_at) >= todayStart).length;

  // Revenue counts only bookings that actually represent realised value:
  // confirmed (driver accepted, money owed) or completed (trip done). The
  // pre-fix code summed ALL bookings — cancelled ones inflated the total
  // and disagreed with DashboardPayments which excluded them via RPC.
  // Eventually this should also gate on payment_status === 'paid' once the
  // payment-tracking flow has been in production long enough that drivers/
  // admins are reliably marking transactions paid.
  const totalRevenue = bookings
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .reduce((sum, b) => sum + (b.total_price || 0), 0);
  const confirmedBookings = bookings.filter((b) => b.status === "confirmed").length;

  // Completion / cancellation rates derived from the live bookings list.
  // Used in the bottom stat row instead of the previous hardcoded
  // "96.3%" / "3.7%" placeholders that bore no relation to actual data.
  const completedCount = bookings.filter((b) => b.status === "completed").length;
  const cancelledCount = bookings.filter((b) =>
    b.status === "cancelled" || b.status === "cancelled_by_driver"
  ).length;
  const completionRate = totalBookings > 0
    ? Math.round((completedCount / totalBookings) * 1000) / 10
    : 0;
  const cancellationRate = totalBookings > 0
    ? Math.round((cancelledCount / totalBookings) * 1000) / 10
    : 0;

  // Average trip rating. Previously this card displayed a permanent '—'
  // because Dashboard.jsx didn't fetch reviews at all. Now: average the
  // passenger→driver reviews, with the same null-rating defensive filter
  // as RatingSummary/StatsBar (a single null rating row would propagate
  // through reduce as NaN and display 'NaN/5' on the admin dashboard).
  const validReviews = reviews.filter(r => typeof r.rating === "number" && !isNaN(r.rating));
  const avgRating = validReviews.length > 0
    ? (validReviews.reduce((s, r) => s + r.rating, 0) / validReviews.length).toFixed(1)
    : null;

  // Day-over-day delta for the 'today' cards. usersToday/bookingsToday
  // are derived from in-memory rows above; we just need yesterday's
  // counts to compare against, again from in-memory.
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const usersYesterday    = users.filter((u)    => u.created_at && new Date(u.created_at) >= yesterdayStart && new Date(u.created_at) < todayStart).length;
  const bookingsYesterday = bookings.filter((b) => b.created_at && new Date(b.created_at) >= yesterdayStart && new Date(b.created_at) < todayStart).length;
  const usersTodayChange    = formatDelta(usersToday,    usersYesterday);
  const bookingsTodayChange = formatDelta(bookingsToday, bookingsYesterday);

  const bottomStats = [
    // 'إجمالي المعاملات' (total transactions) MoM = bookings MoM
    { title: "إجمالي المعاملات", value: totalBookings.toLocaleString(), change: bookingsChange.text, up: bookingsChange.up, icon: CreditCard },
    // Avg rating now computed; delta would require a historical
    // aggregate we don't store — leave as the value-only card.
    { title: "متوسط تقييم الرحلات", value: avgRating ? `${avgRating}/5` : "—", change: "—", icon: Star },
    // Completion/cancellation rate deltas would need a historical
    // ratio comparison — left as '—' (these two are the rate over
    // the displayed window, not point-in-time).
    { title: "نسبة الرحلات المكتملة", value: `${completionRate}%`, change: "—", icon: CalendarCheck },
    { title: "نسبة الإلغاء", value: `${cancellationRate}%`, change: "—", icon: AlertCircle },
  ];

  // Helper to format dates safely (handles created_at from Supabase)
  const safeDate = (d) => d ? new Date(d) : new Date();

  const statCards = [
    // Labels now match values: 'today' cards use today counts, 'total'
    // cards use all-time counts. Previously both said 'today' but
    // showed all-time, inflating the dashboard for the admin.
    //
    // change strings now show actual deltas:
    // - 'today' cards: today vs yesterday (day-over-day)
    // - 'total' cards: this month vs last month (month-over-month)
    // The placeholder '—' has been replaced everywhere a delta can
    // actually be computed.
    { title: "المستخدمون الجدد اليوم", value: usersToday.toString(),    change: usersTodayChange.text,    up: usersTodayChange.up,    icon: Users,         bg: "bg-primary/10",     iconColor: "text-primary", period: "مقارنة بالأمس" },
    { title: "الحجوزات اليوم",         value: bookingsToday.toString(), change: bookingsTodayChange.text, up: bookingsTodayChange.up, icon: CalendarCheck, bg: "bg-accent/10",      iconColor: "text-accent",  period: "مقارنة بالأمس" },
    { title: "إجمالي المستخدمين",      value: totalUsers.toString(),    change: usersChange.text,         up: usersChange.up,         icon: Users,         bg: "bg-primary/10",     iconColor: "text-primary" },
    { title: "إجمالي الرحلات",         value: totalTrips.toString(),    change: tripsChange.text,         up: tripsChange.up,         icon: Car,           bg: "bg-accent/10",      iconColor: "text-accent" },
    { title: "إجمالي الإيرادات",       value: `₪${totalRevenue.toLocaleString()}`, change: revenueChange.text, up: revenueChange.up, icon: DollarSign, bg: "bg-yellow-500/10", iconColor: "text-yellow-600" },
  ];

  // ── Daily trips chart (last 7 days) ───────────────────────────────
  // Previously this was `trips.slice(0, 7)` with each row's created_at as
  // the label — labels promised a daily timeseries but the data was just
  // 'the 7 most recent trips', which could all be from today or all from
  // last month. Now buckets trips into the last 7 calendar days so each
  // bar reflects ACTUAL trip volume for that day, including zero days.
  const chartData = (() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0,0,0,0);
      d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const count = trips.filter((t) => {
        const tc = t.created_at ? new Date(t.created_at) : null;
        return tc && tc >= d && tc < next;
      }).length;
      days.push({
        name:  d.toLocaleDateString("ar-EG", { month: "short", day: "numeric" }),
        value: count,
      });
    }
    return days;
  })();

  // ── Pie: account-type breakdown ───────────────────────────────────
  // Previously `passengerCount` AND `driverCount` both counted users
  // with account_type='both' — a 'both' user appeared twice in the
  // pie, inflating each segment. Split into THREE categories so each
  // user is counted exactly once.
  const passengerOnlyCount = users.filter((u) => u.account_type === "passenger").length;
  const driverOnlyCount    = users.filter((u) => u.account_type === "driver").length;
  const bothCount          = users.filter((u) => u.account_type === "both").length;
  const pieData = [
    { name: "ركاب فقط",   value: passengerOnlyCount, color: "hsl(135, 20%, 30%)" },
    { name: "سائقون فقط", value: driverOnlyCount,    color: "hsl(90, 35%, 42%)" },
    { name: "كلاهما",     value: bothCount,          color: "hsl(45, 60%, 50%)" },
  ].filter((slice) => slice.value > 0);

  // ── Revenue chart (last 4 calendar weeks, rolling) ────────────────
  // Previously `bookings.slice(0,25)` / `.slice(25,50)` etc., labeled
  // "Week 1" through "Week 4" — those were NOT weeks, they were
  // arbitrary 25-row chunks from a newest-first list. So "Week 1"
  // really meant "the 25 most recent bookings". Numbers were
  // unrelated to calendar time. Bucket properly now.
  const revenueData = (() => {
    const weeks = [];
    const now = new Date();
    now.setHours(0,0,0,0);
    for (let i = 3; i >= 0; i--) {
      const end   = new Date(now); end.setDate(now.getDate() - i * 7);
      const start = new Date(end); start.setDate(end.getDate() - 7);
      const value = bookings
        .filter((b) => {
          if (!b.created_at) return false;
          if (b.status !== "confirmed" && b.status !== "completed") return false;
          const bc = new Date(b.created_at);
          return bc >= start && bc < end;
        })
        .reduce((sum, b) => sum + (b.total_price || 0), 0);
      weeks.push({
        name:  `أسبوع ${4 - i}`,
        value,
      });
    }
    return weeks;
  })();

  // Recent trips
  const recentTrips = trips.slice(0, 4).map((trip) => ({
    id: `#${trip.id.slice(0, 4).toUpperCase()}`,
    from: trip.from_city,
    to: trip.to_city,
    driver: trip.driver_name,
    date: safeDate(trip.created_at).toLocaleDateString("ar-EG"),
    time: trip.time,
    status: trip.status,
  }));
  return (
    <>
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {statCards.map((stat) => {
          // Visual treatment of the delta depends on what kind of value it is:
          //   '—'    → no comparison data, neutral grey, no arrow
          //   'جديد' → previous period was empty, new activity is a positive
          //            signal but a percentage is meaningless; neutral primary
          //   '+X%' / '-X%' → green up / red down per up flag
          // The previous render always showed a green up-arrow regardless,
          // even when change was '—'. And the "مقارنة بالأسبوع الماضي" (last
          // week) suffix was a lie — top cards now compare month-over-month,
          // today-cards compare day-over-day. Use stat.period if provided,
          // otherwise omit the suffix entirely so the user reads the delta
          // value alone.
          const isPlaceholder = stat.change === "—";
          const isNew = stat.change === "جديد";
          const showTrendIcon = !isPlaceholder && !isNew;
          const valueColor = isPlaceholder
            ? "text-muted-foreground"
            : isNew
              ? "text-primary"
              : stat.up ? "text-green-500" : "text-destructive";
          return (
            <div key={stat.title} className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">{stat.title}</p>
                <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                  <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
                </div>
              </div>
              <p className="text-xl font-bold text-foreground">{stat.value}</p>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {showTrendIcon && (stat.up
                  ? <TrendingUp className="w-3 h-3 text-green-500" />
                  : <TrendingDown className="w-3 h-3 text-destructive" />
                )}
                <span className={`text-xs ${valueColor}`}>{stat.change}</span>
                {!isPlaceholder && (
                  <span className="text-xs text-muted-foreground">{stat.period || "مقارنة بالشهر الماضي"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts Row — lazy-loaded so recharts doesn't block initial dashboard paint */}
      <Suspense fallback={
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {[0,1,2].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border p-4 h-64 animate-pulse" />
          ))}
        </div>
      }>
        <DashboardCharts
          pieData={pieData}
          chartData={chartData}
          revenueData={revenueData}
          totalRevenue={totalRevenue}
          revenueChange={revenueChange}
        />
      </Suspense>

      {/* Recent Trips + Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-card rounded-xl border border-border">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-bold text-sm">أحدث الرحلات</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-muted-foreground border-b border-border">
                  <th className="p-3">رقم الرحلة</th><th className="p-3">من</th><th className="p-3">إلى</th>
                  <th className="p-3">السائق</th><th className="p-3">التاريخ</th><th className="p-3">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {recentTrips.map((trip) => (
                  <tr key={trip.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-3 font-medium">{trip.id}</td>
                    <td className="p-3">{trip.from}</td>
                    <td className="p-3">{trip.to}</td>
                    <td className="p-3">{trip.driver}</td>
                    <td className="p-3 text-muted-foreground">{trip.date} {trip.time}</td>
                    <td className="p-3"><Badge className={`${statusColors[trip.status] || "bg-muted"} text-xs`}>{trip.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border">
          <div className="p-4 border-b border-border">
            <h3 className="font-bold text-sm">أحدث الإشعارات</h3>
          </div>
          <div className="p-2">
           {notifications.map((n) => (
             <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
               <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                 <AlertCircle className="w-4 h-4 text-primary" />
               </div>
               <div>
                 <p className="text-xs">{n.message}</p>
                 <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                   <Clock className="w-3 h-3" />{safeDate(n.created_at).toLocaleDateString("ar-EG")}
                 </p>
               </div>
             </div>
           ))}
          </div>
        </div>
      </div>

      {/* Bottom Stats — computed from live booking + trip data instead
          of fabricated metrics. Some values are placeholders ("—") until
          we have a rating/cancellation pipeline rich enough to compute
          them honestly; that's better than showing invented numbers. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {bottomStats.map((stat) => (
          <div key={stat.title} className="bg-card rounded-xl border border-border p-4 text-center">
            <stat.icon className="w-5 h-5 text-primary mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
          </div>
        ))}
      </div>
    </>
  );
}

const pageTitles = {
  overview: { title: "الرئيسية", subtitle: "نظرة عامة على المنصة" },
  users: { title: "إدارة المستخدمين", subtitle: "عرض وإدارة جميع المستخدمين" },
  deletions: { title: "حذف الحسابات", subtitle: "إحصائيات وأسباب حذف المستخدمين لحساباتهم" },
  trips: { title: "إدارة الرحلات", subtitle: "عرض وإدارة جميع الرحلات" },
  bookings: { title: "إدارة الحجوزات", subtitle: "عرض وإدارة جميع الحجوزات" },
  reviews: { title: "التقييمات والمراجعات", subtitle: "إدارة تقييمات المستخدمين" },
  payments: { title: "المعاملات والمدفوعات", subtitle: "تتبع الإيرادات والمعاملات المالية" },
  subscriptions: { title: "اشتراكات السائقين", subtitle: "مراجعة طلبات الاشتراك الشهري وتفعيلها" },
  reports: { title: "بلاغات المستخدمين", subtitle: "مراجعة البلاغات والإجراءات الإدارية" },
  notifications: { title: "الإشعارات", subtitle: "سجل أحداث المنصة" },
  support: { title: "الدعم والشكاوى", subtitle: "إدارة تذاكر الدعم الفني" },
  feedback: { title: "الاقتراحات والشكاوى", subtitle: "ملاحظات المستخدمين" },
  licenses: { title: "توثيق السائقين", subtitle: "مراجعة جميع وثائق السائق (الرخصة، التسجيل، التأمين، السيلفي)" },
  content: { title: "إدارة المحتوى", subtitle: "إعلانات التطبيق والمدن المدعومة" },
  offers: { title: "إدارة العروض والكوبونات", subtitle: "إنشاء وإدارة كوبونات الخصم" },
  "hero-slides": { title: "شرائح الصفحة الرئيسية", subtitle: "ارفع وأدر صور المدن التي تظهر في الصفحة الرئيسية" },
  settings: { title: "إعدادات النظام", subtitle: "إعدادات التطبيق العامة" },
  logs: { title: "سجل النشاطات", subtitle: "جميع أحداث المنصة" },
};

export default function Dashboard() {
  useSEO({ title: "لوحة الإدارة", description: "لوحة إدارة منصة مشوارو" });
  const { user, isLoadingAuth } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL-driven tab state. Bookmarking /dashboard?tab=payments now lands
  // on the payments tab instead of crashing the error boundary, and back/
  // forward navigation moves between tabs.
  const initialTab = searchParams.get("tab") || "overview";
  const [activePage, _setActivePage] = useState(initialTab);
  const setActivePage = (next) => {
    _setActivePage(next);
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };
  // Catch URL changes from outside (back button, paste a deep link, etc.)
  React.useEffect(() => {
    const t = searchParams.get("tab") || "overview";
    if (t !== activePage) _setActivePage(t);
  }, [searchParams]);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);

  // Two-stage broadcast: message composer → explicit "are you sure?" →
  // RPC. Without the second step, one click reaches every user with no
  // undo — too easy to misfire.
  const [broadcastConfirm, setBroadcastConfirm] = useState(false);
  const requestBroadcast = () => {
    if (!broadcastMsg.trim()) return;
    setBroadcastConfirm(true);
  };
  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBroadcasting(true);
    try {
      const { data: count, error } = await supabase.rpc("broadcast_notification", {
        title_text: "📢 إشعار من الإدارة",
        message_text: broadcastMsg,
      });
      if (error) throw error;
      toast.success(`تم إرسال الإشعار لـ ${count ?? 0} مستخدم ✅`);
      setBroadcastMsg("");
      setShowBroadcast(false);
      setBroadcastConfirm(false);
    } catch (e) {
      toast.error(friendlyError(e, "فشل إرسال الإشعار"));
    } finally {
      setBroadcasting(false);
    }
  };
  const info = pageTitles[activePage] || pageTitles.overview;

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-background gap-4" dir="rtl">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-bold">وصول مرفوض</h2>
        <p className="text-sm text-muted-foreground">هذه الصفحة مخصصة للمديرين فقط</p>
        <Link to="/" className="text-primary text-sm hover:underline">العودة للرئيسية</Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <DashboardSidebar activePage={activePage} setActivePage={setActivePage} />
      <div className="flex-1 p-4 sm:p-6 overflow-x-hidden">
        {/* Top Bar */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{info.title}</h1>
            <p className="text-sm text-muted-foreground">{info.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowBroadcast(true)}
              className="flex items-center gap-2 px-2 sm:px-3 py-2 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
              title="إرسال إشعار لجميع المستخدمين"
              aria-label="بث إشعار"
            >
              <Bell className="w-4 h-4" />
              {/* Label hidden on mobile to save horizontal space — the bell
                  icon plus aria-label keeps it discoverable. Was previously
                  the entire button that was hidden on mobile, which left
                  admins on phones with no way to broadcast at all. */}
              <span className="hidden sm:inline">بث إشعار</span>
            </button>

            {/* Admin's own notification bell — shows all notifications
                addressed to souqnamarketplace@gmail.com (license requests,
                reports, subscription requests, low ratings, city
                suggestions, support tickets, etc).

                Uses AdminNotificationBell — a dedicated component that:
                  - Has its own user-scoped realtime channel name to avoid
                    colliding with the consumer NotificationBell that
                    AppLayout's Navbar/MobileLayout already renders
                  - Polls every 30s as a realtime fallback
                  - Skips the entity-level subscribe (which has the
                    non-scoped channel name that races with the consumer
                    bell when both mount simultaneously)
                Wrapping ErrorBoundary kept as defense-in-depth for any
                other unexpected failure mode. */}
            <ErrorBoundary fallback={null}>
              <div className="bg-card rounded-xl border border-border h-10 flex items-center px-1">
                <AdminNotificationBell userEmail={user?.email} />
              </div>
            </ErrorBoundary>
            <div className="flex items-center gap-2 bg-card rounded-xl px-3 py-2 border border-border">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                {user?.avatar_url ? <img loading="lazy" src={user.avatar_url} className="w-full h-full rounded-full object-cover" alt="" /> : "أ"}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">{user?.full_name || "مدير النظام"}</p>
                <p className="text-xs text-muted-foreground">admin</p>
              </div>
            </div>
          </div>

          {/* Broadcast Modal */}
          {showBroadcast && createPortal(
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md" dir="rtl">
                <h3 className="font-bold text-lg mb-1">📢 بث إشعار لجميع المستخدمين</h3>
                <p className="text-sm text-muted-foreground mb-4">سيصل هذا الإشعار لجميع المستخدمين المسجلين</p>
                <textarea
                  value={broadcastMsg}
                  onChange={e => setBroadcastMsg(e.target.value)}
                  placeholder="اكتب رسالتك هنا..."
                  className="w-full h-28 px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm resize-none mb-3"
                />
                <div className="flex gap-2">
                  <button onClick={requestBroadcast} disabled={broadcasting || !broadcastMsg.trim()} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                    {broadcasting ? "جاري الإرسال..." : "إرسال الآن"}
                  </button>
                  <button onClick={() => setShowBroadcast(false)} className="px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm">إلغاء</button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* Second-stage broadcast confirmation — final guard before
              fan-out RPC fires a notification at every user in the DB. */}
          {broadcastConfirm && createPortal(
            <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
              <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md" dir="rtl">
                <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 flex items-center justify-center mb-3">
                  <span className="text-2xl">⚠️</span>
                </div>
                <h3 className="font-bold text-lg mb-1">إرسال إلى جميع المستخدمين؟</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  هذا الإشعار سيظهر لكل المستخدمين المسجلين في التطبيق ولا يمكن استرجاعه.
                </p>
                <div className="bg-muted/40 rounded-xl p-3 mb-4 text-sm border border-border whitespace-pre-wrap">
                  {broadcastMsg}
                </div>
                <div className="flex gap-2">
                  <button onClick={sendBroadcast} disabled={broadcasting} className="flex-1 bg-destructive text-destructive-foreground rounded-xl py-2.5 text-sm font-bold disabled:opacity-50">
                    {broadcasting ? "جاري الإرسال..." : "نعم، أرسل للجميع"}
                  </button>
                  <button onClick={() => setBroadcastConfirm(false)} disabled={broadcasting} className="px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm">
                    تراجع
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>

        {/* Mobile-only tab selector — at <1024px the desktop sidebar is
            hidden and admins had no way to switch sections. This dropdown
            replicates every menuItem the sidebar exposes. */}
        <DashboardMobileTabSelector activePage={activePage} setActivePage={setActivePage} />

        {activePage === "overview" && <Overview />}
        {activePage === "users" && <DashboardUsers />}
        {activePage === "trips" && <DashboardTrips />}
        {activePage === "bookings" && <DashboardBookings />}
        {activePage === "trip-requests" && <DashboardRequests />}
        {activePage === "passenger-verifications" && <DashboardPassengerVerifications />}
        {activePage === "reviews" && <DashboardReviews />}
        {activePage === "payments" && <DashboardPayments />}
        {activePage === "subscriptions" && <DashboardSubscriptions />}
        {activePage === "reports" && <DashboardReports />}
        {activePage === "notifications" && <DashboardNotifications />}
        {activePage === "broadcasts" && <DashboardBroadcasts />}
        {activePage === "support" && <DashboardSupport />}
        {activePage === "feedback" && <DashboardFeedback />}
        {activePage === "licenses" && <DashboardLicenses />}
        {activePage === "content" && <DashboardContent />}
        {activePage === "deletions" && <DashboardDeletions />}
        {/* Offers / coupons — hidden from sidebar but URL-accessible via
            bookmarks. Render a "coming soon" notice instead of the half-
            wired DashboardOffers UI so admin doesn't accidentally create
            coupons that customers can't redeem. See sidebar comment for
            full reasoning. */}
        {activePage === "offers" && (
          <div className="bg-card border border-border rounded-2xl p-12 text-center" dir="rtl">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🎟️</span>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">العروض والكوبونات</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              نظام الكوبونات قيد التطوير وسيتوفر في تحديث قادم.
              في الإصدار الحالي، لا يوجد حقل لإدخال رمز كوبون في صفحة الحجز،
              لذا تم إخفاء الإنشاء مؤقتاً لتجنب تشويش المستخدمين.
            </p>
            <Link to="/dashboard" className="inline-block mt-6 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
              العودة للوحة التحكم
            </Link>
          </div>
        )}
        {activePage === "hero-slides" && <DashboardHeroSlides />}
        {activePage === "settings" && <DashboardSettings />}
        {activePage === "logs" && <DashboardLogs />}
        {activePage === "cities" && <DashboardCities />}
      </div>
    </div>
  );
}