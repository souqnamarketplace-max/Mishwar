import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Search, ArrowLeft, Map, SlidersHorizontal, X, ArrowLeftRight } from "lucide-react";
import RouteMap from "@/components/shared/RouteMap";
import SelectDrawer from "@/components/ui/select-drawer";
import CityAutocomplete from "@/components/shared/CityAutocomplete";
import TripCard from "../components/shared/TripCard";
import { CITIES } from "@/lib/cities";

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

  const _updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value !== "" && value !== null && value !== undefined && !(key === "seats" && value === 1)) {
      next.set(key, String(value));
    } else {
      next.delete(key);
    }
    setSearchParamsW(next, { replace: true });
  };
  const setMaxPrice   = v => _updateFilter("price",  v);
  const setGenderPref = v => _updateFilter("gender", v);
  const setMinSeats   = v => _updateFilter("seats",  v);
  const setSortBy     = v => _updateFilter("sort",   v);

  const qc = useQueryClient();
  const { data: trips = [], isLoading, error } = useQuery({
    queryKey: ["trips"],
    queryFn: async () => {
      // Add a timeout safeguard — if Supabase client hangs, fail fast and show empty
      return Promise.race([
        base44.entities.Trip.list("-created_date", 200),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 8000)),
      ]);
    },
    retry: 1,
    staleTime: 30000,  // 30s — refresh in background, don't refetch on every mount
  });

  useEffect(() => {
    const unsubscribe = base44.entities.Trip.subscribe(() => {
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
    .filter((t) => t.status === "confirmed")
    .filter((t) => {
      if (activeFilters.from && t.from_city !== activeFilters.from) return false;
      if (activeFilters.to   && t.to_city   !== activeFilters.to)   return false;
      if (activeFilters.date && t.date       !== activeFilters.date) return false;
      if (maxPrice && t.price > parseFloat(maxPrice)) return false;
      if (genderPref && t.driver_gender !== genderPref) return false;
      if (t.available_seats < minSeats) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "price_asc")  return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      return new Date(a.date + " " + a.time) - new Date(b.date + " " + b.time);
    });

  const cityOptions = CITIES.map(c => ({ value: c, label: c }));
  const hasAdvancedFilters = maxPrice || genderPref || minSeats > 1 || sortBy !== "date";

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8" dir="rtl">
      {/* Search Bar */}
      <div className="bg-card rounded-2xl border border-border p-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          {/* From — type-to-search */}
          <div className="flex-1 bg-muted/50 rounded-xl border border-border">
            <CityAutocomplete value={from} onChange={setFrom} placeholder="من أين تنطلق؟" iconColor="primary" />
          </div>

          {/* Swap button */}
          <button onClick={handleSwap}
            className="self-center sm:self-end w-9 h-9 shrink-0 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors mb-0.5 hover:rotate-180 duration-300"
            aria-label="عكس الاتجاه" title="عكس الاتجاه">
            <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* To — type-to-search */}
          <div className="flex-1 bg-muted/50 rounded-xl border border-border">
            <CityAutocomplete value={to} onChange={setTo} placeholder="إلى أين؟" iconColor="accent" />
          </div>

          {/* Date */}
          <div className="flex-1 relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full h-11 pr-10 pl-4 rounded-xl bg-muted/50 border border-border text-sm" />
          </div>

          {/* Search */}
          <Button className="h-11 px-6 bg-primary text-primary-foreground rounded-xl gap-2 shrink-0" onClick={handleSearch}>
            <Search className="w-4 h-4" />
            بحث
          </Button>
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
            <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
              placeholder="مثال: 50" min="0"
              className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border text-sm" />
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
          {hasAdvancedFilters && (
            <div className="sm:col-span-3 flex justify-end">
              <button onClick={() => { setMaxPrice(""); setGenderPref(""); setMinSeats(1); setSortBy("date"); }}
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
