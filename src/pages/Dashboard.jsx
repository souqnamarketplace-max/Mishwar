import React, { useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Navigate, useSearchParams, Link } from "react-router-dom";
import DashboardSidebar, { DashboardMobileTabSelector } from "../components/dashboard/DashboardSidebar";
import DashboardUsers from "./dashboard/DashboardUsers";
import DashboardTrips from "./dashboard/DashboardTrips";
import DashboardBookings from "./dashboard/DashboardBookings";
import DashboardReviews from "./dashboard/DashboardReviews";
import DashboardPayments from "./dashboard/DashboardPayments";
import DashboardSubscriptions from "./dashboard/DashboardSubscriptions";
import DashboardReports from "./dashboard/DashboardReports";
import DashboardNotifications from "./dashboard/DashboardNotifications";
import DashboardSupport from "./dashboard/DashboardSupport";
import DashboardFeedback from "./dashboard/DashboardFeedback";
import DashboardContent from "./dashboard/DashboardContent";
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
  const { data: trips = [] } = useQuery({
    queryKey: ["all-trips-stats"],
    queryFn: () => base44.entities.Trip.list("-created_date", 100),
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["all-bookings-stats"],
    queryFn: () => base44.entities.Booking.list("-created_date", 100),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["all-users-stats"],
    queryFn: () => base44.entities.User.list("-created_date", 100),
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["all-notifications"],
    queryFn: () => base44.entities.Notification.list("-created_date", 10),
  });

  // Calculate stats
  const totalTrips = trips.length;
  const totalBookings = bookings.length;
  const totalUsers = users.length;
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
  const bottomStats = [
    { title: "إجمالي المعاملات", value: totalBookings.toLocaleString(), change: "—", icon: CreditCard },
    { title: "متوسط تقييم الرحلات", value: "—", change: "—", icon: Star },
    { title: "نسبة الرحلات المكتملة", value: `${completionRate}%`, change: "—", icon: CalendarCheck },
    { title: "نسبة الإلغاء", value: `${cancellationRate}%`, change: "—", icon: AlertCircle },
  ];

  // Helper to format dates safely (handles created_at from Supabase)
  const safeDate = (d) => d ? new Date(d) : new Date();

  const statCards = [
    { title: "المستخدمين النشطين اليوم", value: totalUsers.toString(), change: "—", up: true, icon: Users, bg: "bg-primary/10", iconColor: "text-primary" },
    { title: "الحجوزات اليوم", value: confirmedBookings.toString(), change: "—", up: true, icon: CalendarCheck, bg: "bg-accent/10", iconColor: "text-accent" },
    { title: "إجمالي المستخدمين", value: totalUsers.toString(), change: "—", up: true, icon: Users, bg: "bg-primary/10", iconColor: "text-primary" },
    { title: "إجمالي الرحلات", value: totalTrips.toString(), change: "—", up: true, icon: Car, bg: "bg-accent/10", iconColor: "text-accent" },
    { title: "إجمالي الإيرادات", value: `₪${totalRevenue.toLocaleString()}`, change: "—", up: true, icon: DollarSign, bg: "bg-yellow-500/10", iconColor: "text-yellow-600" },
  ];

  // Chart data from recent trips
  const chartData = trips.slice(0, 7).map((trip, i) => ({
    name: safeDate(trip.created_at).toLocaleDateString("ar-EG"),
    value: trip?.price || 0,
  }));

  // Pie data from user types
  const driverCount = users.filter((u) => u.account_type === "driver" || u.account_type === "both").length;
  const passengerCount = users.filter((u) => u.account_type === "passenger" || u.account_type === "both").length;
  
  const pieData = [
    { name: "ركاب", value: passengerCount, color: "hsl(135, 20%, 30%)" },
    { name: "سائقون", value: driverCount, color: "hsl(90, 35%, 42%)" },
  ];

  // Revenue data grouped by week
  const revenueData = [
    { name: "الأسبوع 1", value: bookings.slice(0, 25).reduce((sum, b) => sum + (b.total_price || 0), 0) },
    { name: "الأسبوع 2", value: bookings.slice(25, 50).reduce((sum, b) => sum + (b.total_price || 0), 0) },
    { name: "الأسبوع 3", value: bookings.slice(50, 75).reduce((sum, b) => sum + (b.total_price || 0), 0) },
    { name: "الأسبوع 4", value: bookings.slice(75, 100).reduce((sum, b) => sum + (b.total_price || 0), 0) },
  ];

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
        {statCards.map((stat) => (
          <div key={stat.title} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{stat.title}</p>
              <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="text-xl font-bold text-foreground">{stat.value}</p>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {stat.up ? <TrendingUp className="w-3 h-3 text-green-500" /> : <TrendingDown className="w-3 h-3 text-destructive" />}
              <span className={`text-xs ${stat.up ? "text-green-500" : "text-destructive"}`}>{stat.change}</span>
              <span className="text-xs text-muted-foreground">مقارنة بالأسبوع الماضي</span>
            </div>
          </div>
        ))}
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
        {activePage === "reviews" && <DashboardReviews />}
        {activePage === "payments" && <DashboardPayments />}
        {activePage === "subscriptions" && <DashboardSubscriptions />}
        {activePage === "reports" && <DashboardReports />}
        {activePage === "notifications" && <DashboardNotifications />}
        {activePage === "support" && <DashboardSupport />}
        {activePage === "feedback" && <DashboardFeedback />}
        {activePage === "licenses" && <DashboardLicenses />}
        {activePage === "content" && <DashboardContent />}
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