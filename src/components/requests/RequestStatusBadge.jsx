import React from "react";

/**
 * RequestStatusBadge — colored pill showing trip-request status.
 *
 * Reused across:
 *   - RequestCard (passenger + driver views)
 *   - DashboardRequests (admin moderation list)
 *   - RequestDetail page header
 */
const STATUS_MAP = {
  open:      { label: "مفتوح",   bg: "bg-green-500/10",       text: "text-green-700 dark:text-green-400" },
  matched:   { label: "تم الربط", bg: "bg-blue-500/10",        text: "text-blue-700 dark:text-blue-400" },
  cancelled: { label: "ملغى",     bg: "bg-muted",              text: "text-muted-foreground" },
  expired:   { label: "منتهي",    bg: "bg-amber-500/10",       text: "text-amber-700 dark:text-amber-400" },
};

export default function RequestStatusBadge({ status, className = "" }) {
  const s = STATUS_MAP[status] || STATUS_MAP.open;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${s.bg} ${s.text} ${className}`}>
      {s.label}
    </span>
  );
}
