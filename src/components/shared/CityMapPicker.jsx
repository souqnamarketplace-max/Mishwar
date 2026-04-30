import React, { useEffect, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";

// Palestinian cities with GPS coordinates
const PALESTINE_CITIES = [
  // رام الله والبيرة
  { name: "رام الله",       lat: 31.9038, lng: 35.2034 },
  { name: "البيرة",         lat: 31.9122, lng: 35.2154 },
  { name: "الرام",          lat: 31.8488, lng: 35.2239 },
  // القدس
  { name: "القدس القديمة",  lat: 31.7762, lng: 35.2354 },
  { name: "ضواحي القدس",   lat: 31.7980, lng: 35.2179 },
  { name: "شعفاط",          lat: 31.8223, lng: 35.2298 },
  // نابلس
  { name: "نابلس",          lat: 32.2211, lng: 35.2544 },
  { name: "بيتا",           lat: 32.1685, lng: 35.3102 },
  { name: "حوّارة",         lat: 32.1754, lng: 35.2702 },
  // جنين
  { name: "جنين",           lat: 32.4601, lng: 35.2969 },
  { name: "يعبد",           lat: 32.4152, lng: 35.1749 },
  // طولكرم
  { name: "طولكرم",         lat: 32.3107, lng: 35.0289 },
  { name: "علّار",          lat: 32.3301, lng: 35.0612 },
  // قلقيلية
  { name: "قلقيلية",        lat: 32.1887, lng: 34.9701 },
  { name: "عزون",           lat: 32.2025, lng: 35.0305 },
  // سلفيت
  { name: "سلفيت",          lat: 32.0864, lng: 35.1781 },
  // أريحا
  { name: "أريحا",          lat: 31.8571, lng: 35.4617 },
  { name: "الجفتليك",       lat: 32.0290, lng: 35.4747 },
  // بيت لحم
  { name: "بيت لحم",        lat: 31.7054, lng: 35.2024 },
  { name: "بيت ساحور",      lat: 31.6974, lng: 35.2224 },
  { name: "بيت جالا",       lat: 31.7180, lng: 35.1880 },
  { name: "الخضر",          lat: 31.6808, lng: 35.1648 },
  // الخليل
  { name: "الخليل",         lat: 31.5320, lng: 35.0998 },
  { name: "دورا",           lat: 31.5023, lng: 35.0256 },
  { name: "الظاهرية",       lat: 31.4106, lng: 34.9698 },
  { name: "يطا",            lat: 31.4261, lng: 35.1012 },
  { name: "سعير",           lat: 31.5815, lng: 35.1672 },
];

export default function CityMapPicker({ value, onChange, placeholder = "اختر مدينتك", forceOpen = false, onClose }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  // Allow parent to force-open the map
  useEffect(() => {
    if (forceOpen) setIsOpen(true);
  }, [forceOpen]);
  const [selected, setSelected] = useState(value || "");

  const filtered = PALESTINE_CITIES.filter(c =>
    c.name.includes(search) || search === ""
  );

  // Initialize Leaflet map
  useEffect(() => {
    if (!isOpen || mapInstance.current) return;

    const timer = setTimeout(async () => {
      if (!mapRef.current) return;

      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");

      // Fix default icon
      delete L.default.Icon.Default.prototype._getIconUrl;
      L.default.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.default.map(mapRef.current, {
        center: [31.9, 35.2],
        zoom: 8,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.default.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);

      // Add markers for all cities
      PALESTINE_CITIES.forEach(city => {
        const isSelected = city.name === selected;

        const icon = L.default.divIcon({
          html: `<div style="
            background: ${isSelected ? '#2d6a4f' : '#fff'};
            border: 2.5px solid #2d6a4f;
            border-radius: 50%;
            width: 14px; height: 14px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            cursor: pointer;
          "></div>`,
          className: "",
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const marker = L.default.marker([city.lat, city.lng], { icon })
          .addTo(map)
          .bindTooltip(city.name, { permanent: false, direction: "top", className: "city-tooltip" });

        marker.on("click", () => {
          handleSelect(city.name);
        });

        markersRef.current.push(marker);
      });

      mapInstance.current = map;

      // If city already selected, center on it
      if (selected) {
        const city = PALESTINE_CITIES.find(c => c.name === selected);
        if (city) map.setView([city.lat, city.lng], 11);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen]);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen && mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
      markersRef.current = [];
    }
  }, [isOpen]);

  const handleSelect = (cityName) => {
    setSelected(cityName);
    onChange(cityName);
    setIsOpen(false);
    setSearch("");
    onClose?.();
  };

  const flyToCity = (city) => {
    if (mapInstance.current) {
      mapInstance.current.flyTo([city.lat, city.lng], 12, { duration: 0.8 });
    }
  };

  return (
    <div className="relative" dir="rtl">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full h-11 flex items-center gap-2 px-3 rounded-xl bg-muted/50 border border-border text-sm hover:border-primary/40 transition-colors"
      >
        <MapPin className="w-4 h-4 text-primary shrink-0" />
        <span className={selected ? "text-foreground font-medium" : "text-muted-foreground"}>
          {selected || placeholder}
        </span>
        {selected && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleSelect(""); }}
            className="mr-auto p-1 rounded hover:bg-muted"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </button>

      {/* Map Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60" onClick={() => { setIsOpen(false); onClose?.(); }}>
          <div
            className="bg-card w-full sm:max-w-lg h-[85vh] sm:h-[600px] rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
              <MapPin className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-foreground">اختر مدينتك على الخريطة</p>
                <p className="text-xs text-muted-foreground">انقر على الخريطة أو ابحث بالاسم</p>
              </div>
              <button onClick={() => { setIsOpen(false); onClose?.(); }} className="p-2 rounded-xl hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2 border-b border-border shrink-0">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value);
                    if (e.target.value) {
                      const city = PALESTINE_CITIES.find(c => c.name.startsWith(e.target.value));
                      if (city) flyToCity(city);
                    }
                  }}
                  placeholder="ابحث عن مدينة..."
                  className="w-full h-10 pr-9 pl-4 rounded-xl bg-muted/50 border border-border text-sm outline-none focus:border-primary/50"
                  autoFocus
                />
              </div>
            </div>

            {/* Map + List layout */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Map */}
              <div ref={mapRef} className="h-48 shrink-0" style={{ zIndex: 1 }} />

              {/* City list */}
              <div className="flex-1 overflow-y-auto">
                {filtered.map(city => (
                  <button
                    key={city.name}
                    type="button"
                    onClick={() => handleSelect(city.name)}
                    onMouseEnter={() => flyToCity(city)}
                    className={`w-full text-right px-4 py-3 flex items-center gap-3 hover:bg-muted/50 active:bg-muted transition-colors border-b border-border/30 ${
                      selected === city.name ? "bg-primary/8 text-primary" : ""
                    }`}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${selected === city.name ? "bg-primary" : "bg-muted-foreground/30"}`} />
                    <span className="text-sm font-medium">{city.name}</span>
                    {selected === city.name && <span className="mr-auto text-xs text-primary font-bold">✓ مختارة</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
