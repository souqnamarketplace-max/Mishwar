/**
 * RouteMap.jsx
 * Interactive OpenStreetMap component showing a route between two cities.
 *
 * Props:
 *   fromCity  {string}  - departure city name (Arabic)
 *   toCity    {string}  - destination city name (Arabic)
 *   height    {string}  - CSS height, default "220px"
 *   showStats {boolean} - show distance/duration below map
 *   onRouteCalculated {function} - callback({ distance, duration }) when route is ready
 *   className {string}
 */

import React, { useEffect, useRef, useState } from 'react';
import { captureException } from "@/lib/sentry";
import { MapPin, Clock, Navigation, Loader2 } from 'lucide-react';
import { calculateRoute, calculateMultiStopRoute } from '@/lib/mapUtils';

// Fix Leaflet default marker icons (broken in Vite)
function fixLeafletIcons(L) {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

export default function RouteMap({
  fromCity,
  toCity,
  stops = [],     // array of {city, location, time, ...} for multi-stop trips
  height = '220px',
  showStats = true,
  onRouteCalculated,
  className = '',
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!fromCity || !toCity) return;

    let cancelled = false;

    const initMap = async () => {
      setLoading(true);
      setError(null);

      try {
        // Dynamically import Leaflet (avoids SSR issues)
        const L = (await import('leaflet')).default;
        fixLeafletIcons(L);

        const route = stops && stops.length > 0
          ? await calculateMultiStopRoute(fromCity, toCity, stops)
          : await calculateRoute(fromCity, toCity);
        if (cancelled) return;

        if (!route) {
          setError('تعذّر تحميل الخريطة');
          setLoading(false);
          return;
        }

        setRouteData(route);
        if (onRouteCalculated && route.distance) {
          onRouteCalculated({ distance: route.distance, duration: route.duration });
        }

        // Destroy existing map instance
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }

        if (!mapRef.current) return;

        const { fromCoords, toCoords, geometry } = route;

        // Calculate center point
        const centerLat = (fromCoords[0] + toCoords[0]) / 2;
        const centerLng = (fromCoords[1] + toCoords[1]) / 2;

        // Init map
        const map = L.map(mapRef.current, {
          center: [centerLat, centerLng],
          zoom: 10,
          zoomControl: true,
          scrollWheelZoom: false, // disable scroll zoom for embedded maps
          attributionControl: false,
        });

        mapInstanceRef.current = map;

        // OpenStreetMap tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        }).addTo(map);

        // Small attribution
        L.control.attribution({ prefix: false })
          .addAttribution('<a href="https://www.openstreetmap.org/copyright" style="font-size:9px">© OSM</a>')
          .addTo(map);

        // Custom markers
        const fromIcon = L.divIcon({
          html: `<div style="
            background: #1a3d2a; color: white; border-radius: 50% 50% 50% 0;
            width: 28px; height: 28px; display: flex; align-items: center;
            justify-content: center; transform: rotate(-45deg);
            box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 2px solid white;
          "><span style="transform:rotate(45deg);font-size:12px">🟢</span></div>`,
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });

        const toIcon = L.divIcon({
          html: `<div style="
            background: #c1121f; color: white; border-radius: 50% 50% 50% 0;
            width: 28px; height: 28px; display: flex; align-items: center;
            justify-content: center; transform: rotate(-45deg);
            box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 2px solid white;
          "><span style="transform:rotate(45deg);font-size:12px">🔴</span></div>`,
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });

        // Add markers with popups
        L.marker(fromCoords, { icon: fromIcon })
          .addTo(map)
          .bindPopup(`<b>من: ${fromCity}</b>`, { direction: 'top' });

        L.marker(toCoords, { icon: toIcon })
          .addTo(map)
          .bindPopup(`<b>إلى: ${toCity}</b>`, { direction: 'top' });

        // Intermediate stop markers — use coords returned from multi-stop route
        if (Array.isArray(stops) && stops.length > 0 && Array.isArray(route.stopCoords)) {
          const stopIcon = L.divIcon({
            html: `<div style="
              background: #f59e0b; color: white; border-radius: 50%;
              width: 26px; height: 26px; display: flex; align-items: center;
              justify-content: center;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 2px solid white;
              font-size: 11px; font-weight: bold;
            ">●</div>`,
            className: '',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          route.stopCoords.forEach((coords, idx) => {
            if (!coords) return;
            const stop = stops[idx];
            const label = stop?.city || `محطة ${idx + 1}`;
            const timeStr = stop?.time ? `<br/>⏰ ${stop.time}` : '';
            const priceStr = stop?.price_from_origin ? `<br/>₪${stop.price_from_origin} من الانطلاق` : '';
            L.marker(coords, { icon: stopIcon })
              .addTo(map)
              .bindPopup(`<b>🟡 محطة ${idx + 1}: ${label}</b>${timeStr}${priceStr}`, { direction: 'top' });
          });
        }

        // Draw route line
        if (geometry?.coordinates?.length > 0) {
          // GeoJSON coords are [lng, lat] — Leaflet needs [lat, lng]
          const latLngs = geometry.coordinates.map(([lng, lat]) => [lat, lng]);

          // Outline for contrast
          L.polyline(latLngs, {
            color: '#ffffff',
            weight: 7,
            opacity: 0.6,
            lineJoin: 'round',
          }).addTo(map);

          // Main route line
          L.polyline(latLngs, {
            color: '#1a3d2a',
            weight: 5,
            opacity: 0.95,
            lineJoin: 'round',
          }).addTo(map);

          // Fit map to route bounds with padding
          const bounds = L.latLngBounds(latLngs);
          map.fitBounds(bounds, { padding: [40, 40] });
        } else {
          // Geometry unavailable — show message instead of fake line
          const bounds = L.latLngBounds([fromCoords, toCoords]);
          map.fitBounds(bounds, { padding: [50, 50] });
        }

      } catch (e) {
        if (!cancelled) {
          captureException(e, { msg: 'Map init error:' });
          setError('تعذّر تحميل الخريطة');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [fromCity, toCity, JSON.stringify(stops)]);

  if (!fromCity || !toCity) {
    return (
      <div
        className={`rounded-xl bg-muted/50 border border-border flex items-center justify-center text-muted-foreground text-sm ${className}`}
        style={{ height }}
      >
        <MapPin className="w-4 h-4 mr-2" />
        اختر مدينة الانطلاق والوصول لعرض المسار
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden border border-border ${className}`} style={{ touchAction: "none" }}>
      {/* Map container */}
      <div className="relative" style={{ height }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80 rounded-xl">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">جاري تحميل المسار...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80 rounded-xl">
            <span className="text-xs text-muted-foreground">{error}</span>
          </div>
        )}
        <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
      </div>

      {/* Route stats bar */}
      {showStats && routeData && (
        <div className="flex items-center justify-around px-4 py-2.5 bg-card border-t border-border text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="font-medium text-foreground">{fromCity}</span>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            {routeData.distance && (
              <span className="text-xs font-bold text-primary flex items-center gap-1">
                <Navigation className="w-3 h-3" />
                {routeData.distance}
              </span>
            )}
            {routeData.duration && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {routeData.duration}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="font-medium text-foreground">{toCity}</span>
            <div className="w-2 h-2 rounded-full bg-destructive" />
          </div>
        </div>
      )}
    </div>
  );
}
