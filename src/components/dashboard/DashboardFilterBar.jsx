import React from "react";
import { Search, X } from "lucide-react";

/**
 * Consistent admin filter bar across all dashboard pages.
 *
 * All controls are optional — pass only what each page needs.
 * Designed to render in a single horizontal row that wraps on mobile.
 *
 * Props:
 *   searchValue / onSearch / searchPlaceholder
 *     Free-text search input. Submits on every keystroke (controlled).
 *     Page should debounce or use staleTime if needed.
 *
 *   selects: array of { key, value, onChange, options: [{ value, label }], placeholder }
 *     Each renders as a <select>. Arbitrary number, all in the same row.
 *
 *   dateRange: { value: "all" | "7d" | "30d" | "90d" | "custom", onChange, dateFrom, dateTo, onDateFromChange, onDateToChange }
 *     Preset range chips — "all / last 7 / 30 / 90 days / custom".
 *     When 'custom' is selected, two date inputs appear.
 *
 *   resultCount: number
 *     Total matching rows from the server (NOT current page count).
 *     Renders as "X نتيجة" — gives admin confidence the filter is working.
 */
export default function DashboardFilterBar({
  searchValue,
  onSearch,
  searchPlaceholder = "ابحث...",
  selects = [],
  dateRange,
  resultCount,
}) {
  const showSearch = typeof onSearch === "function";
  const showDateRange = !!dateRange;

  return (
    <div className="bg-card/60 border border-border rounded-2xl p-3 mb-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {showSearch && (
          <div className="relative flex-1 min-w-[180px] max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchValue ?? ""}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-muted/40 border border-border rounded-xl pr-10 pl-3 py-2 text-sm outline-none focus:border-primary"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => onSearch("")}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-muted rounded-md"
                aria-label="مسح البحث"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        {selects.map((s) => (
          <select
            key={s.key}
            value={s.value ?? ""}
            onChange={(e) => s.onChange(e.target.value)}
            className="h-10 px-3 rounded-xl bg-muted/40 border border-border text-sm outline-none focus:border-primary"
          >
            {s.placeholder && <option value="">{s.placeholder}</option>}
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ))}

        {showDateRange && (
          <div className="flex items-center gap-1 bg-muted/40 border border-border rounded-xl p-1">
            {[
              { value: "all", label: "الكل" },
              { value: "7d",  label: "7 أيام" },
              { value: "30d", label: "30 يوم" },
              { value: "90d", label: "90 يوم" },
              { value: "custom", label: "مخصص" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => dateRange.onChange(opt.value)}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  dateRange.value === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {typeof resultCount === "number" && (
          <span className="text-xs text-muted-foreground mr-auto">
            {resultCount.toLocaleString("ar-EG")} نتيجة
          </span>
        )}
      </div>

      {/* Custom date range inputs — visible only when custom is selected */}
      {showDateRange && dateRange.value === "custom" && (
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <span className="text-muted-foreground">من</span>
          <input
            type="date"
            value={dateRange.dateFrom ?? ""}
            onChange={(e) => dateRange.onDateFromChange(e.target.value)}
            className="h-9 px-2 rounded-lg bg-muted/40 border border-border outline-none focus:border-primary"
          />
          <span className="text-muted-foreground">إلى</span>
          <input
            type="date"
            value={dateRange.dateTo ?? ""}
            onChange={(e) => dateRange.onDateToChange(e.target.value)}
            className="h-9 px-2 rounded-lg bg-muted/40 border border-border outline-none focus:border-primary"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Translates a date-range preset into ISO bounds for the paginate API.
 * Returns { dateFrom, dateTo } where each is an ISO string or undefined.
 */
export function resolveDateRange(preset, customFrom, customTo) {
  if (!preset || preset === "all") return { dateFrom: undefined, dateTo: undefined };
  if (preset === "custom") {
    return {
      dateFrom: customFrom ? new Date(customFrom + "T00:00:00").toISOString() : undefined,
      dateTo:   customTo   ? new Date(customTo   + "T23:59:59").toISOString() : undefined,
    };
  }
  // 7d / 30d / 90d
  const days = parseInt(preset, 10);
  if (!Number.isFinite(days)) return { dateFrom: undefined, dateTo: undefined };
  const from = new Date(Date.now() - days * 86400_000);
  return { dateFrom: from.toISOString(), dateTo: undefined };
}
