// Helper for managing user blocks across the app.
// Caches the list of blocked emails per session for fast filtering.

import { base44 } from "@/api/base44Client";

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
      base44.entities.UserBlock.filter({ blocker_email: myEmail }, "-created_at", 500),
      base44.entities.UserBlock.filter({ blocked_email: myEmail }, "-created_at", 500),
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
