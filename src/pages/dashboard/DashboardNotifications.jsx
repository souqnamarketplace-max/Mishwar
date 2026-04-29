import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Bell, Send, Inbox } from "lucide-react";
import Pagination from "@/components/dashboard/Pagination";

const typeIcon = {
  booking_created:   "📅",
  booking_cancelled: "❌",
  trip_created:      "🚗",
  trip_completed:    "✅",
  trip_cancelled:    "🚫",
  review_received:   "⭐",
  license_approved:  "🪪",
  license_rejected:  "⚠️",
  system:            "📢",
};

export default function DashboardNotifications() {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  const { data: notifData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["admin-notifications", page],
    queryFn: () => base44.entities.Notification.paginate({
      page,
      pageSize: PAGE_SIZE,
      sort: "-created_date",
    }),
  });

  const notifications = notifData.rows;
  const total = notifData.total;
  const totalPages = notifData.totalPages;

  return (
    <div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">إشعارات النظام</h3>
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {total.toLocaleString("ar")}
          </span>
        </div>

        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="p-10 text-center">
              <div className="w-6 h-6 border-3 border-muted border-t-primary rounded-full animate-spin mx-auto" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-10 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">لا توجد إشعارات بعد</p>
            </div>
          ) : notifications.map((notif) => (
            <div key={notif.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-lg">
                {typeIcon[notif.type] || "🔔"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{notif.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-muted-foreground">{notif.user_email}</span>
                  <span className="text-[10px] text-muted-foreground">•</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(notif.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  {!notif.is_read && (
                    <span className="text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-bold">
                      غير مقروء
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!isLoading && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  );
}
