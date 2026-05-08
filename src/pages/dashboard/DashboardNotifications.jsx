import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Bell, Send, Inbox } from "lucide-react";
import Pagination from "@/components/dashboard/Pagination";
import DashboardFilterBar, { resolveDateRange } from "@/components/dashboard/DashboardFilterBar";

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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const PAGE_SIZE = 30;

  const setSearchAndReset     = (v) => { setSearch(v); setPage(1); };
  const setTypeAndReset       = (v) => { setTypeFilter(v); setPage(1); };
  const setDateRangeAndReset  = (v) => { setDateRangePreset(v); setPage(1); };
  const setCustomFromAndReset = (v) => { setCustomFrom(v); setPage(1); };
  const setCustomToAndReset   = (v) => { setCustomTo(v); setPage(1); };

  const { dateFrom, dateTo } = resolveDateRange(dateRangePreset, customFrom, customTo);

  const { data: notifData = { rows: [], total: 0, totalPages: 1 }, isLoading } = useQuery({
    queryKey: ["admin-notifications", page, search, typeFilter, dateRangePreset, customFrom, customTo],
    queryFn: () => base44.entities.Notification.paginate({
      page,
      pageSize: PAGE_SIZE,
      sort: "-created_date",
      conditions: typeFilter ? { type: typeFilter } : undefined,
      searchTerm: search,
      // Search across the notification's recipient + body so admin can find
      // "all notifications sent to user X" or "all license_rejected with
      // word 'expired' in the message".
      searchColumns: ["user_email", "title", "message"],
      dateColumn: "created_at",
      dateFrom,
      dateTo,
    }),
  });

  const notifications = notifData.rows;
  const total = notifData.total;
  const totalPages = notifData.totalPages;

  return (
    <div>
      <DashboardFilterBar
        searchValue={search}
        onSearch={setSearchAndReset}
        searchPlaceholder="ابحث في الإيميل أو نص الإشعار..."
        selects={[
          {
            key: "type",
            value: typeFilter,
            onChange: setTypeAndReset,
            placeholder: "كل الأنواع",
            options: [
              { value: "booking_created",   label: "حجز جديد" },
              { value: "booking_cancelled", label: "إلغاء حجز" },
              { value: "trip_created",      label: "رحلة جديدة" },
              { value: "trip_completed",    label: "رحلة مكتملة" },
              { value: "trip_cancelled",    label: "إلغاء رحلة" },
              { value: "review_received",   label: "تقييم جديد" },
              { value: "license_approved",  label: "موافقة رخصة" },
              { value: "license_rejected",  label: "رفض رخصة" },
              { value: "system",            label: "إشعار نظام" },
            ],
          },
        ]}
        dateRange={{
          value: dateRangePreset,
          onChange: setDateRangeAndReset,
          dateFrom: customFrom,
          dateTo: customTo,
          onDateFromChange: setCustomFromAndReset,
          onDateToChange: setCustomToAndReset,
        }}
        resultCount={total}
      />

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">إشعارات النظام</h3>
          <span className="mr-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {total.toLocaleString("ar-EG")}
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
