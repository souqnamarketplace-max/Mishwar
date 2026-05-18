import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * useUnreadReleaseNotes — returns the number of release notes the
 * current user hasn't yet seen. Drives the red badge on the sparkle
 * icon in Navbar / MobileLayout.
 *
 * Backed by the unread_release_notes_count() RPC (migration 083).
 * The RPC is STABLE and SECURITY DEFINER, so:
 *   - It can be called from anonymous sessions (returns 0)
 *   - Reads are cheap (postgres caches function results within a
 *     transaction)
 *
 * Polling: refetches on window focus + every 5 minutes. We don't
 * use supabase realtime here — release notes are admin-authored
 * and infrequent. A 5min cadence is plenty for "you have a new
 * announcement" UX, and it doesn't burn realtime bandwidth.
 *
 * Returns 0 when:
 *   - User is anonymous
 *   - RPC errors (network, RLS, etc.) — fail-quiet
 *   - Migration 083 hasn't been applied yet (RPC missing → throws,
 *     caught by useQuery, treated as no-data → 0)
 */
export function useUnreadReleaseNotes(userEmail) {
  const { data } = useQuery({
    queryKey: ["unread-release-notes-count", userEmail || "anon"],
    queryFn: async () => {
      if (!userEmail) return 0;
      const { data, error } = await supabase.rpc("unread_release_notes_count");
      if (error) {
        // If the RPC doesn't exist yet (mig 083 not applied), or any
        // other failure, silently return 0 rather than showing a
        // misleading badge or breaking the navbar.
        return 0;
      }
      return Number(data) || 0;
    },
    enabled: !!userEmail,
    staleTime: 60 * 1000,            // 1 min
    refetchInterval: 5 * 60 * 1000,  // 5 min
    refetchOnWindowFocus: true,
    retry: false,
  });
  return data || 0;
}
