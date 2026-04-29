import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Navigate } from "react-router-dom";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardUsers from "./dashboard/DashboardUsers";
import DashboardTrips from "./dashboard/DashboardTrips";
import DashboardBookings from "./dashboard/DashboardBookings";
import DashboardReviews from "./dashboard/DashboardReviews";
import DashboardPayments from "./dashboard/DashboardPayments";
import DashboardReports from "./dashboard/DashboardReports";
import DashboardNotifications from "./dashboard/DashboardNotifications";
import DashboardSupport from "./dashboard/DashboardSupport";
import DashboardContent from "./dashboard/DashboardContent";
import DashboardOffers from "./dashboard/DashboardOffers";
import DashboardSettings from "./dashboard/DashboardSettings";
import DashboardLogs from "./dashboard/DashboardLogs";
import DashboardLicenses from "./dashboard/DashboardLicenses";
import { useState as useBroadcastState } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  DollarSign, Users, Car, CalendarCheck, TrendingUp, TrendingDown,
  Star, AlertCircle, Bell, Clock, CreditCard
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

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
  const totalRevenue = bookings.reduce((sum, b) => sum + (b.total_price || 0), 0);
  const confirmedBookings = bookings.filter((b) => b.status === "confirmed").length;

  // Helper to format dates safely (handles created_at from Supabase)
  const safeDate = (d) => d ? new Date(d) : new Date();

  const statCards = [
    { title: "المستخدمين النشطين اليوم", value: totalUsers.toString(), change: "+9.1%", up: true, icon: Users, bg: "bg-primary/10", iconColor: "text-primary" },
    { title: "الحجوزات اليوم", value: confirmedBookings.toString(), change: "+8.4%", up: true, icon: CalendarCheck, bg: "bg-accent/10", iconColor: "text-accent" },
    { title: "إجمالي المستخدمين", value: totalUsers.toString(), change: "+12.6%", up: true, icon: Users, bg: "bg-primary/10", iconColor: "text-primary" },
    { title: "إجمالي الرحلات", value: totalTrips.toString(), change: "+15.3%", up: true, icon: Car, bg: "bg-accent/10", iconColor: "text-accent" },
    { title: "إجمالي الإيرادات", value: `₪${totalRevenue.toLocaleString()}`, change: "+18.7%", up: true, icon: DollarSign, bg: "bg-yellow-500/10", iconColor: "text-yellow-600" },
  ];

  // Chart data from recent trips
  const chartData = trips.slice(0, 7).map((trip, i) => ({
    name: safeDate(trip.created_at).toLocaleDateString("ar"),
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
    date: safeDate(trip.created_at).toLocaleDateString("ar"),
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-bold text-sm mb-4">توزيع المستخدمين</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                <span>{d.name} ({d.value.toLocaleString()})</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm">الرحلات خلال آخر 7 أيام</h3>
            <Badge variant="outline" className="text-xs">إجمالي</Badge>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(40, 10%, 90%)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="hsl(135, 20%, 30%)" fill="hsl(135, 20%, 30%)" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-bold text-sm mb-2">الإيرادات</h3>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold text-primary">₪1,248,560</span>
          </div>
          <div className="flex items-center gap-1 mb-4">
            <TrendingUp className="w-3 h-3 text-green-500" />
            <span className="text-xs text-green-500">+18.2% مقارنة بالشهر الماضي</span>
          </div>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(40, 10%, 90%)" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="hsl(90, 35%, 42%)" fill="hsl(90, 35%, 42%)" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

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
                   <Clock className="w-3 h-3" />{safeDate(n.created_at).toLocaleDateString("ar")}
                 </p>
               </div>
             </div>
           ))}
          </div>
        </div>
      </div>

      {/* Bottom Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { title: "المعاملات هذا الشهر", value: "2,451", change: "+14.2%", icon: CreditCard },
          { title: "متوسط تقييم الرحلات", value: "4.7/5", change: "0.2 نقاط", icon: Star },
          { title: "نسبة الرحلات المكتملة", value: "96.3%", change: "+2.8%", icon: CalendarCheck },
          { title: "نسبة الإلغاء", value: "3.7%", change: "-1.2%", icon: AlertCircle },
        ].map((stat) => (
          <div key={stat.title} className="bg-card rounded-xl border border-border p-4 text-center">
            <stat.icon className="w-5 h-5 text-primary mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.title}</p>
            <p className="text-xs text-green-500 mt-1">{stat.change}</p>
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
  reports: { title: "التقارير والإحصائيات", subtitle: "تحليل بيانات المنصة" },
  notifications: { title: "الإشعارات", subtitle: "سجل أحداث المنصة" },
  support: { title: "الدعم والشكاوى", subtitle: "إدارة تذاكر الدعم الفني" },
  licenses: { title: "توثيق السائقين", subtitle: "مراجعة جميع وثائق السائق (الرخصة، التسجيل، التأمين، السيلفي)" },
  content: { title: "إدارة المحتوى", subtitle: "إعلانات التطبيق والمدن المدعومة" },
  offers: { title: "إدارة العروض والكوبونات", subtitle: "إنشاء وإدارة كوبونات الخصم" },
  settings: { title: "إعدادات النظام", subtitle: "إعدادات التطبيق العامة" },
  logs: { title: "سجل النشاطات", subtitle: "جميع أحداث المنصة" },
};

export default function Dashboard() {
  const { user, isLoadingAuth } = useAuth();
  const [activePage, setActivePage] = useState("overview");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBroadcasting(true);
    try {
      // Single bulk insert via RPC — replaces N individual inserts (was: 1 query per user, 1000+ queries)
      const { data: count, error } = await supabase.rpc("broadcast_notification", {
        title_text: "📢 إشعار من الإدارة",
        message_text: broadcastMsg,
      });
      if (error) throw error;
      toast.success(`تم إرسال الإشعار لـ ${count ?? 0} مستخدم ✅`);
      setBroadcastMsg("");
      setShowBroadcast(false);
    } catch (e) {
      toast.error("فشل الإرسال: " + e.message);
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
        <a href="/" className="text-primary text-sm hover:underline">العودة للرئيسية</a>
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
              className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
              title="إرسال إشعار لجميع المستخدمين"
            >
              <Bell className="w-4 h-4" />
              بث إشعار
            </button>
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
          {showBroadcast && (
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
                  <button onClick={sendBroadcast} disabled={broadcasting || !broadcastMsg.trim()} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                    {broadcasting ? "جاري الإرسال..." : "إرسال الآن"}
                  </button>
                  <button onClick={() => setShowBroadcast(false)} className="px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm">إلغاء</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {activePage === "overview" && <Overview />}
        {activePage === "users" && <DashboardUsers />}
        {activePage === "trips" && <DashboardTrips />}
        {activePage === "bookings" && <DashboardBookings />}
        {activePage === "reviews" && <DashboardReviews />}
        {activePage === "payments" && <DashboardPayments />}
        {activePage === "reports" && <DashboardReports />}
        {activePage === "notifications" && <DashboardNotifications />}
        {activePage === "support" && <DashboardSupport />}
        {activePage === "licenses" && <DashboardLicenses />}
        {activePage === "content" && <DashboardContent />}
        {activePage === "offers" && <DashboardOffers />}
        {activePage === "settings" && <DashboardSettings />}
        {activePage === "logs" && <DashboardLogs />}
      </div>
    </div>
  );
}