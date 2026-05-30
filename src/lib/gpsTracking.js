import { useState, useEffect, useRef, useCallback } from "react";
import { CITY_COORDS } from "./mapUtils";
import { supabase } from "./supabase";

// ─── Dynamic radius per city (km) ────────────────────────────────────────────
const BIG_CITIES = new Set([
  'القدس','القدس القديمة','رام الله','البيرة','نابلس','الخليل','غزة',
  'بيت لحم','جنين','طولكرم','قلقيلية','أريحا','طوباس','سلفيت',
]);
const MEDIUM_CITIES = new Set([
  'بيت جالا','بيت ساحور','دورا','يطا','الظاهرية','حلحول',
  'بيتونيا','أبو ديس','العيزرية','الزاوية','سلواد',
  'عنبتا','بيت أمر','ترقوميا',
]);

export function getCityRadius(cityName) {
  if (!cityName) return 3;
  if (BIG_CITIES.has(cityName)) return 5;
  if (MEDIUM_CITIES.has(cityName)) return 3;
  return 2; // small villages
}

// ─── Haversine distance (km) ──────────────────────────────────────────────────
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── React hook — GPS trip completion ────────────────────────────────────────
// Usage: const { status, distanceKm, minutesLeft, requestLocation } = useGPSTripCompletion(trip, onComplete)
// status: 'idle' | 'granted' | 'denied' | 'near' | 'countdown' | 'done'
export function useGPSTripCompletion(trip, onComplete, { bufferMinutes = 20 } = {}) {  const [status, setStatus] = useState("idle");       // idle | granted | denied | near | countdown | done
  const [distanceKm, setDistanceKm] = useState(null);
  const [minutesLeft, setMinutesLeft] = useState(null);
  const countdownRef = useRef(null);
  const watchRef = useRef(null);
  const arrivalTimeRef = useRef(null);

  const destCoords = trip?.to_city ? CITY_COORDS[trip.to_city] : null;
  const radius = getCityRadius(trip?.to_city);

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    arrivalTimeRef.current = null;
    setMinutesLeft(null);
  }, []);

  const startCountdown = useCallback(() => {
    if (arrivalTimeRef.current) return; // already counting
    arrivalTimeRef.current = Date.now();
    setStatus("countdown");
    countdownRef.current = setInterval(() => {
      const elapsed = (Date.now() - arrivalTimeRef.current) / 1000 / 60;
      const left = Math.max(0, bufferMinutes - elapsed);
      setMinutesLeft(Math.ceil(left));
      if (elapsed >= bufferMinutes) {
        clearInterval(countdownRef.current);
        setStatus("done");
        // Remove driver location from DB — trip is done, no longer on road
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user?.email) {
            supabase.from("driver_locations").delete().eq("driver_email", session.user.email).then(() => {});
          }
        });
        onComplete?.();
      }
    }, 30_000); // check every 30 seconds
  }, [bufferMinutes, onComplete, clearCountdown]);

  const lastPersistRef = useRef(0);

  const handlePosition = useCallback((pos) => {
    if (!destCoords) return;
    const { latitude, longitude, accuracy, speed, heading } = pos.coords;
    const dist = haversineKm(latitude, longitude, destCoords[0], destCoords[1]);
    setDistanceKm(dist);

    // ── Persist to DB via RPC (admin-only table, rate-limited 30s) ─────────
    // Uses update_driver_location RPC (migration 117) which resolves
    // driver_email server-side via auth.email() — no null-email bug.
    const now = Date.now();
    if (now - lastPersistRef.current > 30_000) {
      lastPersistRef.current = now;
      supabase.rpc("update_driver_location", {
        p_latitude:   latitude,
        p_longitude:  longitude,
        p_accuracy_m: accuracy  ?? null,
        p_speed_kmh:  speed != null ? Math.round(speed * 3.6) : null,
        p_heading:    heading   ?? null,
        p_trip_id:    trip?.id        ?? null,
        p_from_city:  trip?.from_city ?? null,
        p_to_city:    trip?.to_city   ?? null,
      }).then(() => {}); // fire-and-forget
    }

    if (dist <= radius) {
      setStatus(prev => prev === "countdown" || prev === "done" ? prev : "near");
      startCountdown();
    } else {
      if (arrivalTimeRef.current) {
        clearCountdown();
        setStatus("granted");
      }
    }
  }, [destCoords, radius, startCountdown, clearCountdown, trip]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setStatus("denied"); return; }
    navigator.geolocation.getCurrentPosition(
      () => setStatus("granted"),
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 10000 }
    );
    watchRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      () => setStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );
  }, [handlePosition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      clearCountdown();
    };
  }, [clearCountdown]);

  return { status, distanceKm, minutesLeft, radius, requestLocation };
}
