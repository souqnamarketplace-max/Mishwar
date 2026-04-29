import React from "react";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Car, Users, Star, CalendarCheck } from "lucide-react";

export default function DashboardReports() {
  // Single aggregation RPC — replaces 3 list() calls of 200 rows each (~600 rows total)
  const { data: metrics = {}, isLoading } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_metrics");
      if (error) throw error;
      return data || {};
    },
    refetchInterval: 30000, // refresh every 30 seconds (cached server-side)
  });

  // Time-series data for charts (separate RPC, only when needed)
  const { data: timeseries = {} } = useQuery({
    queryKey: ["dashboard-timeseries"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_timeseries");
      if (error) throw error;
      return data || {};
    },
    staleTime: 60000, // 1 min cache
  });

  // Transform server data into chart format
  const cityData = metrics.trips_by_city || [];

  const bookingStatuses = metrics.bookings_by_status || {};
  const statusData = [
    { name: "مؤكد",  value: bookingStatuses.confirmed || 0, color: "hsl(90, 35%, 42%)" },
    { name: "معلق",  value: bookingStatuses.pending || 0,   color: "hsl(40, 80%, 55%)" },
    { name: "ملغي",  value: bookingStatuses.cancelled || 0, color: "hsl(0, 84%, 60%)" },
    { name: "مكتمل", value: bookingStatuses.completed || 0, color: "hsl(135, 20%, 30%)" },
  ];

  const tripStatuses = metrics.trips_by_status || {};
  const tripStatusData = [
    { name: "مؤكدة",  value: tripStatuses.confirmed || 0 },
    { name: "مباشرة", value: tripStatuses.in_progress || 0 },
    { name: "مكتملة", value: tripStatuses.completed || 0 },
    { name: "ملغاة",  value: tripStatuses.cancelled || 0 },
  ];

  const tripsByDay = (timeseries.trips_by_day || []).map(d => ({
    date: new Date(d.date).toLocaleDateString("ar", { month: "short", day: "numeric" }),
    count: d.count,
  }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards (server-side counts) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "إجمالي الرحلات",  value: (metrics.total_trips ?? 0).toLocaleString("ar"),    icon: Car,           color: "text-primary",  bg: "bg-primary/10" },
          { label: "إجمالي الحجوزات", value: (metrics.total_bookings ?? 0).toLocaleString("ar"), icon: CalendarCheck, color: "text-accent",   bg: "bg-accent/10" },
          { label: "متوسط التقييم",   value: metrics.avg_rating ?? "—",                          icon: Star,          color: "text-yellow-600", bg: "bg-yellow-500/10" },
          { label: "إجمالي الإيرادات",value: `₪${(metrics.total_revenue ?? 0).toLocaleString()}`, icon: TrendingUp,    color: "text-green-600", bg: "bg-green-500/10" },
        ].map((s) => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* This week activity */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "رحلات هذا الأسبوع",   value: metrics.trips_this_week ?? 0,    icon: "🚗" },
          { label: "حجوزات هذا الأسبوع",  value: metrics.bookings_this_week ?? 0, icon: "📅" },
          { label: "تقييمات هذا الأسبوع", value: metrics.reviews_this_week ?? 0,  icon: "⭐" },
          { label: "مستخدمون جدد",        value: metrics.new_users_this_week ?? 0, icon: "👥" },
        ].map((s) => (
          <div key={s.label} className="bg-muted/30 rounded-xl p-3">
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-lg font-bold">{(s.value).toLocaleString("ar")}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-bold text-sm mb-4">الرحلات حسب المدينة</h3>
          <div className="h-56">
            {cityData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">لا توجد بيانات بعد</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(40,10%,90%)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(135, 20%, 30%)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-bold text-sm mb-4">توزيع حالات الحجوزات</h3>
          <div className="h-56 flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 shrink-0">
              {statusData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span>{d.name} ({d.value})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Trips over time */}
      {tripsByDay.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-bold text-sm mb-4">الرحلات خلال آخر 30 يوماً</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tripsByDay}>
                <defs>
                  <linearGradient id="tripGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(135, 20%, 30%)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(135, 20%, 30%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(40,10%,90%)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="hsl(135, 20%, 30%)" fill="url(#tripGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Trip statuses */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="font-bold text-sm mb-4">حالات الرحلات</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tripStatusData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(40,10%,90%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(90, 35%, 42%)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
