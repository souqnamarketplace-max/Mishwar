import React, { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { MapPin, Navigation, Clock, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Leaflet loaded from CDN (already a dep via RouteMap) ─────────────────────
// We import it lazily so SSR/Vite doesn't bundle it twice.

const STALE_MINUTES = 30; // hide driver if last update > 30 min ago

function minutesAgo(isoStr) {
  if (!isoStr) return Infinity;
  return (Date.now() - new Date(isoStr).getTime()) / 60_000;
}

function formatAge(isoStr) {
  const mins = minutesAgo(isoStr);
  if (mins < 1)  return "الآن";
  if (mins < 60) return `منذ ${Math.round(mins)} د`;
  return `منذ ${Math.round(mins / 60)} س`;
}

export default function DashboardDriverMap() {
  const [drivers, setDrivers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const mapRef   = useRef(null);
  const leafMap  = useRef(null);
  const markers  = useRef({});

  // ── Fetch driver locations ─────────────────────────────────────────────
  const fetchLocations = async () => {
    const { data, error } = await supabase
      .from("driver_locations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error && data) {
      // Filter stale rows
      const fresh = data.filter(d => minutesAgo(d.updated_at) < STALE_MINUTES);
      setDrivers(fresh);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLocations();

    // Realtime subscription — map updates instantly when driver moves
    const channel = supabase.channel("admin-driver-locations")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "driver_locations",
      }, () => { fetchLocations(); })
      .subscribe();

    // Fallback poll every 60s in case realtime drops
    const poll = setInterval(fetchLocations, 60_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, []);

  // ── Init Leaflet map ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    if (leafMap.current) return; // already initialised

    // Dynamically load Leaflet
    import("leaflet").then(L => {
      L = L.default || L;

      // Fix default icon paths broken by Vite
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      // Palestine centre
      leafMap.current = L.map(mapRef.current, {
        center: [32.0, 35.25],
        zoom: 9,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 18,
      }).addTo(leafMap.current);
    });
  }, []);

  // ── Sync markers to map ────────────────────────────────────────────────
  useEffect(() => {
    if (!leafMap.current) return;
    import("leaflet").then(L => {
      L = L.default || L;

      const activeEmails = new Set(drivers.map(d => d.driver_email));

      // Remove stale markers
      Object.keys(markers.current).forEach(email => {
        if (!activeEmails.has(email)) {
          markers.current[email].remove();
          delete markers.current[email];
        }
      });

      // Add / update markers
      drivers.forEach(driver => {
        const age    = minutesAgo(driver.updated_at);
        const color  = age < 5 ? "#22c55e" : age < 15 ? "#f59e0b" : "#ef4444";
        const isNew  = age < 2;

        const icon = L.divIcon({
          className: "",
          html: `
            <div style="position:relative;width:36px;height:36px;">
              ${isNew ? `<div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.3;animation:ping 1.5s ease-in-out infinite;"></div>` : ""}
              <div style="width:36px;height:36px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5" fill="${color}"/></svg>
              </div>
              <div style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,0.75);color:white;font-size:9px;padding:1px 5px;border-radius:4px;font-family:sans-serif;">
                ${(driver.driver_email || "").split("@")[0]}
              </div>
            </div>
          `,
          iconSize:   [36, 54],
          iconAnchor: [18, 36],
          popupAnchor:[0, -40],
        });

        const popup = `
          <div dir="rtl" style="font-family:sans-serif;min-width:160px;">
            <p style="font-weight:bold;margin:0 0 4px">${driver.driver_email}</p>
            ${driver.from_city && driver.to_city ? `<p style="margin:0 0 2px;font-size:12px;">📍 ${driver.from_city} → ${driver.to_city}</p>` : ""}
            ${driver.speed_kmh != null ? `<p style="margin:0 0 2px;font-size:12px;">🚗 ${driver.speed_kmh} كم/س</p>` : ""}
            <p style="margin:0;font-size:11px;color:#666;">${formatAge(driver.updated_at)}</p>
          </div>
        `;

        if (markers.current[driver.driver_email]) {
          markers.current[driver.driver_email]
            .setLatLng([driver.latitude, driver.longitude])
            .setIcon(icon)
            .getPopup()?.setContent(popup);
        } else {
          const marker = L.marker([driver.latitude, driver.longitude], { icon })
            .addTo(leafMap.current)
            .bindPopup(popup);
          marker.on("click", () => setSelected(driver.driver_email));
          markers.current[driver.driver_email] = marker;
        }
      });

      // Fly to selected driver
      if (selected && markers.current[selected]) {
        leafMap.current.flyTo(
          markers.current[selected].getLatLng(),
          14,
          { animate: true, duration: 0.8 }
        );
        markers.current[selected].openPopup();
      }
    });
  }, [drivers, selected]);

  const activeCount = drivers.length;

  return (
    <div dir="rtl">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">مواقع السائقين المباشرة</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            يتحدث كل 30 ثانية • يختفي بعد {STALE_MINUTES} دقيقة من توقف التتبع
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground">
              آخر تحديث: {lastRefresh.toLocaleTimeString("ar-EG")}
            </span>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1"
            onClick={fetchLocations}>
            <RefreshCw className="w-3.5 h-3.5" />تحديث
          </Button>
        </div>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-green-500/10 border border-green-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-green-700">{drivers.filter(d => minutesAgo(d.updated_at) < 5).length}</p>
          <p className="text-xs text-green-600">نشط الآن</p>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-yellow-700">{drivers.filter(d => minutesAgo(d.updated_at) >= 5 && minutesAgo(d.updated_at) < 15).length}</p>
          <p className="text-xs text-yellow-600">آخر 15 دقيقة</p>
        </div>
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-center">
          <p className="text-2xl font-black text-primary">{activeCount}</p>
          <p className="text-xs text-primary">إجمالي الظاهرين</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ── Map ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-3">
          {/* Leaflet CSS */}
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <style>{`@keyframes ping{0%,100%{transform:scale(1);opacity:0.3}50%{transform:scale(1.8);opacity:0}}`}</style>

          <div className="rounded-2xl overflow-hidden border border-border shadow-sm">
            {loading ? (
              <div className="h-[480px] bg-muted flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Navigation className="w-8 h-8 mx-auto mb-2 animate-pulse" />
                  <p className="text-sm">جاري تحميل الخريطة...</p>
                </div>
              </div>
            ) : activeCount === 0 ? (
              <div className="h-[480px] bg-muted flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <MapPin className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">لا يوجد سائقون نشطون حالياً</p>
                  <p className="text-xs mt-1">تظهر المواقع عندما يشغّل السائق تتبع GPS أثناء الرحلة</p>
                </div>
              </div>
            ) : (
              <div ref={mapRef} style={{ height: "480px", width: "100%" }} />
            )}
          </div>
        </div>

        {/* ── Driver list sidebar ──────────────────────────────────── */}
        <div className="space-y-2 max-h-[520px] overflow-y-auto">
          <p className="text-xs font-semibold text-muted-foreground mb-3">السائقون على الطريق</p>
          {activeCount === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">لا يوجد سائقون نشطون</p>
          ) : (
            drivers.map(driver => {
              const age   = minutesAgo(driver.updated_at);
              const color = age < 5 ? "bg-green-500" : age < 15 ? "bg-yellow-500" : "bg-red-400";
              const isSelected = selected === driver.driver_email;
              return (
                <button
                  key={driver.driver_email}
                  onClick={() => setSelected(driver.driver_email)}
                  className={`w-full text-right p-3 rounded-xl border transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">
                        {driver.driver_email.split("@")[0]}
                      </p>
                      {driver.from_city && driver.to_city && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          {driver.from_city} → {driver.to_city}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">{formatAge(driver.updated_at)}</p>
                      {driver.speed_kmh != null && (
                        <p className="text-[10px] text-primary font-mono">{driver.speed_kmh} km/h</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
