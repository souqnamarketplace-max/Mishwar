/**
 * AdminNotificationBell — dashboard-only notification bell for the admin.
 *
 * Why a separate component from NotificationBell:
 *
 * NotificationBell (used in Navbar/MobileLayout for consumer users) calls
 * `api.entities.Notification.subscribe(...)` which sets up a Supabase
 * realtime channel with a NON-user-scoped name (`notifications-realtime`).
 * When the consumer NotificationBell and the dashboard's admin bell both
 * mount at the same time (both AppLayout chrome AND the dashboard top bar
 * render simultaneously when admin visits /dashboard), the second subscribe
 * call's cleanup-then-resubscribe race against the first one's still-active
 * channel — Supabase's `client.channel(name)` returns the SAME channel
 * reference for the same name, and the second mount's `removeChannel(...)`
 * tears down the first mount's subscription mid-lifecycle. This race
 * manifested as a render-time crash in the dashboard.
 *
 * This component:
 *   1. Skips the entity-level subscribe entirely (no channel name collision)
 *   2. Uses a dedicated user-scoped realtime channel (`admin-bell-${email}`)
 *      that won't collide with the consumer bell's `notif-push-${email}`
 *   3. Adds a polling fallback (30s) so even if realtime drops, admin sees
 *      new notifications within half a minute — admin notifications are
 *      not millisecond-critical
 *   4. Has the same look & feel and target-routing logic as the consumer
 *      bell, so admins get a consistent UX
 *
 * Renders nothing if there's no userEmail (admin not yet loaded). All
 * hooks run unconditionally so React's hooks-rules are honored.
 */
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, CheckCheck } from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { formatArabicDate } from "@/lib/validation";

// Where each notification should navigate when clicked. For admin this
// is mostly the dashboard tab that lists the relevant entity.
function getAdminNotifTarget(notif) {
  const t = notif.title || "";
  if (t.includes("اشتراك"))     return "/dashboard?tab=subscriptions";
  if (t.includes("بلاغ"))        return "/dashboard?tab=reports";
  if (t.includes("رخصة"))        return "/dashboard?tab=licenses";
  if (t.includes("مدينة"))       return "/dashboard?tab=cities";
  if (t.includes("شكوى") ||
      t.includes("اقتراح") ||
      t.includes("إشادة"))       return "/dashboard?tab=feedback";
  if (t.includes("تقييم منخفض")) return "/dashboard?tab=reviews";
  return "/dashboard?tab=notifications";
}

// Icon per admin notification type, picked off the title's emoji prefix.
function getNotifEmoji(notif) {
  const t = notif.title || "";
  // Admin titles use emoji prefixes — extract first emoji
  const match = t.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}])/u);
  return match ? match[1] : "🔔";
}

export default function AdminNotificationBell({ userEmail }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 60, left: 8, width: 360 });
  const btnRef = useRef(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Fetch with a polling fallback. 30s is plenty for admin — they're not
  // refreshing every second. Realtime (when it works) gives instant updates;
  // polling guarantees eventual consistency even if the channel drops.
  const { data: notifications = [] } = useQuery({
    queryKey: ["admin-bell-notifications", userEmail],
    queryFn: async () => {
      if (!userEmail) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_email", userEmail)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return data || [];
    },
    enabled: !!userEmail,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Realtime channel — DEDICATED name, separate from anything the consumer
  // bell uses, so the two don't collide on shared channel state. We also
  // do NOT call api.entities.Notification.subscribe (which uses the
  // global non-scoped `notifications-realtime` channel that races with
  // the consumer bell when both are mounted).
  useEffect(() => {
    if (!userEmail) return;
    let channel;
    try {
      channel = supabase
        .channel(`admin-bell-${userEmail}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_email=eq.${userEmail}`,
          },
          () => qc.invalidateQueries({ queryKey: ["admin-bell-notifications", userEmail] })
        )
        .subscribe();
    } catch (e) {
      // Realtime is best-effort — polling handles eventual consistency.
      console.warn("[AdminBell] realtime subscribe failed:", e?.message);
    }
    return () => {
      try { if (channel) supabase.removeChannel(channel); } catch {}
    };
  }, [userEmail, qc]);

  const markRead = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["admin-bell-notifications", userEmail] });
      const prev = qc.getQueryData(["admin-bell-notifications", userEmail]);
      qc.setQueryData(["admin-bell-notifications", userEmail], (old) =>
        Array.isArray(old) ? old.map(n => n.id === id ? { ...n, is_read: true } : n) : old
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-bell-notifications", userEmail], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin-bell-notifications", userEmail] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.is_read);
      if (unread.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", unread.map(n => n.id));
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-bell-notifications", userEmail] }),
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const handleToggle = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const isMobile = window.innerWidth < 640;
      const desiredWidth = isMobile ? Math.min(window.innerWidth - 32, 320) : 380;
      let left = rect.right - desiredWidth;
      left = Math.max(16, Math.min(left, window.innerWidth - desiredWidth - 16));
      setPos({ top: rect.bottom + 8, left, width: desiredWidth });
    }
    setOpen(v => !v);
  };

  const handleNotifClick = (notif) => {
    if (!notif.is_read) markRead.mutate(notif.id);
    setOpen(false);
    navigate(getAdminNotifTarget(notif));
  };

  // Don't render anything until user is loaded — avoids the brief
  // empty-userEmail render that some hooks libraries get cranky about.
  if (!userEmail) return null;

  return (
    <div ref={btnRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
        aria-label="إشعارات الإدارة"
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-destructive rounded-full text-[9px] text-white flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: pos.width,
                zIndex: 9999,
              }}
              className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  <span className="font-bold text-sm">إشعارات الإدارة</span>
                  {unreadCount > 0 && (
                    <span className="bg-primary text-primary-foreground text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      onClick={() => markAllRead.mutate()}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                      title="تحديد الكل كمقروء"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Link
                    to="/dashboard?tab=notifications"
                    onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground text-xs"
                    title="عرض الكل"
                  >
                    عرض الكل
                  </Link>
                </div>
              </div>

              {/* List */}
              <div className="max-h-[60vh] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-10 text-center">
                    <Bell className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد إشعارات</p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotifClick(notif)}
                      className={`w-full text-right px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/30 flex items-start gap-2.5 ${
                        !notif.is_read ? "bg-primary/5" : ""
                      }`}
                    >
                      <span className="text-lg shrink-0 mt-0.5">{getNotifEmoji(notif)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm ${!notif.is_read ? "font-bold" : ""} truncate`}>
                            {notif.title?.replace(/^[^\s]+\s/, "") || "إشعار"}
                          </p>
                          {!notif.is_read && (
                            <span className="w-2 h-2 bg-primary rounded-full shrink-0 mt-1.5" />
                          )}
                        </div>
                        {notif.message && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notif.message}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {formatArabicDate(notif.created_at)}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
