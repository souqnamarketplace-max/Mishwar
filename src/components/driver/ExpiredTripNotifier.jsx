/**
 * ExpiredTripNotifier.jsx
 * Silent background component — runs for drivers only.
 * When a driver's trip expires (departure time passes), sends them a
 * one-time in-app notification so they know to mark it complete.
 * Tracks already-notified trips in localStorage to avoid duplicates.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/sentry";
import { isTripExpired, isTripCompleted } from "@/lib/tripScheduling";

const STORAGE_KEY = "mishwar_notified_expired_trips";

function getNotified() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); }
  catch { return new Set(); }
}

function markNotified(tripId) {
  const s = getNotified();
  s.add(tripId);
  // Keep only last 100 ids to prevent unbounded growth
  const arr = [...s].slice(-100);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

export default function ExpiredTripNotifier({ user }) {
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";

  const { data: myTrips = [] } = useQuery({
    queryKey: ["notifier-trips", user?.email],
    queryFn: () => api.entities.Trip.filter({ created_by: user.email }, "-created_date", 100),
    enabled: isDriver && !!user?.email,
    refetchInterval: 60_000, // check every minute
    staleTime: 55_000,
  });

  useEffect(() => {
    if (!isDriver || !user?.email || myTrips.length === 0) return;

    const notified = getNotified();

    for (const trip of myTrips) {
      // Only notify for trips that expired but haven't been marked completed/cancelled
      if (!["confirmed", "in_progress"].includes(trip.status)) continue;
      if (!isTripExpired(trip)) continue;
      if (notified.has(trip.id)) continue;

      // Send notification once. Direct supabase.from() insert (not
      // api.entities.Notification.create) so we use the live JWT —
      // api's restFetch can fall back to the anon key when the
      // session is stale, which makes auth_user_email() resolve to
      // NULL inside RLS, which rejects this self-insert. supabase-js
      // always carries the live token so the self-target RLS check
      // passes consistently.
      (async () => {
        try {
          const isCompleted = isTripCompleted(trip);
          const { error } = await supabase.from("notifications").insert({
            user_email: user.email,
            title: isCompleted ? "رحلتك انتهت ✅" : "موعد رحلتك اقترب ⏰",
            message: isCompleted
              ? `رحلة ${trip.from_city} ← ${trip.to_city} بتاريخ ${trip.date} انتهت. لا تنسَ تحديد حالتها كـ"مكتملة" في لوحة التحكم.`
              : `رحلتك من ${trip.from_city} إلى ${trip.to_city} الساعة ${trip.time} بدأت للتو. تحقق من الركاب وأكّد إتمام الرحلة.`,
            type: "system",
            trip_id: trip.id,
            // Driver lands on their trips tab where they can mark the
            // trip complete, see remaining passengers, etc. The
            // notification is the prompt to act, the link is the
            // shortcut to the actioning surface.
            link: "/driver?tab=trips",
            is_read: false,
          });
          if (error) throw error;
          markNotified(trip.id);
        } catch (e) {
          // Capture to Sentry so production failures surface instead of
          // hiding behind a console.warn that nobody reads.
          captureException(e, { msg: "ExpiredTripNotifier insert failed", extra: { trip_id: trip.id } });
          console.warn("ExpiredTripNotifier:", e?.message || e);
        }
      })();
    }
  }, [myTrips, isDriver, user?.email]);

  return null; // no UI
}
