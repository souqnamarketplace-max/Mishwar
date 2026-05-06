import React from "react";
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Admin dashboard charts panel.
 *
 * Extracted from Dashboard.jsx so recharts (~420KB / 113KB gzipped)
 * only loads when an admin actually views the dashboard. Previously
 * recharts was bundled in vendor-charts.js and downloaded at first
 * route transition into Dashboard, even though the route itself was
 * already lazy. This is one extra hop further: the chart code
 * (and its recharts dependency) doesn't enter the main admin bundle
 * either.
 *
 * The chart data computations stay in Dashboard.jsx — only the
 * rendering moves here, so this component stays presentational.
 */
export default function DashboardCharts({ pieData, chartData, revenueData, totalRevenue }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      {/* User distribution donut */}
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

      {/* Trips last 7 days */}
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
          <span className="text-2xl font-bold text-primary">₪{totalRevenue.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1 mb-4">
          <TrendingUp className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">— مقارنة بالشهر الماضي</span>
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
  );
}
