import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import {
  DollarSign, Users, Car, CalendarCheck, TrendingUp, TrendingDown,
  Star, AlertCircle, ArrowLeft, Bell, Clock
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const statCards = [
  { title: "المستخدمين النشطين اليوم", value: "3,421", change: "+9.1%", up: true, icon: Users, bg: "bg-primary/10", iconColor: "text-primary" },
  { title: "الحجوزات اليوم", value: "1,256", change: "+8.4%", up: true, icon: CalendarCheck, bg: "bg-accent/10", iconColor: "text-accent" },
  { title: "إجمالي المستخدمين", value: "8,746", change: "+12.6%", up: true, icon: Users, bg: "bg-primary/10", iconColor: "text-primary" },
  { title: "إجمالي الرحلات", value: "2,853", change: "+15.3%", up: true, icon: Car, bg: "bg-accent/10", iconColor: "text-accent" },
  { title: "إجمالي الإيرادات", value: "₪1,248,560", change: "+18.7%", up: true, icon: DollarSign, bg: "bg-yellow-500/10", iconColor: "text-yellow-600" },
];

const chartData = [
  { name: "21 مايو", value: 320 },
  { name: "22 مايو", value: 380 },
  { name: "23 مايو", value: 290 },
  { name: "24 مايو", value: 450 },
  { name: "25 مايو", value: 520 },
  { name: "26 مايو", value: 642 },
  { name: "27 مايو", value: 580 },
];

const pieData = [
  { name: "ركاب", value: 5531, color: "hsl(135, 20%, 30%)" },
  { name: "سائقون", value: 3215, color: "hsl(90, 35%, 42%)" },
];

const revenueData = [
  { name: "الأسبوع 1", value: 180000 },
  { name: "الأسبوع 2", value: 220000 },
  { name: "الأسبوع 3", value: 280000 },
  { name: "الأسبوع 4", value: 340000 },
  { name: "الأسبوع 5", value: 420000 },
];

const recentTrips = [
  { id: "#1258", from: "رام الله", to: "غزة", driver: "أحمد أبو الخير", date: "25 مايو 2024", time: "08:30", status: "مكتملة" },
  { id: "#1257", from: "الخليل", to: "نابلس", driver: "محمد درويش", date: "24 مايو 2024", time: "10:30", status: "مؤكدة" },
  { id: "#1256", from: "بيت لحم", to: "رام الله", driver: "يوسف حمدان", date: "23 مايو 2024", time: "01:15", status: "معدّلة" },
  { id: "#1255", from: "نابلس", to: "جنين", driver: "سامي أبو أحمد", date: "22 مايو 2024", time: "08:45", status: "ملغاة" },
];

const statusColors = {
  "مكتملة": "bg-accent/10 text-accent",
  "مؤكدة": "bg-primary/10 text-primary",
  "معدّلة": "bg-yellow-500/10 text-yellow-600",
  "ملغاة": "bg-destructive/10 text-destructive",
};

const notifications = [
  { text: "تم الإبلاغ عن رحلة رقم #1254", time: "منذ 5 دقائق" },
  { text: "طلب دعم جديد من مسافر بخصوص الحجز رقم #4567", time: "منذ 15 دقيقة" },
  { text: "تم إضافة رحلة جديدة من غزة إلى رام الله", time: "منذ 30 دقيقة" },
  { text: "تم سحب مبلغ ₪350 من محفظة المستخدم", time: "منذ ساعة" },
];

export default function Dashboard() {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <DashboardSidebar />
      <div className="flex-1 p-4 sm:p-6 overflow-x-hidden">
        {/* Top Bar */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">الرئيسية</h1>
            <p className="text-sm text-muted-foreground">نظرة عامة على المنصة</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full" />
            </div>
            <div className="flex items-center gap-2 bg-card rounded-xl px-3 py-2 border border-border">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">أ</div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">أحمد أبو لبن</p>
                <p className="text-xs text-muted-foreground">مدير النظام</p>
              </div>
            </div>
          </div>
        </div>

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
              <div className="flex items-center gap-1 mt-1">
                {stat.up ? (
                  <TrendingUp className="w-3 h-3 text-green-500" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-destructive" />
                )}
                <span className={`text-xs ${stat.up ? "text-green-500" : "text-destructive"}`}>{stat.change}</span>
                <span className="text-xs text-muted-foreground">مقارنة بالأسبوع الماضي</span>
              </div>
            </div>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* User Distribution */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-bold text-sm mb-4">توزيع المستخدمين</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
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

          {/* Trips Chart */}
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

          {/* Revenue */}
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
              <button className="text-xs text-primary hover:underline">عرض الكل</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-xs text-muted-foreground border-b border-border">
                    <th className="p-3">رقم الرحلة</th>
                    <th className="p-3">من</th>
                    <th className="p-3">إلى</th>
                    <th className="p-3">السائق</th>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">الحالة</th>
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
                      <td className="p-3">
                        <Badge className={`${statusColors[trip.status]} text-xs`}>{trip.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-card rounded-xl border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-bold text-sm">أحدث الإشعارات</h3>
              <button className="text-xs text-primary hover:underline">عرض الكل</button>
            </div>
            <div className="p-2">
              {notifications.map((n, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertCircle className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs">{n.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {n.time}
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
      </div>
    </div>
  );
}