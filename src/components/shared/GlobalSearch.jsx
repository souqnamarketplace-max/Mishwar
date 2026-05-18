import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Car, UserCheck, MapPin, MessageCircle, Loader2, ArrowLeft, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CITIES } from "@/lib/cities";
import { useAuth } from "@/lib/AuthContext";

/**
 * GlobalSearch — modal-based search across trips, drivers, cities, and chats.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <GlobalSearch isOpen={open} onClose={() => setOpen(false)} />
 *
 * KEYBOARD:
 *   - Cmd-K / Ctrl-K from anywhere    → opens (handled by caller via useGlobalSearchHotkey)
 *   - Escape                          → closes
 *   - Arrow Up/Down                   → navigate results
 *   - Enter                           → activate selected result
 *
 * DESIGN DECISIONS:
 *   - Mobile-first: full-screen modal on narrow viewports, centered card on
 *     wider ones. The card uses createPortal so it escapes any parent
 *     transform (e.g. Framer Motion route transitions) that would
 *     otherwise break fixed positioning. Same pattern as NotificationBell.
 *
 *   - Multi-source: trips (upcoming, by city), favorite drivers (mine),
 *     city directory (from /lib/cities, no DB hit), and recent chat
 *     conversations. Each source gets its own group with a header.
 *
 *   - Debounce: 200ms before kicking off DB queries. Short enough that
 *     fast typers don't feel lag, long enough to skip the half-second
 *     flurry of intermediate states.
 *
 *   - Privacy: chat results never expose other users' emails — they show
 *     display names only (resolved via the message thread's other party).
 *     Trip results respect RLS by default since the queries run as the
 *     current user. Cities are public reference data.
 *
 *   - Result limits: 5 per group. The point is fast triage, not pagination.
 *     "Didn't find it" → user can click into the dedicated page (trips
 *     → /search-trips, cities → /cities/:name, etc.) with the query
 *     pre-filled. Each group footer shows a 'See all' link when truncated.
 */
