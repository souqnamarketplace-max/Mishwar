import { useSEO } from "@/hooks/useSEO";
import DateInput from "@/components/shared/DateInput";
import React, { useState, useEffect, useMemo} from "react";
import { useSearchParams, Link } from "react-router-dom";
import { isTripExpired, isBookingClosed } from "@/lib/tripScheduling";
import { normalizeDigits } from "@/lib/validation";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Search, ArrowLeft, Map, SlidersHorizontal, X, ArrowLeftRight, UserCheck } from "lucide-react";
import RouteMap from "@/components/shared/RouteMap";
import SelectDrawer from "@/components/ui/select-drawer";
import CityAutocomplete from "@/components/shared/CityAutocomplete";
import TripCard from "../components/shared/TripCard";
import { CITIES, cityMatches } from "@/lib/cities";
import { useFavoriteDrivers } from "@/lib/favoriteDrivers";

import { useBlockedEmails, filterByBlocks } from "@/lib/blockUtils";
export default function SearchTrips() {
  useSEO({ title: "البحث عن رحلة", description: "ابحث عن رحلات بين المدن الفلسطينية واحجز مقعدك بسهولة" });

  const [searchParams] = useSearchParams();
  const [from, setFrom] = useState(searchParams.get("from") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [date, setDate] = useState(searchParams.get("date") || "");
  const [showMap, setShowMap] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
    date: searchParams.get("date") || "",
  });
  // Advanced filters
  // URL-persistent filters (shareable + survive refresh)
  const [_, setSearchParamsW] = useSearchParams();
  const maxPrice   = searchParams.get("price")  || "";
  const genderPref = searchParams.get("gender") || "";
  const minSeats   = parseInt(searchParams.get("seats") || "1", 10);
  const sortBy     = searchParams.get("sort")   || "date";
  // "Only favorite drivers" — URL-persistent so a passenger can bookmark
  // /search?favs=1 as their "trips from my trusted drivers" view. Hidden
  // when the user is logged out (no favorites possible) or has zero
  // favorites (the toggle would just hide all results — useless).
  const onlyFavorites = searchParams.get("favs") === "1";

  const _updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value !== "" && value !== null && value !== undefined && !(key === "seats" && value === 1)) {
      next.set(key, String(value));
    } else {
      next.delete(key);
    }
    setSearchParamsW(next, { replace: true });
  };
  const setMaxPrice      = v => _updateFilter("price",  v);
  const setGenderPref    = v => _updateFilter("gender", v);
  const setMinSeats      = v => _updateFilter("seats",  v);
  const setSortBy        = v => _updateFilter("sort",   v);
  const setOnlyFavorites = v => _updateFilter("favs",   v ? "1" : "");

  const qc = useQueryClient();
  const { data: trips_unfiltered = [], isLoading, error } = useQuery({
    queryKey: ["trips"],
    queryFn: async () => {
      // Fetch upcoming confirmed/in-progress trips. We select only the
      // columns SearchTrips + TripCard actually use (not SELECT *) to
      // halve payload size at scale — the full row has 30+ columns
      // including amenities JSONB, recurring_days JSONB, driver_note,
      // car_image, driver_avatar, etc. that this page doesn't render.
      // TripDetails fetches the full row when the user clicks through.
      //
      // Combined with the (date, status) index from migration 056, this
      // is the search hot-path's scaling improvement for the load-
      // readiness pass.
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("trips")
        .select([
          "id",
          "short_code",
          "from_city",
          "to_city",
          "date",
          "time",
          "price",
          "available_seats",
          "total_seats",
          "status",
          "driver_name",
          "driver_email",
          "driver_avatar",
          "driver_gender",
          "driver_rating",
          "driver_reviews_count",
          "stops",
          "is_direct",
          "has_checkpoint",
          "car_model",
          "car_color",
          "car_image",
          "distance",
          "payment_methods",
        ].join(","))
        .in("status", ["confirmed", "in_progress"])
        .gte("date", today)
        .order("date", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return data || [];
    },
    retry: 1,
    staleTime: 30000,  // 30s — refresh in background, don't refetch on every mount
  });

  const blockedSet = useBlockedEmails();
  const trips = useMemo(
    () => filterByBlocks(trips_unfiltered, blockedSet, "driver_email"),
    [trips_unfiltered, blockedSet]
  );
  // Favorite-driver filter set. Always queried (cheap, 5-min stale time)
  // but only USED when onlyFavorites is on. Loading state lets us hide
  // the toggle until favorites are known so the UI doesn't render a
  // toggle that would immediately empty the list.
  const { favoriteSet, count: favCount, isLoading: favLoading } = useFavoriteDrivers();


  useEffect(() => {
    const unsubscribe = api.entities.Trip.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    });
    return () => unsubscribe();
  }, [qc]);

  const handleSearch = () => setActiveFilters({ from, to, date });

  // Swap cities
  const handleSwap = () => {
    const tmp = from;
    setFrom(to);
    setTo(tmp);
  };

  // Filter + sort
  const filtered = trips
    // Note: query already restricts to ['confirmed','in_progress'] — no second status
    // filter here. Including in_progress keeps trips visible to search even after
    // the driver presses "start trip", which previously made them disappear.
    .filter((t) => !isTripExpired(t))
    // Note: isBookingClosed is enforced in TripDetails booking button, not hidden from search
    .filter((t) => {
      // Match trips where the from-city is direct OR is one of the stops
      const stopCities = Array.isArray(t.stops) ? t.stops.map(s => s?.city).filter(Boolean) : [];
      if (activeFilters.from) {
        const fromMatchesOrigin = cityMatches(t.from_city, activeFilters.from);
        const fromMatchesStop   = stopCities.some(s => cityMatches(s, activeFilters.from));
        if (!fromMatchesOrigin && !fromMatchesStop) return false;
      }
      if (activeFilters.to) {
        const toMatchesDest = cityMatches(t.to_city, activeFilters.to);
        const toMatchesStop = stopCities.some(s => cityMatches(s, activeFilters.to));
        if (!toMatchesDest && !toMatchesStop) return false;
      }
      // Smart direction check: find the first position that matches each city
      if (activeFilters.from && activeFilters.to) {
        const sequence = [t.from_city, ...stopCities, t.to_city];
        const fromIdx = sequence.findIndex(s => cityMatches(s, activeFilters.from));
        const toIdx   = sequence.findIndex(s => cityMatches(s, activeFilters.to));
        if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) return false;
      }
      if (activeFilters.date) {
        // Compare YYYY-MM-DD prefix so trips stored with a time component
        // (e.g. "2025-12-15T00:00:00") still match a date-only filter.
        const tripDate = String(t.date || "").slice(0, 10);
        const filterDate = String(activeFilters.date).slice(0, 10);
        if (tripDate !== filterDate) return false;
      }
      if (maxPrice && t.price > parseFloat(maxPrice)) return false;
      if (genderPref && t.driver_gender !== genderPref) return false;
      // "Only favorite drivers" filter — hides any trip whose driver_email
      // isn't in the favoriteSet. Applied last among the data-driven
      // filters because the Set lookup is O(1) and there's no point
      // doing it if the trip would already have been filtered out by
      // route/date/etc above. Empty favoriteSet (newcomer user) → no
      // trips match, intentional: the UI hides the toggle when count=0
      // so this shouldn't be reachable with empty set, but it's
      // defensive in case the cache races.
      if (onlyFavorites && !favoriteSet.has(t.driver_email)) return false;
      // Only filter by seats when the trip has an explicit numeric value.
      // Older trips may have null available_seats — treat those as "unknown,
      // don't hide" rather than silently excluding them from results.
      if (typeof t.available_seats === "number") {
        if (t.available_seats < minSeats) return false;
        if (t.available_seats <= 0) return false; // fully booked
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "price_asc")  return (a.price || 0) - (b.price || 0);
      if (sortBy === "price_desc") return (b.price || 0) - (a.price || 0);
      // Default: date ascending. Time can be null on legacy rows.
      // Without the '00:00' fallback, new Date('2025-12-15 null')
      // returns Invalid Date, Invalid - Invalid is NaN, and Array.sort
      // with a NaN comparator gives implementation-defined (read:
      // chaotic) ordering. Passengers see a jumbled trip list with
      // no apparent rhyme.
      const aTime = a.time || "00:00";
      const bTime = b.time || "00:00";
      return new Date(a.date + " " + aTime) - new Date(b.date + " " + bTime);
    });

  const cityOptions = CITIES.map(c => ({ value: c, label: c }));
  const hasAdvancedFilters = maxPrice || genderPref || minSeats > 1 || sortBy !== "date" || onlyFavorites;

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8" dir="rtl">
      {/* ── Search Card ── */}
      <div className="bg-card rounded-3xl shadow-lg border border-border/60 mb-6 overflow-hidden">

        {/* Route inputs */}
        <div className="relative" dir="rtl">
          {/* Vertical connector line */}
          <div className="absolute right-[3.25rem] top-[3.5rem] bottom-[1rem] w-px bg-gradient-to-b from-primary via-primary/40 to-accent hidden sm:block" style={{zIndex:0}} />

          {/* FROM */}
          <div className="relative flex items-center gap-3 px-4 pt-4 pb-2">
            <div className="w-9 h-9 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center shrink-0 z-10">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold text-primary mb-0.5 tracking-wider uppercase">من</p>
              <div className="bg-muted/40 rounded-2xl">
                <CityAutocomplete value={from} onChange={setFrom} placeholder="مدينة الانطلاق" iconColor="primary" />
              </div>
            </div>
          </div>

          {/* Swap + divider */}
          <div className="flex items-center px-4 py-1 gap-3">
            <button onClick={handleSwap}
              aria-label="عكس المسار — مبادلة من وإلى"
              className="w-9 h-9 rounded-full bg-primary/10 hover:bg-primary/20 border border-primary/30 flex items-center justify-center transition-all hover:rotate-180 duration-300 shrink-0 z-10">
              <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
            </button>
            <div className="flex-1 h-px bg-border/60" />
          </div>

          {/* TO */}
          <div className="relative flex items-center gap-3 px-4 pt-2 pb-4">
            <div className="w-9 h-9 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center shrink-0 z-10">
              <MapPin className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold text-accent mb-0.5 tracking-wider uppercase">إلى</p>
              <div className="bg-muted/40 rounded-2xl">
                <CityAutocomplete value={to} onChange={setTo} placeholder="مدينة الوصول" iconColor="accent" />
              </div>
            </div>
          </div>
        </div>

        {/* Date + Search row */}
        <div className="border-t border-border/60 flex items-stretch" dir="rtl">
          {/* Date */}
          <div className="flex-1 flex items-center gap-2.5 px-4 py-3">
            <div className="flex-1">
              <p className="text-[10px] font-bold text-muted-foreground mb-0.5 tracking-wider uppercase">التاريخ</p>
              <DateInput
                value={date}
                onChange={e => setDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                placeholder="اختر التاريخ"
                className="w-full"
              />
            </div>
          </div>

          {/* Search button */}
          <button
            onClick={handleSearch}
            className="bg-primary hover:bg-primary/90 active:scale-95 text-primary-foreground px-6 flex items-center gap-2 font-bold text-sm transition-all border-r border-primary/20"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">بحث</span>
          </button>
        </div>
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {isLoading ? "جاري البحث..." : `${filtered.length} رحلة متاحة`}
          </h2>
          {(activeFilters.from || activeFilters.to) && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {activeFilters.from && activeFilters.to
                ? `${activeFilters.from} ← ${activeFilters.to}`
                : activeFilters.from || activeFilters.to}
              {activeFilters.date && ` • ${activeFilters.date}`}
            </p>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Sort */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="h-9 px-3 rounded-lg bg-muted/50 border border-border text-sm">
            <option value="date">الأقرب موعداً</option>
            <option value="price_asc">الأرخص أولاً</option>
            <option value="price_desc">الأغلى أولاً</option>
          </select>

          {/* Filters toggle */}
          <Button variant={showFilters || hasAdvancedFilters ? "default" : "outline"}
            size="sm" className="rounded-lg gap-1.5"
            onClick={() => setShowFilters(v => !v)}>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            تصفية
            {hasAdvancedFilters && <span className="w-2 h-2 rounded-full bg-yellow-400" />}
          </Button>

          {/* Map toggle */}
          {activeFilters.from && activeFilters.to && (
            <Button variant={showMap ? "default" : "outline"} size="sm"
              className="rounded-lg gap-1.5" onClick={() => setShowMap(v => !v)}>
              <Map className="w-3.5 h-3.5" />
              {showMap ? "قائمة" : "خريطة"}
            </Button>
          )}
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="bg-card rounded-2xl border border-border p-4 mb-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">الحد الأقصى للسعر (₪)</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9٠-٩۰-۹]*"
              value={maxPrice}
              onChange={e => setMaxPrice(normalizeDigits(e.target.value).replace(/[^\d]/g, ""))}
              placeholder="مثال: 50"
              className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">تفضيل جنس السائق</label>
            <div className="flex gap-2">
              {[{ v: "", l: "الكل" }, { v: "male", l: "👨 رجل" }, { v: "female", l: "👩 امرأة" }].map(opt => (
                <button key={opt.v} onClick={() => setGenderPref(opt.v)}
                  className={`flex-1 h-10 rounded-xl text-sm font-medium border transition-all ${
                    genderPref === opt.v ? "bg-primary/10 border-primary text-primary" : "bg-muted/50 border-border text-muted-foreground"
                  }`}>
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">عدد المقاعد المطلوبة</label>
            <div className="flex items-center gap-3">
              <button onClick={() => setMinSeats(s => Math.max(1, s - 1))}
                className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center font-bold text-lg hover:bg-muted/80">−</button>
              <span className="font-bold text-lg w-8 text-center">{minSeats}</span>
              <button onClick={() => setMinSeats(s => Math.min(6, s + 1))}
                className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center font-bold text-lg hover:bg-muted/80">+</button>
            </div>
          </div>
          {/* Only favorite drivers — full-width toggle row spanning all 3 cols.
              Hidden when:
                - favLoading: don't render until we know the count, else
                  flicker on first paint
                - favCount === 0: useless — would empty all results.
                  We still show a hint when the user is logged in but
                  has zero favorites, pointing them to the heart icon
                  on trip cards.
              The control is a custom toggle switch (not a native
              checkbox) — native checkboxes render at OS-default size
              which is ~16px on iOS and inconsistent with the app's
              other custom controls, hard to tap on mobile. The label
              is the WHOLE row so the entire 60px-tall element is
              tappable, matching the chip/card affordances elsewhere. */}
          {!favLoading && favCount > 0 && (
            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={() => setOnlyFavorites(!onlyFavorites)}
                aria-pressed={onlyFavorites}
                aria-label="عرض الرحلات من السائقين المفضلين فقط"
                className={`w-full flex items-center justify-between gap-3 border rounded-xl px-4 py-3 transition-colors text-right ${
                  onlyFavorites
                    ? "bg-rose-500/5 border-rose-500/30 hover:bg-rose-500/10"
                    : "bg-muted/30 border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <UserCheck className={`w-5 h-5 ${onlyFavorites ? "text-rose-500" : "text-muted-foreground"}`} aria-hidden="true" />
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">السائقون المفضلون فقط</p>
                    <p className="text-[11px] text-muted-foreground">عرض الرحلات من السائقين الذين أضفتهم للمفضلة ({favCount})</p>
                  </div>
                </div>
                {/* Custom toggle switch — visually clearer than a
                    checkbox at mobile sizes. Knob slides between
                    two positions. 44px wide × 24px high overall;
                    container's full row height (60px+) is the
                    actual hit target. */}
                <span
                  className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors shrink-0 ${
                    onlyFavorites ? "bg-rose-500" : "bg-muted-foreground/30"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                      onlyFavorites ? "translate-x-0.5" : "translate-x-[1.375rem]"
                    }`}
                  />
                </span>
              </button>
            </div>
          )}
          {hasAdvancedFilters && (
            <div className="sm:col-span-3 flex justify-end">
              <button onClick={() => { setMaxPrice(""); setGenderPref(""); setMinSeats(1); setSortBy("date"); setOnlyFavorites(false); }}
                className="text-sm text-destructive hover:underline flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> مسح الفلاتر
              </button>
            </div>
          )}
        </div>
      )}

      {/* Route Map */}
      {showMap && activeFilters.from && activeFilters.to && (
        <div className="mb-6">
          <RouteMap fromCity={activeFilters.from} toCity={activeFilters.to} height="260px" showStats={true} className="shadow-sm" />
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-card rounded-2xl border border-border p-6 animate-pulse">
              <div className="h-5 bg-muted rounded w-48 mb-3" />
              <div className="h-4 bg-muted rounded w-32 mb-3" />
              <div className="h-10 bg-muted rounded w-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        // Surface query failures explicitly. Without this branch the
        // page silently rendered the empty state when the network was
        // down or RLS denied — users thought they'd entered bad search
        // criteria and would loop on changing filters instead of
        // retrying. The retry button refetches via react-query.
        <div className="text-center py-20">
          <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-destructive/60" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">تعذّر تحميل الرحلات</h3>
          <p className="text-muted-foreground text-sm mb-4">يبدو أن هناك مشكلة في الاتصال. جرّب مرة أخرى.</p>
          <Button onClick={() => qc.invalidateQueries({ queryKey: ["trips"] })} className="rounded-xl">
            إعادة المحاولة
          </Button>
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map(trip => <TripCard key={trip.id} trip={trip} />)}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات بهذه المعايير</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {activeFilters.from && activeFilters.to
              ? `لا توجد رحلات من ${activeFilters.from} إلى ${activeFilters.to} حالياً`
              : "جرّب البحث بمدينة أو تاريخ مختلف"}
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            {/* Trip-request CTA — when the user gave us a specific route
                and got nothing, the highest-value next action is to post
                a request so drivers heading that way can find them. The
                trip-request feature is the headline new addition; hiding
                it on this surface left users with only a soft-fallback
                "browse all" button that mostly produces the same empty
                state on a low-traffic platform. Pre-fills from/to/date
                so the user doesn't re-type what they just typed above. */}
            {activeFilters.from && activeFilters.to && (
              <Link
                to={`/request-trip?from=${encodeURIComponent(activeFilters.from)}&to=${encodeURIComponent(activeFilters.to)}${activeFilters.date ? `&date=${encodeURIComponent(activeFilters.date)}` : ""}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-bold"
              >
                اطلب رحلتك على هذا المسار
              </Link>
            )}
            <button onClick={() => { setFrom(""); setTo(""); setDate(""); handleSearch(); }}
              className="text-sm text-primary hover:underline">
              عرض كل الرحلات المتاحة
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
