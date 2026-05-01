import React, { useEffect, useRef, useState } from "react";
import { MapPin, X, Search } from "lucide-react";
import { CITY_COORDS } from "@/lib/mapUtils";

// Palestine map bounds (West Bank)
const PALESTINE_CENTER = [31.9, 35.2];
const PALESTINE_ZOOM = 9;

// All cities with coordinates as array for easy iteration
const CITY_LIST = Object.entries(CITY_COORDS).map(([name, [lat, lng]]) => ({
  name,
  lat,
  lng,
}));

// Find nearest city to a clicked lat/lng — returns { city, dist }
function nearestCity(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const city of CITY_LIST) {
    const d = Math.hypot(city.lat - lat, city.lng - lng);
    if (d < bestDist) { bestDist = d; best = city; }
  }
  return { city: best, dist: bestDist };
}

// Reverse geocode via Nominatim — returns Arabic place name or null
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ar`,
      { headers: { "Accept-Language": "ar" } }
    );
    const data = await res.json();
    // Prefer village > town > city > county
    const addr = data.address || {};
    const name = addr.village || addr.town || addr.city || addr.suburb ||
                 addr.municipality || addr.county || addr.state_district;
    return name || null;
  } catch { return null; }
}

export default function MapCityPicker({ value, onChange, forceOpen = false, onClose }) {
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef([]);
  const selectedMarkerRef = useRef(null);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(forceOpen);
  // Lock both html + body scroll while map modal is open. 
  // Locking only `body` is not enough — html element can still scroll on some browsers.
  useEffect(() => {
    if (isOpen) {
      const html = document.documentElement;
      const body = document.body;
      const prevHtmlOverflow = html.style.overflow;
      const prevBodyOverflow = body.style.overflow;
      const prevBodyPosition = body.style.position;
      const prevBodyTop = body.style.top;
      // Remember scroll position so we can restore after modal closes
      const scrollY = window.scrollY;
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      // Pin body to current scroll so iOS/Safari doesn't bounce or repaint underneath
      body.style.position = "fixed";
      body.style.top = `-${scrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      return () => {
        html.style.overflow = prevHtmlOverflow;
        body.style.overflow = prevBodyOverflow;
        body.style.position = prevBodyPosition;
        body.style.top = prevBodyTop;
        body.style.left = "";
        body.style.right = "";
        // Restore the scroll position
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);


  const filtered = search.length > 0
    ? CITY_LIST.filter(c => c.name.includes(search))
    : [];

  // Initialize Leaflet map when modal opens
  useEffect(() => {
    if (!isOpen || leafletMapRef.current) return;

    // Dynamically import leaflet to avoid SSR issues
    import("leaflet").then((L) => {
      // Fix default icon paths
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!mapRef.current || leafletMapRef.current) return;

      const map = L.map(mapRef.current, {
        center: PALESTINE_CENTER,
        zoom: PALESTINE_ZOOM,
        zoomControl: true,
        attributionControl: false,
      });

      // OpenStreetMap tile layer
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 18,
      }).addTo(map);

      // Custom icon factory
      const makeIcon = (isSelected) => L.divIcon({
        className: "",
        html: `
          <div style="
            width: ${isSelected ? 14 : 10}px;
            height: ${isSelected ? 14 : 10}px;
            background: ${isSelected ? "#2d6a4f" : "#52b788"};
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            transition: all 0.2s;
          "></div>`,
        iconSize: [isSelected ? 14 : 10, isSelected ? 14 : 10],
        iconAnchor: [isSelected ? 7 : 5, isSelected ? 7 : 5],
      });

      // Add all city markers
      CITY_LIST.forEach((city) => {
        const isSelected = city.name === value;
        const marker = L.marker([city.lat, city.lng], {
          icon: makeIcon(isSelected),
          title: city.name,
        }).addTo(map);

        // Tooltip showing city name
        marker.bindTooltip(city.name, {
          permanent: false,
          direction: "top",
          offset: [0, -8],
          className: "mishwar-city-tooltip",
        });

        marker.on("click", () => {
          selectCity(city.name, city.lat, city.lng, L, map);
        });

        markersRef.current.push({ marker, city });

        if (isSelected) {
          selectedMarkerRef.current = marker;
          marker.setIcon(makeIcon(true));
        }
      });

      // Click on map → use known city if close, else reverse geocode
      map.on("click", async (e) => {
        const { lat, lng } = e.latlng;
        const { city, dist } = nearestCity(lat, lng);
        // ~0.02 degrees ≈ 2km threshold
        if (dist < 0.02 && city) {
          selectCity(city.name, city.lat, city.lng, L, map);
        } else {
          // Show loading indicator on map
          const loadingMarker = L.marker([lat, lng], {
            icon: L.divIcon({
              className: "",
              html: `<div style="background:#2d6a4f;color:white;border-radius:20px;padding:4px 10px;font-size:11px;font-weight:bold;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3)">جاري التحديد...</div>`,
              iconAnchor: [50, 10],
            })
          }).addTo(map);

          const placeName = await reverseGeocode(lat, lng);
          map.removeLayer(loadingMarker);

          if (placeName) {
            // Add to dynamic city list and select
            selectCity(placeName, lat, lng, L, map);
          } else if (city) {
            selectCity(city.name, city.lat, city.lng, L, map);
          }
        }
      });

      // If a city is already selected, pan to it
      if (value && CITY_COORDS[value]) {
        const [lat, lng] = CITY_COORDS[value];
        map.setView([lat, lng], 12);
      }

      leafletMapRef.current = map;
    });

    // Inject tooltip CSS
    if (!document.getElementById("mishwar-leaflet-css")) {
      const link = document.createElement("link");
      link.id = "mishwar-leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);

      const style = document.createElement("style");
      style.textContent = `
        .mishwar-city-tooltip {
          background: rgba(45,106,79,0.95) !important;
          border: none !important;
          border-radius: 8px !important;
          color: white !important;
          font-family: inherit !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          padding: 4px 8px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
          white-space: nowrap !important;
        }
        .mishwar-city-tooltip::before { display: none !important; }
        .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 12px rgba(0,0,0,0.15) !important; }
        .leaflet-control-zoom a { border-radius: 8px !important; color: #2d6a4f !important; font-weight: bold !important; }
      `;
      document.head.appendChild(style);
    }
  }, [isOpen]);

  // Cleanup map on modal close
  useEffect(() => {
    if (!isOpen && leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
      markersRef.current = [];
      selectedMarkerRef.current = null;
    }
  }, [isOpen]);

  function selectCity(name, lat, lng, L, map) {
    onChange(name);
    setSearch("");

    import("leaflet").then((L) => {
      const makeIcon = (isSelected) => L.divIcon({
        className: "",
        html: `<div style="width:${isSelected ? 14 : 10}px;height:${isSelected ? 14 : 10}px;background:${isSelected ? "#2d6a4f" : "#52b788"};border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
        iconSize: [isSelected ? 14 : 10, isSelected ? 14 : 10],
        iconAnchor: [isSelected ? 7 : 5, isSelected ? 7 : 5],
      });

      markersRef.current.forEach(({ marker, city }) => {
        marker.setIcon(makeIcon(city.name === name));
      });

      // Pan to selected location (known or geocoded)
      if (leafletMapRef.current) {
        const coords = CITY_COORDS[name];
        const clat = coords ? coords[0] : lat;
        const clng = coords ? coords[1] : lng;
        leafletMapRef.current.setView([clat, clng], 13, { animate: true });

        // For geocoded places not in our list, add a temporary marker
        if (!coords && lat && lng) {
          const tempIcon = L.divIcon({
            className: "",
            html: `<div style="width:14px;height:14px;background:#2d6a4f;border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
            iconSize: [14, 14], iconAnchor: [7, 7],
          });
          // Remove previous temp marker if any
          if (leafletMapRef.current._tempMarker) {
            leafletMapRef.current.removeLayer(leafletMapRef.current._tempMarker);
          }
          const m = L.marker([lat, lng], { icon: tempIcon })
            .addTo(leafletMapRef.current)
            .bindTooltip(name, { permanent: true, direction: "top", offset: [0, -8], className: "mishwar-city-tooltip" });
          leafletMapRef.current._tempMarker = m;
        }
      }
    });
  }

  function handleSearchSelect(city) {
    if (leafletMapRef.current && CITY_COORDS[city.name]) {
      selectCity(city.name, city.lat, city.lng, null, leafletMapRef.current);
    } else {
      onChange(city.name);
    }
    setSearch("");
  }

  const closeModal = () => {
    setIsOpen(false);
    if (onClose) onClose();
  };

  return (
    <div>
      {/* Trigger button (hidden when forceOpen — parent controls open state) */}
      {!forceOpen && (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`w-full h-11 flex items-center gap-3 px-4 rounded-xl border text-sm transition-all text-right ${
          value
            ? "border-primary bg-primary/5 text-foreground"
            : "border-input bg-background text-muted-foreground hover:border-primary/50"
        }`}
      >
        <MapPin className={`w-4 h-4 shrink-0 ${value ? "text-primary" : "text-muted-foreground"}`} />
        <span className="flex-1">{value || "اختر مدينتك من الخريطة"}</span>
        {value && <span className="text-xs text-primary">🇵🇸</span>}
      </button>
      )}

      {/* Map Modal */}
      {isOpen && (
        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center sm:p-4 bg-black/60"
          style={{ height: "100dvh", minHeight: "100dvh" }} dir="rtl">
          <div className="bg-card sm:rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-full sm:h-auto" style={{ height: "min(100dvh, 600px)" }}>

            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div>
                <h3 className="font-bold text-foreground text-base">اختر مدينتك 🗺️</h3>
                <p className="text-xs text-muted-foreground mt-0.5">اضغط على أي مدينة في الخريطة أو ابحث عنها</p>
              </div>
              <button
                onClick={() => closeModal()}
                className="w-9 h-9 rounded-xl hover:bg-muted flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Search bar */}
            <div className="px-4 py-3 border-b border-border shrink-0 relative">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث عن مدينة..."
                  className="w-full h-10 pr-10 pl-4 rounded-xl bg-muted/50 border border-border text-sm focus:outline-none focus:border-primary"
                />
              </div>
              {/* Search results dropdown */}
              {filtered.length > 0 && (
                <div className="absolute right-4 left-4 top-full mt-1 bg-card border border-border rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                  {filtered.map((city) => (
                    <button
                      key={city.name}
                      type="button"
                      onClick={() => handleSearchSelect(city)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-muted text-right text-sm transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                      {city.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected city indicator */}
            {value && (
              <div className="px-4 py-2 bg-primary/8 border-b border-primary/20 shrink-0 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-sm font-semibold text-primary">{value}</span>
                <span className="text-xs text-primary/70 mr-auto">مدينتك المختارة</span>
              </div>
            )}

            {/* Leaflet Map */}
            <div className="flex-1 relative min-h-0">
              <div ref={mapRef} className="w-full h-full" />
              {/* Map hint overlay */}
              <div className="absolute bottom-4 right-4 z-[400] bg-card/95 backdrop-blur-sm rounded-xl px-3 py-2 text-xs text-muted-foreground shadow-md border border-border pointer-events-none">
                🟢 اضغط على النقطة لاختيار المدينة
              </div>
            </div>

            {/* Confirm button */}
            <div className="px-4 py-3 border-t border-border shrink-0">
              <button
                type="button"
                onClick={() => closeModal()}
                disabled={!value}
                className={`w-full h-11 rounded-xl font-bold text-sm transition-all ${
                  value
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                {value ? `تأكيد اختيار ${value} ✓` : "اختر مدينة أولاً"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
