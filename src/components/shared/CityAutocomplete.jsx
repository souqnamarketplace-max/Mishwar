/**
 * CityAutocomplete — smart Arabic city search with fuzzy matching.
 * Includes "add your own town/village" fallback when no result found.
 */
import React, { useState, useRef, useEffect } from "react";
import { CITIES, normalizeArabic } from "@/lib/cities";
import { MapPin, Search, Plus, X, Map } from "lucide-react";
import CityMapPicker from "@/components/shared/CityMapPicker";

export default function CityAutocomplete({
  value = "",
  onChange,
  placeholder = "ابحث عن مدينة أو قرية...",
  className = "",
  id,
}) {
  const [query,    setQuery]    = useState(value);
  const [open,     setOpen]     = useState(false);
  const [focused,  setFocused]  = useState(false);
  const [customMode, setCustomMode] = useState(false); // user is typing a custom locality
  const [showMapPicker, setShowMapPicker] = useState(false);
  const inputRef  = useRef(null);
  const containerRef = useRef(null);

  // Sync external value → input
  useEffect(() => {
    if (value !== query && !focused) setQuery(value || "");
  }, [value, focused]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filter cities using normalised Arabic matching
  const filtered = query.trim().length >= 1
    ? CITIES.filter(city => {
        const normCity  = normalizeArabic(city);
        const normQuery = normalizeArabic(query.trim());
        return normCity.includes(normQuery) || normQuery.includes(normalizeArabic(city.split(" ")[0]));
      }).slice(0, 12)
    : [];

  const noResults = query.trim().length >= 2 && filtered.length === 0;

  const handleSelect = (city) => {
    setQuery(city);
    setOpen(false);
    setFocused(false);
    setCustomMode(false);
    onChange?.(city);
  };

  const handleCustomConfirm = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    handleSelect(trimmed);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    setCustomMode(false);
    if (!val) onChange?.("");
  };

  const handleClear = () => {
    setQuery("");
    onChange?.("");
    inputRef.current?.focus();
    setOpen(true);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Input */}
      <div className={`flex items-center gap-2 border rounded-xl px-3 h-11 bg-background transition-all ${
        focused ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/40"
      }`}>
        <MapPin className={`w-4 h-4 shrink-0 transition-colors ${focused ? "text-primary" : "text-muted-foreground"}`} />
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => { setFocused(true); setOpen(true); }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none text-right"
          dir="rtl"
          autoComplete="off"
        />
        {query && (
          <button type="button" onClick={handleClear}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Map picker trigger */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowMapPicker(true); setOpen(false); }}
          className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-primary/80 hover:text-primary bg-primary/8 hover:bg-primary/15 px-2 py-1 rounded-lg transition-colors"
          title="اختر من الخريطة"
        >
          <Map className="w-3 h-3" />
          <span className="hidden sm:inline">خريطة</span>
        </button>
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </div>

      {/* Dropdown */}
      {open && (query.trim().length >= 1) && (
        <div className="absolute top-full right-0 left-0 mt-1.5 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-[200] max-h-72 overflow-y-auto"
          dir="rtl">

          {/* Matching cities */}
          {filtered.length > 0 && (
            <div>
              {filtered.length < 12 && query.trim().length >= 1 && (
                <p className="text-[10px] text-muted-foreground px-3 pt-2 pb-1">
                  {filtered.length} نتيجة
                </p>
              )}
              {filtered.map((city) => {
                const normQ = normalizeArabic(query.trim());
                const normC = normalizeArabic(city);
                const matchIdx = normC.indexOf(normQ);
                return (
                  <button
                    key={city}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(city); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary/5 transition-colors text-right"
                  >
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground flex-1">{city}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* No results — offer custom entry */}
          {noResults && (
            <div className="p-4" dir="rtl">
              <div className="flex items-start gap-2 mb-3">
                <Search className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    لم نجد "<span className="text-primary">{query}</span>" في قائمتنا
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    يمكنك إضافة بلدتك أو قريتك مباشرةً
                  </p>
                </div>
              </div>

              {/* Add custom button */}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleCustomConfirm(); }}
                className="w-full flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl py-2.5 text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                إضافة "<span className="font-bold">{query.trim()}</span>" كموقع جديد
              </button>

              <p className="text-[10px] text-muted-foreground text-center mt-2">
                💡 اكتب اسم بلدتك بالعربي كما هو معروف محلياً
              </p>
            </div>
          )}

          {/* Show top cities when input is empty */}
          {query.trim().length === 1 && filtered.length === 0 && (
            <div className="p-2">
              <p className="text-xs text-muted-foreground px-2 py-1">أكمل الكتابة للبحث...</p>
            </div>
          )}
        </div>
      )}
    {/* Map picker — uses CityMapPicker's own modal with forceOpen */}
    {showMapPicker && (
      <CityMapPicker
        value={query}
        placeholder={placeholder}
        forceOpen={true}
        onClose={() => setShowMapPicker(false)}
        onChange={(city) => {
          setQuery(city);
          setShowMapPicker(false);
          onChange?.(city);
        }}
      />
    )}
    </div>
  );
}
