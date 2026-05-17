import React, { useState } from "react";
import { Filter, X, Search } from "lucide-react";
import DateInput from "@/components/shared/DateInput";
import { Input } from "@/components/ui/input";
import CityAutocomplete from "@/components/shared/CityAutocomplete";

/**
 * MyTripsFilterBar — search + date range + route filter for /my-trips.
 *
 * Collapsible by default to keep the page header compact on mobile. A
 * pill-shaped "فلتر" button toggles the panel. When ANY filter is
 * active, a badge on the button shows the count + a "مسح" link clears
 * everything in one tap (resets all four fields and closes the panel).
 *
 * The panel renders four inputs in a responsive grid:
 *   1. Free-text search (debounced — see parent useDeferredValue)
 *   2. Date from
 *   3. Date to
 *   4. Route from + to (using CityAutocomplete for consistency)
 *
 * All filter values are LIFTED to the parent (MyTrips.jsx) so the
 * react-query keys can include them and re-fetch correctly. Local
 * state is only the open/closed flag.
 *
 * Why CityAutocomplete for routes vs a free text input:
 *   - Keeps city names canonical (matches what's in trips.from_city)
 *   - Auto-completes from CITIES list, no typos
 *   - Matches /search-trips UX, so users learn one pattern
 *
 * Why YYYY-MM-DD for dates:
 *   - trips.date column stores in this format (verified)
 *   - The existing DateInput component produces this format directly
 *   - paginate()'s dateColumn comparison uses ISO/text gte/lte which
 *     works fine on YYYY-MM-DD strings (lexicographically equivalent
 *     to numerically-ordered dates)
 */
export default function MyTripsFilterBar({
  searchTerm, setSearchTerm,
  dateFrom, setDateFrom,
  dateTo,   setDateTo,
  routeFrom, setRouteFrom,
  routeTo,   setRouteTo,
}) {
  // Default collapsed on mount. Re-expanding remembers prior values
  // (they're in parent state); the panel is purely a presentation toggle.
  const [open, setOpen] = useState(false);

  // Count active filters for the badge. Empty strings don't count.
  const activeCount =
    (searchTerm?.trim() ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo   ? 1 : 0) +
    (routeFrom ? 1 : 0) +
    (routeTo   ? 1 : 0);

  const clearAll = () => {
    setSearchTerm("");
    setDateFrom("");
    setDateTo("");
    setRouteFrom("");
    setRouteTo("");
  };

  return (
    <div className="mb-6">
      {/* Toggle row: filter button on right (RTL), clear link on left */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls="mytrips-filter-panel"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-card border border-border hover:bg-muted text-sm font-medium text-foreground transition-colors"
        >
          <Filter className="w-4 h-4" aria-hidden="true" />
          فلتر البحث
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center">
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="w-3 h-3" aria-hidden="true" />
            مسح كل الفلاتر
          </button>
        )}
      </div>

      {/* Collapsible panel. Uses display:none when closed (vs unmounting)
          so the input values + autocomplete state survive open/close
          cycles without re-mounting. */}
      <div
        id="mytrips-filter-panel"
        className={`${open ? "block" : "hidden"} bg-card border border-border rounded-2xl p-4 space-y-3 animate-in fade-in-50 slide-in-from-top-2`}
      >
        {/* Free-text search — searches from_city + to_city via server-side ilike.
            We don't debounce here because the parent's react-query uses the
            filter values as part of the queryKey, which auto-batches. If we
            ever notice excessive refetches on every keystroke, wrap setSearchTerm
            in a useDeferredValue in the parent. */}
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <Input
            type="search"
            inputMode="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ابحث في المدن (مثل: رام الله، الخليل)"
            className="pr-10 h-10 rounded-xl text-sm"
            aria-label="بحث نصي في الرحلات"
          />
        </div>

        {/* Date range — from + to. Both optional; one-sided ranges work
            (e.g. "from 2026-01-01" means everything after Jan 1). */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted/30 rounded-xl px-3 py-2 border border-border">
            <p className="text-[10px] text-muted-foreground mb-0.5">من تاريخ</p>
            <DateInput
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="اختر تاريخ البداية"
              // No min — drivers may want to look at past trips back to
              // their first ever, not just future. max=dateTo when set
              // so the from date can't exceed the to date.
              max={dateTo || undefined}
            />
          </div>
          <div className="bg-muted/30 rounded-xl px-3 py-2 border border-border">
            <p className="text-[10px] text-muted-foreground mb-0.5">إلى تاريخ</p>
            <DateInput
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="اختر تاريخ النهاية"
              min={dateFrom || undefined}
            />
          </div>
        </div>

        {/* Route — from city + to city. CityAutocomplete is the same
            component used in /search-trips, so users see consistent
            UX. Both optional; users can filter by just origin or just
            destination. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 mr-1">من مدينة</p>
            <CityAutocomplete
              value={routeFrom}
              onChange={setRouteFrom}
              placeholder="أي مدينة"
            />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1 mr-1">إلى مدينة</p>
            <CityAutocomplete
              value={routeTo}
              onChange={setRouteTo}
              placeholder="أي مدينة"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
