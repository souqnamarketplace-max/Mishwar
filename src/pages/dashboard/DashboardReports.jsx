import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Car, Users, Star, CalendarCheck } from "lucide-react";

export default function DashboardReports() {
  const { data: trips = [] } = useQuery({ queryKey: ["trips"], queryFn: () => base44.entities.Trip.list("-created_date", 200) });
  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: () => base44.entities.Booking.list("-created_date", 200) });
  const { data: reviews = [] } = useQuery({ queryKey: ["reviews"], queryFn: () => base44.entities.Review.list("-created_date", 200) });

  // Group trips by city
  const cityCount = {};
  trips.forEach((t) => {
    cityCount[t.from_city] = (cityCount[t.from_city] || 0) + 1;
  });
  const cityData = Object.entries(cityCount).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  // Group bookings by status
  const statusCount = { confirmed: 0, pending: 0, cancelled: 0, completed: 0 };
  bookings.forEach((b) => { if (statusCount[b.status] !== undefined) statusCount[b.status]++; });
  const statusData = [
    { name: "مؤكد", value: statusCount.confirmed, color: "hsl(90, 35%, 42%)" },
    { name: "معلق", value: statusCount.pending, color: "hsl(40, 80%, 55%)" },
    { name: "ملغي", value: statusCount.cancelled, color: "hsl(0, 84%, 60%)" },
    { name: "مكتمل", value: statusCount.completed, color: "hsl(135, 20%, 30%)" },
  ];

  // Trip statuses
  const tripStatusCount = { confirmed: 0, in_progress: 0, completed: 0, cancelled: 0 };
  trips.forEach((t) => { if (tripStatusCount[t.status] !== undefined) tripStatusCount[t.status]++; });
  const tripStatusData = [
    { name: "مؤكدة", value: tripStatusCount.confirmed },
    { name: "مباشرة", value: tripStatusCount.in_progress },
    { name: "مكتملة", value: tripStatusCount.completed },
    { name: "ملغاة", value: tripStatusCount.cancelled },
  ];

  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : "—";
  const totalRevenue = bookings.reduce((s, b) => s + (b.total_price || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "إجمالي الرحلات", value: trips.length, icon: Car, color: "text-primary", bg: "bg-primary/10" },
          { label: "إجمالي الحجوزات", value: bookings.length, icon: CalendarCheck, color: "text-accent", bg: "bg-accent/10" },
          { label: "متوسط التقييم", value: avgRating, icon: Star, color: "text-yellow-600", bg: "bg-yellow-500/10" },
          { label: "إجمالي الإيرادات", value: `₪${totalRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-green-600", bg: "bg-green-500/10" },
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

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-bold text-sm mb-4">الرحلات حسب المدينة</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(40,10%,90%)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(135, 20%, 30%)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
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

      {/* Charts Row 2 */}
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