/**
 * useAllCities — single source of truth for the city autocomplete dropdown.
 *
 * Returns a sorted, deduplicated array merging three sources:
 *   1. CITIES (already a union of the curated list + CITY_COORDS keys)
 *   2. Every distinct from_city / to_city / stop in the live trips table
 *
 * Source 2 is what makes user-added cities — typed by drivers when posting a
 * trip but never added to either static list — show up in search & post-trip
 * autocomplete. Result is cached for 5 minutes via react-query so this is
 * essentially free after the first load.
 *
 * Usage:
 *   const allCities = useAllCities();
 *   const options = allCities.map(c => ({ value: c, label: c }));
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { CITIES } from "@/lib/cities";

export function useAllCities() {
  const { data: dbCities = [] } = useQuery({
    queryKey: ["all-trip-cities"],
    queryFn: async () => {
      // Pull only the city columns from active trips. Limit 1000 covers any
      // realistic active-trip volume; the dedupe in the consumer handles the
      // overlap with the static list.
      const { data, error } = await supabase
        .from("trips")
        .select("from_city, to_city, stops")
        .in("status", ["confirmed", "in_progress"])
        .limit(1000);
      if (error) return [];
      const set = new Set();
      for (const t of data || []) {
        if (t.from_city) set.add(t.from_city);
        if (t.to_city) set.add(t.to_city);
        if (Array.isArray(t.stops)) {
          for (const s of t.stops) {
            if (s && typeof s === "object" && s.city) set.add(s.city);
          }
        }
      }
      return [...set];
    },
    staleTime: 5 * 60 * 1000, // 5 min — cities change rarely
    retry: 1,
  });

  return useMemo(() => {
    const set = new Set(CITIES);
    for (const c of dbCities) {
      if (typeof c === "string" && c.trim()) set.add(c.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [dbCities]);
}

export default useAllCities;
