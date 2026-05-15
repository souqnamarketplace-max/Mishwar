import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * useUnreadMessageCount — returns the count of unread messages for the
 * current user, kept live via a Supabase realtime subscription so the
 * badge updates the moment another user sends a message.
 *
 * Used by:
 *   - Navbar.jsx          (desktop header message icon)
 *   - MobileLayout.jsx    (mobile bottom-tabs الرسائل tab)
 *
 * Behaviour:
 *   - Returns 0 when no user (e.g. logged-out visitors)
 *   - Counts only messages where receiver_email = current user
 *     AND is_read = false
 *   - Subscribes to ANY change on messages WHERE receiver_email matches
 *     (INSERT for new message, UPDATE for read-flip, DELETE for cleanup)
 *     and invalidates the query, which re-runs the COUNT.
 *   - staleTime = 15s so we don't hammer the DB if the realtime channel
 *     misses an event for any reason.
 *   - Channel is per-user (`unread-msgs-${email}`) so multiple browser
 *     tabs don't subscribe under the same name and get conflicts.
 *
 * Returns: number (the unread count). Never throws — RLS errors silently
 * resolve to 0 so a transient query failure doesn't make the badge
 * disappear visibly.
 */
export function useUnreadMessageCount(userEmail) {
  const qc = useQueryClient();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["unread-messages-count", userEmail],
    queryFn: async () => {
      if (!userEmail) return 0;
      const { count, error } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("receiver_email", userEmail)
        .eq("is_read", false);
      // Silent fallback: a transient RLS hiccup shouldn't make the
      // badge flicker or disappear. We log to console in dev so the
      // problem is still visible during development.
      if (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[useUnreadMessageCount] count error:", error);
        }
        return 0;
      }
      return count || 0;
    },
    enabled: !!userEmail,
    staleTime: 15000,
  });

  // Realtime — bumps the count up on INSERT (new message arrived) and
  // back down on UPDATE (recipient opened the conversation, flipping
  // is_read=true). Subscribing on `*` covers all three event types
  // (INSERT/UPDATE/DELETE) with one filter.
  useEffect(() => {
    if (!userEmail) return;
    const channel = supabase
      .channel(`unread-msgs-${userEmail}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `receiver_email=eq.${userEmail}`,
        },
        () => qc.invalidateQueries({ queryKey: ["unread-messages-count", userEmail] })
      )
      .subscribe();
    return () => {
      try { supabase.removeChannel(channel); } catch { /* channel already torn down */ }
    };
  }, [userEmail, qc]);

  return unreadCount;
}
