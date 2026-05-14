/**
 * useNotificationActions — single source of truth for marking notifications
 * as read / unread / deleted from any surface (bell popup, full list page,
 * push-tap handler, etc.).
 *
 * Why centralize: previously the bell and the list-page both implemented
 * mark-as-read separately, with slightly different cache-invalidation logic
 * and inconsistent failure handling. The bell used react-query's optimistic
 * `onMutate`; the list page did a fire-and-forget `await` inside an inline
 * onClick that swallowed RLS denials. Result: read-state could appear in
 * one surface and not the other, and a user tapping a notification on the
 * list page sometimes still saw it as unread after navigation.
 *
 * This hook:
 *   1. Issues an optimistic update across every cached query key that
 *      tracks notifications, so the badge / bold style flips instantly on
 *      both bell and list before the server round-trip.
 *   2. Uses `.select()` after `.update()` so we receive the affected rows
 *      and can detect silent RLS no-ops (Supabase returns an empty array
 *      instead of throwing when an RLS USING clause filters all rows out).
 *   3. Rolls back the optimistic update if the server returned zero rows
 *      or threw, so the UI doesn't lie about state.
 *   4. Re-invalidates the active query so any out-of-band changes from
 *      Realtime sync are pulled in.
 *
 * Usage:
 *   const { markRead, markAllRead, removeNotif } = useNotificationActions(userEmail);
 *   markRead(notif.id);          // fire-and-forget; UI updates instantly
 *   await markRead(notif.id);    // optional await if you need to block on success
 */

import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/sentry";

export function useNotificationActions(userEmail) {
  const qc = useQueryClient();

  // Every cache key the app uses for notification lists. Keep this list
  // in sync with all useQuery({ queryKey: [...] }) declarations. Missing
  // a key here means that surface won't optimistically update.
  const cacheKeys = [
    ["notifications", userEmail],
    ["notifications"],            // generic fallback some surfaces use
    ["admin-notifications"],      // admin dashboard
  ];

  // Apply a transform to the cached notifications array across every key.
  const patchCache = (predicate, patch) => {
    cacheKeys.forEach((key) => {
      qc.setQueryData(key, (old) =>
        Array.isArray(old)
          ? old.map((n) => (predicate(n) ? { ...n, ...patch } : n))
          : old
      );
    });
  };

  const filterCache = (predicate) => {
    cacheKeys.forEach((key) => {
      qc.setQueryData(key, (old) =>
        Array.isArray(old) ? old.filter((n) => !predicate(n)) : old
      );
    });
  };

  const invalidateAll = () => {
    cacheKeys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
  };

  /**
   * Mark one notification as read. Returns true if the server actually
   * updated a row, false if RLS silently denied or the row was already
   * read. Always optimistically updates the UI first.
   */
  const markRead = async (id) => {
    if (!id) return false;
    // Optimistic flip — UI shows the read state instantly.
    patchCache((n) => n.id === id, { is_read: true });

    try {
      // .select() returns the affected rows so we can detect silent
      // RLS no-ops. Supabase doesn't throw on RLS denial — it just
      // returns an empty array. Without .select() we'd think it worked.
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id)
        .select("id");

      if (error) throw error;

      // Zero rows affected — RLS denied the update. Roll back so the
      // unread style returns and the user can try again.
      if (!data || data.length === 0) {
        patchCache((n) => n.id === id, { is_read: false });
        captureException(new Error("notif markRead: 0 rows affected"), {
          extra: { id, userEmail },
        });
        return false;
      }

      // Don't invalidate here — invalidation refetches from server and
      // races with optimistic state. We trust our optimistic update; the
      // Realtime subscription on the bell will pull any out-of-band
      // changes within a few hundred ms.
      return true;
    } catch (err) {
      patchCache((n) => n.id === id, { is_read: false });
      captureException(err, { msg: "notif markRead error", extra: { id } });
      return false;
    }
  };

  /**
   * Mark every unread notification visible in the current cache as read.
   * Single bulk UPDATE so we don't fan out N requests.
   */
  const markAllRead = async () => {
    const cached = qc.getQueryData(["notifications", userEmail]);
    const unread = Array.isArray(cached) ? cached.filter((n) => !n.is_read) : [];
    if (unread.length === 0) return true;

    const ids = unread.map((n) => n.id);
    // Optimistic — flip them all instantly.
    patchCache((n) => ids.includes(n.id), { is_read: true });

    try {
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", ids)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        // Roll back everything
        patchCache((n) => ids.includes(n.id), { is_read: false });
        return false;
      }
      invalidateAll();
      return true;
    } catch (err) {
      patchCache((n) => ids.includes(n.id), { is_read: false });
      captureException(err, { msg: "notif markAllRead error" });
      return false;
    }
  };

  /**
   * Delete a notification. Optimistically removes from every cached list.
   */
  const removeNotif = async (id) => {
    if (!id) return false;
    // Snapshot for rollback
    const snapshots = cacheKeys.map((key) => ({
      key, data: qc.getQueryData(key),
    }));
    filterCache((n) => n.id === id);

    try {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return true;
    } catch (err) {
      // Roll back every cache
      snapshots.forEach(({ key, data }) => qc.setQueryData(key, data));
      captureException(err, { msg: "notif delete error", extra: { id } });
      return false;
    }
  };

  return { markRead, markAllRead, removeNotif };
}