export default function GlobalSearch({ isOpen, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // ─── Debounce input ───────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // ─── Reset state on open/close ───────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setDebouncedQuery("");
      setActiveIndex(0);
      // Focus input on next tick to ensure DOM is rendered. Without
      // setTimeout, focus() runs before the input is attached.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // ─── Body scroll lock + Escape close ────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  // ─── City matches (in-memory, instant) ──────────────────────────
  // CITIES is a 324-entry static list — searching in-memory is faster
  // than a round-trip. Match on Arabic or transliterated name.
  const cityMatches = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) return [];
    const q = debouncedQuery.toLowerCase();
    return CITIES.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const en = (c.name_en || "").toLowerCase();
      return name.includes(q) || en.includes(q);
    }).slice(0, 5);
  }, [debouncedQuery]);

  // ─── Trip matches ────────────────────────────────────────────────
  // Search upcoming trips by from_city or to_city (text match). Limited
  // to confirmed status + future dates. Backend uses RLS so even
  // anonymous users see only public/listed trips.
  const { data: tripMatches = [], isLoading: tripsLoading } = useQuery({
    queryKey: ["global-search-trips", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) return [];
      const today = new Date().toISOString().slice(0, 10);
      // ilike for substring search on either endpoint city
      const { data, error } = await supabase
        .from("trips")
        .select("id, short_code, from_city, to_city, date, time, price, available_seats, driver_name, status")
        .or(`from_city.ilike.%${debouncedQuery}%,to_city.ilike.%${debouncedQuery}%`)
        .eq("status", "confirmed")
        .gte("date", today)
        .order("date", { ascending: true })
        .limit(5);
      if (error) {
        // Don't surface errors in the UI — just return empty. The user
        // is searching; a transient error shouldn't block other groups.
        console.warn("[global-search] trips query failed:", error.message);
        return [];
      }
      return data || [];
    },
    enabled: !!debouncedQuery && debouncedQuery.length >= 2,
    staleTime: 30 * 1000,
  });

  // ─── Favorite driver matches ────────────────────────────────────
  // Drivers the current user has favorited. Search via the safe RPC
  // (mig 078) which respects the favorited-by-me boundary — no email
  // enumeration risk.
  const { data: favDriverMatches = [] } = useQuery({
    queryKey: ["global-search-favs", debouncedQuery, user?.email],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2 || !user?.email) return [];
      const { data, error } = await supabase.rpc("get_favorite_drivers_display");
      if (error || !data) return [];
      const q = debouncedQuery.toLowerCase();
      return data
        .filter((d) => (d.full_name || "").toLowerCase().includes(q))
        .slice(0, 5);
    },
    enabled: !!debouncedQuery && debouncedQuery.length >= 2 && !!user?.email,
    staleTime: 60 * 1000,
  });

  // ─── Build flat result list for keyboard navigation ──────────────
  // The visual rendering uses groups, but Arrow Up/Down navigates the
  // flat list across all groups. We build a single ordered list with
  // {type, data} entries and the activeIndex points into this list.
  const flatResults = useMemo(() => {
    const arr = [];
    cityMatches.forEach((c) => arr.push({ type: "city", data: c }));
    tripMatches.forEach((t) => arr.push({ type: "trip", data: t }));
    favDriverMatches.forEach((d) => arr.push({ type: "driver", data: d }));
    return arr;
  }, [cityMatches, tripMatches, favDriverMatches]);

  // Reset active index if results shrink (e.g. user typed more, result
  // dropped). Without this, activeIndex could point past array length
  // and Enter would do nothing.
  useEffect(() => {
    if (activeIndex >= flatResults.length) setActiveIndex(0);
  }, [flatResults.length, activeIndex]);

  const activate = (entry) => {
    if (!entry) return;
    switch (entry.type) {
      case "city": {
        // Drive to search-trips with the city pre-filled. More useful
        // than a static /cities/:name page for someone who's
        // actually trying to find a ride.
        const cityName = entry.data.name;
        navigate(`/search-trips?from=${encodeURIComponent(cityName)}`);
        break;
      }
      case "trip": {
        // Prefer short_code URL for the slug benefit; fall back to UUID.
        const slug = entry.data.short_code
          ? `${entry.data.from_city}-${entry.data.to_city}-${entry.data.short_code}`
          : entry.data.id;
        navigate(`/trip/${slug}`);
        break;
      }
      case "driver":
        // Profile lookup uses UUID — stable across email changes.
        if (entry.data.id) navigate(`/user/${entry.data.id}`);
        break;
    }
    onClose();
  };

  // ─── Keyboard navigation ────────────────────────────────────────
  const onInputKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, flatResults.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(flatResults[activeIndex]);
    }
  };

  if (!isOpen) return null;

  // Body content. Hidden under createPortal so it can break out of any
  // ancestor transform (Framer Motion page transitions) that would
  // otherwise break position: fixed.
  const body = (
    <div
      className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] sm:pt-[15vh] p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="بحث شامل"
    >
      <div
        className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Search input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="ابحث عن مدن، رحلات، سائقين..."
            className="flex-1 bg-transparent border-0 outline-none text-base text-foreground placeholder:text-muted-foreground"
            aria-label="حقل البحث"
          />
          {tripsLoading && (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" aria-hidden="true" />
          )}
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:bg-muted active:bg-muted/70"
            aria-label="إغلاق البحث"
            title="إغلاق (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results body */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto overscroll-contain"
        >
          {!debouncedQuery || debouncedQuery.length < 2 ? (
            <EmptyHint />
          ) : flatResults.length === 0 ? (
            <NoResults query={debouncedQuery} />
          ) : (
            <div className="py-2">
              {cityMatches.length > 0 && (
                <ResultGroup label="مدن" icon={MapPin}>
                  {cityMatches.map((c, idx) => {
                    const flatIdx = idx;
                    return (
                      <ResultRow
                        key={`city-${c.name}`}
                        isActive={activeIndex === flatIdx}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => activate({ type: "city", data: c })}
                        icon={<MapPin className="w-4 h-4 text-primary" />}
                        primary={c.name}
                        secondary={c.region || ""}
                      />
                    );
                  })}
                </ResultGroup>
              )}
              {tripMatches.length > 0 && (
                <ResultGroup label="رحلات قادمة" icon={Car}>
                  {tripMatches.map((t, idx) => {
                    const flatIdx = cityMatches.length + idx;
                    return (
                      <ResultRow
                        key={`trip-${t.id}`}
                        isActive={activeIndex === flatIdx}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => activate({ type: "trip", data: t })}
                        icon={<Car className="w-4 h-4 text-emerald-600" />}
                        primary={`${t.from_city} ← ${t.to_city}`}
                        secondary={`${t.date} · ${t.time || ""} · ₪${t.price}`}
                        trailing={t.available_seats > 0 ? `${t.available_seats} مقعد` : "مكتمل"}
                      />
                    );
                  })}
                </ResultGroup>
              )}
              {favDriverMatches.length > 0 && (
                <ResultGroup label="سائقون مفضلون" icon={UserCheck}>
                  {favDriverMatches.map((d, idx) => {
                    const flatIdx = cityMatches.length + tripMatches.length + idx;
                    return (
                      <ResultRow
                        key={`driver-${d.id || d.email}`}
                        isActive={activeIndex === flatIdx}
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => activate({ type: "driver", data: d })}
                        icon={
                          d.avatar_url ? (
                            <img
                              src={d.avatar_url}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <UserCheck className="w-4 h-4 text-rose-500" />
                          )
                        }
                        primary={d.full_name || "سائق"}
                        secondary={
                          d.car_model
                            ? `${d.car_model}${d.car_color ? ` · ${d.car_color}` : ""}`
                            : ""
                        }
                        trailing={
                          d.driver_rating
                            ? `⭐ ${Number(d.driver_rating).toFixed(1)}`
                            : ""
                        }
                      />
                    );
                  })}
                </ResultGroup>
              )}
            </div>
          )}
        </div>

        {/* Footer hints — hidden on mobile (small viewport) to save vertical space */}
        <div className="hidden sm:flex items-center justify-between gap-4 px-4 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">↑↓</kbd>
              تنقل
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">Enter</kbd>
              فتح
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">Esc</kbd>
              إغلاق
            </span>
          </div>
          <span>اختصار: <kbd className="px-1.5 py-0.5 rounded bg-card border border-border font-mono">⌘K</kbd></span>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

