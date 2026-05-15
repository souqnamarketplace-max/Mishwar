// Helper for managing user blocks across the app.
// Caches the list of blocked emails per session for fast filtering.

import { api } from "@/api/apiClient";

let _cache = null;
let _cacheEmail = null;

/**
 * Returns a Set<email> of all users involved in a block with the current user
 * (either blocker_email = me or blocked_email = me).
 *
 * Cached for the session — call invalidateBlockCache() after a block/unblock.
 */
export async function getBlockedEmails(myEmail) {
  if (!myEmail) return new Set();
  if (_cache && _cacheEmail === myEmail) return _cache;

  try {
    const [iBlocked, blockedMe] = await Promise.all([
      api.entities.UserBlock.filter({ blocker_email: myEmail }, "-created_at", 500),
      api.entities.UserBlock.filter({ blocked_email: myEmail }, "-created_at", 500),
    ]);
    const set = new Set();
    (iBlocked || []).forEach(b => set.add(b.blocked_email));
    (blockedMe || []).forEach(b => set.add(b.blocker_email));
    _cache = set;
    _cacheEmail = myEmail;
    return set;
  } catch (e) {
    console.warn("getBlockedEmails failed", e);
    return new Set();
  }
}

export function invalidateBlockCache() {
  _cache = null;
  _cacheEmail = null;
}

/** Filter an array of items, removing any whose email field is in blocked set */
export function filterByBlocks(items, blockedSet, emailField = "driver_email") {
  if (!blockedSet || blockedSet.size === 0) return items;
  return (items || []).filter(item => !blockedSet.has(item[emailField]));
}

export const REPORT_CATEGORIES = [
  { id: "harassment",    label: "تحرش / إساءة" },
  { id: "inappropriate", label: "سلوك غير لائق" },
  { id: "scam",          label: "احتيال / خداع" },
  { id: "safety",        label: "مخاوف تتعلق بالسلامة" },
  { id: "other",         label: "أخرى" },
];


// ─────────────────────────────────────────────────────────────
// React hook: returns Set<email> of users involved in blocks
// with the current user. Cached via React Query for the session.
// Use with filterByBlocks() to drop blocked users from any list:
//
//   const { data: trips = [] } = useQuery({...});
//   const blockedSet = useBlockedEmails();
//   const visibleTrips = useMemo(
//     () => filterByBlocks(trips, blockedSet, "driver_email"),
//     [trips, blockedSet]
//   );
// ─────────────────────────────────────────────────────────────
import { useQuery as _useQuery } from "@tanstack/react-query";
import { useAuth as _useAuth } from "@/lib/AuthContext";

export function useBlockedEmails() {
  const { user } = _useAuth();
  const { data } = _useQuery({
    queryKey: ["my-blocks", user?.email],
    queryFn: () => getBlockedEmails(user?.email),
    enabled: !!user?.email,
    staleTime: 60_000, // 1 minute
  });
  return data || new Set();
}
