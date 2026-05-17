// Favorites are stored client-side in localStorage, namespaced by the
// signed-in user's email so household devices that switch accounts don't
// see each other's saved trips. Anonymous viewers get their own bucket
// keyed "anon" so they can still favorite while logged out; the moment
// they sign in, their previous anon list is left behind by design (no
// cross-account merge — the privacy boundary matters more than the
// minor data-loss of pre-login favorites).
//
// The list is a Set of trip ids. Persisted as a JSON array.
//
// Why not a database table:
//   - Favorites are a personal-bookmark surface, not social signal
//   - Sub-second toggling matters; an RTT to Supabase per heart-tap
//     would feel sluggish on Palestinian 3G
//   - No legitimate use case to read another user's favorites
//   - Future cross-device sync could land behind a separate `favorites`
//     table without touching this API — just swap getFavs()/saveFavs()
//     to call the API instead of localStorage
//
// Used by:
//   - src/pages/TripDetails.jsx   — heart button below the booking CTA
//   - src/components/shared/TripCard.jsx — heart on every list-view card
//   - src/pages/Favorites.jsx     — the dedicated favorites tab

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";

function buildKey(email) {
  return `mishwar-favs-${email || "anon"}`;
}

function readFavs(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeFavs(key, favs) {
  try {
    localStorage.setItem(key, JSON.stringify([...favs]));
  } catch {
    // Quota exceeded or storage disabled. Silently degrade — heart
    // animates but doesn't persist. Better than throwing.
  }
}

/**
 * useFavorite(tripId) — returns [favorited, toggleFavorite].
 *
 * tripId is optional; falsy ids render as un-favorited and toggling
 * is a no-op. This lets TripDetails call the hook before its async
 * trip-by-slug lookup resolves without crashing.
 *
 * Re-syncs whenever the signed-in user changes (login/logout) so the
 * heart icon always reflects the right user's saved list.
 */
export function useFavorite(tripId) {
  const { user } = useAuth();
  const key = buildKey(user?.email);
  const [favorited, setFavorited] = useState(false);

  useEffect(() => {
    if (!tripId) { setFavorited(false); return; }
    setFavorited(readFavs(key).has(tripId));
  }, [tripId, key]);

  const toggleFavorite = useCallback((e) => {
    // Swallow row-level click bubbles — heart taps inside a Link card
    // would otherwise navigate to the trip details page.
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    if (!tripId) return;
    const favs = readFavs(key);
    if (favs.has(tripId)) {
      favs.delete(tripId);
      writeFavs(key, favs);
      setFavorited(false);
      toast("تمت الإزالة من المفضلة");
    } else {
      favs.add(tripId);
      writeFavs(key, favs);
      setFavorited(true);
      toast.success("تمت الإضافة للمفضلة ❤️");
    }
  }, [tripId, key]);

  return [favorited, toggleFavorite];
}
