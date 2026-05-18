// Driver favorites — server-side via the favorite_drivers table (mig 076).
//
// Distinct from trip favorites (lib/favorites.js) which use localStorage:
// driver favorites are needed by SearchTrips to filter the trip list to
// "only my favorite drivers", which requires .in('driver_email', [favs])
// on the server. localStorage favorites would force fetching all trips
// and filtering client-side — fine at 50 trips, painful at 5000.
//
// Driver favorites are also more stable than trip favorites: a trip you
// favorited 6 months ago is meaningless, but a driver you trust 6 months
// ago is still the same person. The longevity justifies the server cost.
//
// API:
//   useFavoriteDrivers()
//     → { favoriteSet, isFavorite, toggleFavorite, count, isLoading }
//
//   useIsFavoriteDriver(driverEmail)
//     → [isFavorite, toggleFavorite]
//
// The hooks are designed so a component can either:
//   (a) get the full set + helpers once at the parent level (cheap, one query)
//   (b) ask "is this one driver favorited" without caring about the set
//
// Both pathways share the same react-query cache key so one toggle
// updates every consumer's view automatically.

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";

const QUERY_KEY = ["favorite-drivers"];

/**
 * useFavoriteDrivers — full hook for components that need the whole set.
 *
 * Used by SearchTrips to apply the "only favorites" filter and by
 * Favorites page (future) for listing.
 *
 * Returns:
 *   favoriteSet  — Set<string> of driver_email strings the user has favorited
 *   isFavorite   — (driverEmail) => boolean lookup helper
 *   toggleFavorite — (driverEmail) => void; optimistic, single-tap
 *   count        — number; favoriteSet.size, exposed as a convenience
 *   isLoading    — true on initial fetch
 */
export function useFavoriteDrivers() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Fetch the list of driver_emails this passenger has favorited.
  // We don't need any other column from favorite_drivers — created_at
  // could be useful for "sort by recently favorited" later, but for
  // now Set<email> is enough.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      if (!user?.email) return [];
      const { data, error } = await supabase
        .from("favorite_drivers")
        .select("driver_email")
        .eq("passenger_email", user.email);
      // RLS would catch this anyway, but the explicit .eq() lets the
      // query planner use the PK index directly without an extra
      // policy-check filter.
      if (error) throw error;
      return data || [];
    },
    // Only authenticated users have favorites. Anonymous viewers can
    // still call the hook (it returns an empty set) without firing
    // a 401 against the API.
    enabled: !!user?.email,
    // 5 minutes — favorites change rarely, no need to refetch on
    // every page navigation. Optimistic updates handle the instant-feedback
    // case so users never see stale data after their own action.
    staleTime: 5 * 60 * 1000,
  });

  // Set lookup is O(1) — much faster than scanning the array on
  // every TripCard render in a 500-card list.
  const favoriteSet = useMemo(
    () => new Set(rows.map(r => r.driver_email)),
    [rows]
  );

  // The mutation does INSERT … ON CONFLICT DO NOTHING for favorites
  // and DELETE for unfavorites. We optimistically update the cache so
  // the heart fills/empties instantly; if the server call fails we
  // revert + show a toast.
  const toggleMut = useMutation({
    mutationFn: async ({ driverEmail, currentlyFav }) => {
      if (!user?.email) {
        throw new Error("يجب تسجيل الدخول لإضافة سائق للمفضلة");
      }
      if (currentlyFav) {
        const { error } = await supabase
          .from("favorite_drivers")
          .delete()
          .eq("passenger_email", user.email)
          .eq("driver_email", driverEmail);
        if (error) throw error;
        return { added: false };
      } else {
        // INSERT bypasses ON CONFLICT explicitly because the PK
        // constraint would error out on duplicate keys — but with
        // our optimistic update + 5min stale time, the user shouldn't
        // be able to double-favorite anyway. If somehow it does happen
        // (two tabs racing), we catch and treat as success.
        const { error } = await supabase
          .from("favorite_drivers")
          .insert({ passenger_email: user.email, driver_email: driverEmail });
        if (error) {
          // 23505 = unique_violation. Means already-favorited, which
          // is the desired end state, so don't surface as error.
          if (error.code !== "23505") throw error;
        }
        return { added: true };
      }
    },
    // Optimistic — flip the cache immediately. If the mutation fails,
    // onError restores the snapshot.
    onMutate: async ({ driverEmail, currentlyFav }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev = qc.getQueryData(QUERY_KEY);
      qc.setQueryData(QUERY_KEY, (old = []) => {
        if (currentlyFav) {
          return old.filter(r => r.driver_email !== driverEmail);
        } else {
          return [...old, { driver_email: driverEmail }];
        }
      });
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(QUERY_KEY, ctx?.prev);
      toast.error(err?.message || "تعذر حفظ التفضيل");
    },
    onSuccess: ({ added }) => {
      toast.success(added ? "تمت إضافة السائق للمفضلة ❤️" : "تمت الإزالة من المفضلة");
    },
    onSettled: () => {
      // Re-fetch to reconcile with server truth — covers the edge case
      // where two devices favorited/unfavorited near-simultaneously and
      // optimistic state diverges from reality.
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const isFavorite = useCallback(
    (driverEmail) => favoriteSet.has(driverEmail),
    [favoriteSet]
  );

  const toggleFavorite = useCallback(
    (driverEmail) => {
      if (!driverEmail) return;
      // Anonymous viewers — surface a friendly prompt instead of failing
      // silently in the mutation. Better UX than a generic error toast.
      if (!user?.email) {
        toast.error("يجب تسجيل الدخول لإضافة سائق للمفضلة");
        return;
      }
      toggleMut.mutate({ driverEmail, currentlyFav: favoriteSet.has(driverEmail) });
    },
    [user?.email, favoriteSet, toggleMut]
  );

  return {
    favoriteSet,
    isFavorite,
    toggleFavorite,
    count: favoriteSet.size,
    isLoading,
  };
}

/**
 * useIsFavoriteDriver — single-driver convenience hook.
 *
 * Used inside TripCard so each card can render its driver's heart
 * without the parent needing to thread the whole set down. Internally
 * delegates to useFavoriteDrivers so the cache is shared — even if
 * 50 TripCards each call this hook, they share ONE underlying query.
 *
 * Returns [isFavorite, toggleFavorite] in the same shape as useFavorite
 * for trip-bookmark API consistency, making the call site readable.
 */
export function useIsFavoriteDriver(driverEmail) {
  const { isFavorite, toggleFavorite } = useFavoriteDrivers();
  const fav = isFavorite(driverEmail);
  const toggle = useCallback(
    (e) => {
      // Swallow row-level click bubbles — heart taps inside a Link
      // card would otherwise navigate to trip details.
      if (e?.preventDefault) e.preventDefault();
      if (e?.stopPropagation) e.stopPropagation();
      toggleFavorite(driverEmail);
    },
    [driverEmail, toggleFavorite]
  );
  return [fav, toggle];
}
