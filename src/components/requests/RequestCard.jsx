import React from "react";
import { Link } from "react-router-dom";
import { Calendar, Clock, Users, MapPin, Eye, MessageSquare, BadgeCheck } from "lucide-react";
import RequestStatusBadge from "./RequestStatusBadge";

/**
 * RequestCard — compact list item showing a single trip request.
 *
 * Reused across:
 *   - PassengerRequests (driver browse view) — `mode="driver"` shows
 *     contact button + view/contact stats
 *   - MyRequests (passenger view) — `mode="owner"` shows view/contact
 *     stats + edit/cancel actions
 *   - DashboardRequests (admin) — `mode="admin"` shows force-cancel +
 *     full passenger info
 *
 * Time flexibility is rendered as a friendly Arabic phrase rather than
 * the raw enum value.
 */
const FLEX_LABEL = {
  exact:     null,             // when set, requested_time itself is shown
  morning:   "صباحاً",
  afternoon: "بعد الظهر",
  evening:   "مساءً",
  flexible:  "أي وقت",
};

const PS_MONTHS = [
  "كانون الثاني","شباط","آذار","نيسان","أيار","حزيران",
  "تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول",
];

function fmtDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T12:00:00");
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(d); target.setHours(0,0,0,0);
    const diff = Math.round((target - today) / 86400000);
    if (diff === 0) return "اليوم";
    if (diff === 1) return "غداً";
    if (diff > 1 && diff < 7) return `بعد ${diff} أيام`;
    return `${d.getDate()} ${PS_MONTHS[d.getMonth()]}`;
  } catch { return dateStr; }
}

function fmtTime(req) {
  if (req.time_flexibility === "exact" && req.requested_time) {
    // requested_time is "HH:MM:SS"; trim seconds for display
    return req.requested_time.slice(0, 5);
  }
  return FLEX_LABEL[req.time_flexibility] || "أي وقت";
}

export default function RequestCard({ request, mode = "driver", onClick, action }) {
  if (!request) return null;

  return (
    <div
      onClick={onClick}
      className={`bg-card border border-border rounded-2xl p-4 ${onClick ? "cursor-pointer hover:border-primary/40 transition-colors" : ""}`}
      dir="rtl"
    >
      {/* Top row — route + status */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground text-base leading-tight truncate">
            {request.from_city} <span className="text-muted-foreground mx-1">←</span> {request.to_city}
          </p>
          {(mode !== "owner") && (
            <p className="text-xs text-muted-foreground mt-1 truncate flex items-center gap-1">
              {request.passenger_name}
              {request.is_verified
                ? <BadgeCheck className="w-3 h-3 text-primary shrink-0" title="راكب موثّق" />
                : <span className="text-[10px] text-muted-foreground/60">(غير موثّق)</span>
              }
            </p>
          )}
        </div>
        <RequestStatusBadge status={request.status} />
      </div>

      {/* Middle — date + time + seats + price */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{fmtDate(request.requested_date)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{fmtTime(request)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span>{request.seats_needed} {request.seats_needed === 1 ? "مقعد" : "مقاعد"}</span>
        </div>
        <div className="flex items-center justify-end gap-1 text-primary font-bold">
          <span className="text-lg leading-none">₪{request.suggested_price}</span>
          <span className="text-[10px] text-muted-foreground font-normal">مقترح</span>
        </div>
      </div>

      {/* Pickup/dropoff details — only if filled, kept short */}
      {(request.pickup_details || request.dropoff_details) && (
        <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
          {request.pickup_details && (
            <p className="flex items-start gap-1.5">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-green-600" />
              <span className="truncate">{request.pickup_details}</span>
            </p>
          )}
          {request.dropoff_details && (
            <p className="flex items-start gap-1.5">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-destructive" />
              <span className="truncate">{request.dropoff_details}</span>
            </p>
          )}
        </div>
      )}

      {/* Notes preview */}
      {request.notes && (
        <p className="text-xs text-foreground/80 bg-muted/40 rounded-lg p-2 mb-3 line-clamp-2">
          {request.notes}
        </p>
      )}

      {/* Owner-only stats footer */}
      {mode === "owner" && request.status === "open" && (
        <div className="flex items-center gap-3 pt-2 border-t border-border/60 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3" />
            {request.view_count || 0} مشاهدة
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {request.contact_count || 0} تواصل
          </span>
        </div>
      )}

      {/* Inline action area */}
      {action}
    </div>
  );
}
