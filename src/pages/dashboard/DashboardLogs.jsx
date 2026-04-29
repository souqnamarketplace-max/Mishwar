import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import { Activity, Car, CalendarCheck, Star, Users, Filter } from "lucide-react";
import Pagination from "@/components/dashboard/Pagination";

const typeConfig = {
  booking: { label: "حجز",     icon: CalendarCheck, color: "text-accent bg-accent/10" },
  trip:    { label: "رحلة",    icon: Car,           color: "text-primary bg-primary/10" },
  review:  { label: "تقييم",   icon: Star,          color: "text-yellow-600 bg-yellow-500/10" },
  user:    { label: "مستخدم",  icon: Users,         color: "text-blue-600 bg-blue-500/10" },
};

export default function DashboardLogs() {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  // Single server-side RPC — replaces 4 separate list() calls + client-side merge
  const { data: logData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["activity-log", filter, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("activity_log", {
        filter_type: filter,
        page_param: page,
        page_size_param: PAGE_SIZE,
      });
      if (error) throw error;
      return data || { rows: [], total: 0, totalPages: 1 };
    },
  });

  const logs = logData.rows || [];
  const totalLogs = logData.total || 0;
  const totalPages = logData.totalPages || 1;

  // Reset to page 1 when filter changes
  const onFilterChange = (newFilter) => {
    setFilter(newFilter);
    setPage(1);
  };

  return (
    <div>
      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { id: "all",     label: "الكل" },
          { id: "booking", label: "الحجوزات" },
          { id: "trip",    label: "الرحلات" },
          { id: "review",  label: "التقييمات" },
          { id: "user",    label: "المستخدمون" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              filter === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Log List */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">سجل النشاطات</h3>
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {totalLogs.toLocaleString("ar")}
          </span>
        </div>
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="p-10 text-center">
              <div className="w-6 h-6 border-3 border-muted border-t-primary rounded-full animate-spin mx-auto" />
            </div>
          ) : logs.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">لا توجد نشاطات</div>
          ) : logs.map((log, i) => {
            const cfg = typeConfig[log.type] || typeConfig.user;
            const Icon = cfg.icon;
            return (
              <div key={`${log.type}-${log.id}-${i}`} className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-relaxed">{log.text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(log.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${cfg.color}`}>{cfg.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}