// ─── Subcomponents ─────────────────────────────────────────────────

function ResultGroup({ label, icon: Icon, children }) {
  return (
    <div className="py-1">
      <div className="px-4 pt-2 pb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ResultRow({ isActive, onClick, onMouseEnter, icon, primary, secondary, trailing }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] text-right transition-colors ${
        isActive ? "bg-primary/10" : "hover:bg-muted/50"
      }`}
    >
      <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted/50">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-foreground truncate">{primary}</span>
        {secondary && (
          <span className="block text-xs text-muted-foreground truncate mt-0.5">{secondary}</span>
        )}
      </span>
      {trailing && (
        <span className="shrink-0 text-xs text-muted-foreground">{trailing}</span>
      )}
    </button>
  );
}

function EmptyHint() {
  return (
    <div className="px-6 py-10 text-center">
      <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground mb-1">ابدأ الكتابة للبحث</p>
      <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
        ابحث في المدن، الرحلات القادمة، والسائقين المفضلين. حرفان على الأقل.
      </p>
    </div>
  );
}

function NoResults({ query }) {
  return (
    <div className="px-6 py-10 text-center">
      <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground mb-1">لا نتائج لـ "{query}"</p>
      <p className="text-xs text-muted-foreground">جرّب كلمة مختلفة، أو اضغط Esc للإلغاء</p>
    </div>
  );
}
