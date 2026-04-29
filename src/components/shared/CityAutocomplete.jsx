import React, { useState, useRef, useEffect } from "react";
import { MapPin, X, Clock, TrendingUp, Map as MapIcon, Search } from "lucide-react";
import { CITIES } from "@/lib/cities";
import { cn } from "@/lib/utils";
import MapCityPicker from "@/components/shared/MapCityPicker";

const POPULAR = ["رام الله", "نابلس", "الخليل", "بيت لحم", "جنين", "طولكرم", "قلقيلية", "أريحا"];
const RECENT_KEY = "mishwar:recent-cities";

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 4); }
  catch { return []; }
}
function saveRecent(city) {
  if (!city) return;
  try {
    const current = getRecent().filter(c => c !== city);
    const next = [city, ...current].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

/**
 * Type-to-search city input with autocomplete + map picker button.
 * @param {string}  value
 * @param {func}    onChange    (city: string) => void
 * @param {string}  placeholder
 * @param {string}  iconColor   "primary" | "accent"
 * @param {boolean} showMapButton  show the map-pin button to open a map picker
 */
export default function CityAutocomplete({
  value,
  onChange,
  placeholder = "اكتب اسم المدينة، البلدة أو القرية",
  iconColor = "primary",
  showMapButton = true,
}) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mapOpen, setMapOpen] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => { setQuery(value || ""); }, [value]);

  const filtered = query.trim()
    ? CITIES.filter(c => c.includes(query.trim()))
    : [];

  const recent = getRecent();
  const popular = POPULAR.filter(c => CITIES.includes(c));

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!wrapperRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (city) => {
    setQuery(city);
    onChange(city);
    saveRecent(city);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e) => {
    const list = filtered.length ? filtered : [...recent, ...popular];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, list.length - 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && list[activeIndex]) {
        handleSelect(list[activeIndex]);
      } else if (filtered[0]) {
        handleSelect(filtered[0]);
      } else if (CITIES.includes(query.trim())) {
        handleSelect(query.trim());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setActiveIndex(-1);
    setOpen(true);
  };

  const handleClear = () => {
    setQuery("");
    onChange("");
    inputRef.current?.focus();
  };

  const handleMapPick = (city) => {
    if (city) handleSelect(city);
    setMapOpen(false);
  };

  const iconCls = iconColor === "accent" ? "text-accent" : "text-primary";

  return (
    <>
      <div ref={wrapperRef} className="relative w-full" dir="rtl">
        {/* Input row */}
        <div className="relative flex items-center">
          {/* Pin icon (right side in RTL) */}
          <MapPin className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${iconCls} pointer-events-none z-10`} />

          {/* Search icon hint when empty (subtle visual cue that it's typeable) */}
          {!query && !open && (
            <Search className="absolute right-9 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40 pointer-events-none z-10" />
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "w-full h-12 rounded-xl bg-transparent border-0 text-sm text-foreground",
              "placeholder:text-muted-foreground focus:outline-none caret-primary",
              query ? "pr-10" : "pr-14",  // extra right-padding when search hint icon visible
              showMapButton ? "pl-20" : "pl-9",  // leave room for clear + map button on the left
            )}
          />

          {/* Clear button */}
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute left-12 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-muted flex items-center justify-center"
              aria-label="مسح"
              title="مسح"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}

          {/* Map button (always visible when enabled) */}
          {showMapButton && (
            <button
              type="button"
              onClick={() => { setOpen(false); setMapOpen(true); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-8 px-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary flex items-center gap-1 text-xs font-medium transition-colors"
              aria-label="اختر من الخريطة"
              title="اختر من الخريطة"
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">خريطة</span>
            </button>
          )}
        </div>

        {/* Dropdown */}
        {open && (
          <div
            ref={dropdownRef}
            className="absolute top-full right-0 left-0 mt-1 bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-[200] max-h-80 overflow-y-auto"
          >
            {/* When user has typed: show search matches */}
            {query.trim() && (
              <>
                {filtered.length > 0 ? (
                  filtered.map((city, i) => (
                    <button
                      key={city}
                      type="button"
                      onClick={() => handleSelect(city)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn(
                        "w-full text-right px-4 py-3 flex items-center gap-2.5 border-b border-border/30 transition-colors",
                        activeIndex === i ? "bg-muted" : "hover:bg-muted/50"
                      )}
                    >
                      <MapPin className={`w-4 h-4 ${iconCls} shrink-0`} />
                      <HighlightMatch text={city} query={query.trim()} />
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    لا توجد نتائج لـ "{query}"
                    <p className="text-xs mt-1">جرب اسم مدينة، بلدة أو قرية أخرى</p>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); setMapOpen(true); }}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-medium hover:bg-primary/20"
                    >
                      <MapIcon className="w-3.5 h-3.5" />
                      اختر من الخريطة
                    </button>
                  </div>
                )}
              </>
            )}

            {/* When empty: show recent + popular + map prompt */}
            {!query.trim() && (
              <>
                {recent.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-muted/30 flex items-center gap-2 text-xs font-bold text-muted-foreground sticky top-0">
                      <Clock className="w-3 h-3" />
                      البحث الأخير
                    </div>
                    {recent.map((city, i) => (
                      <button
                        key={"r-" + city}
                        type="button"
                        onClick={() => handleSelect(city)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={cn(
                          "w-full text-right px-4 py-3 flex items-center gap-2.5 border-b border-border/30 transition-colors",
                          activeIndex === i ? "bg-muted" : "hover:bg-muted/50"
                        )}
                      >
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm">{city}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <div className="px-4 py-2 bg-muted/30 flex items-center gap-2 text-xs font-bold text-muted-foreground sticky top-0">
                    <TrendingUp className="w-3 h-3" />
                    المدن الأكثر شعبية
                  </div>
                  {popular.map((city, i) => {
                    const idx = recent.length + i;
                    return (
                      <button
                        key={"p-" + city}
                        type="button"
                        onClick={() => handleSelect(city)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={cn(
                          "w-full text-right px-4 py-3 flex items-center gap-2.5 border-b border-border/30 transition-colors",
                          activeIndex === idx ? "bg-muted" : "hover:bg-muted/50"
                        )}
                      >
                        <MapPin className={`w-4 h-4 ${iconCls} shrink-0`} />
                        <span className="text-sm">{city}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Footer with two CTAs */}
                <div className="grid grid-cols-2 divide-x divide-border/40 rtl:divide-x-reverse bg-muted/20">
                  <div className="px-3 py-2.5 text-center text-[11px] text-muted-foreground">
                    {CITIES.length}+ مدينة وقرية
                  </div>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setMapOpen(true); }}
                    className="px-3 py-2.5 text-center text-[11px] font-bold text-primary hover:bg-primary/10 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    اختر من الخريطة
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Map picker modal */}
      {mapOpen && (
        <MapCityPicker
          value={value}
          onChange={handleMapPick}
          onClose={() => setMapOpen(false)}
          forceOpen={true}
        />
      )}
    </>
  );
}

function HighlightMatch({ text, query }) {
  const idx = text.indexOf(query);
  if (idx === -1) return <span className="text-sm">{text}</span>;
  return (
    <span className="text-sm">
      {text.slice(0, idx)}
      <mark className="bg-yellow-200/60 text-foreground font-bold px-0.5 rounded">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </span>
  );
}
