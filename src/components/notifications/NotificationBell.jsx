import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, CheckCheck, Settings } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ensurePermission,
  showIncomingNotification,
} from "@/lib/pushNotifications";
import { getNotifTarget } from "@/lib/notificationRouting";
import { useNotificationActions } from "@/lib/useNotificationActions";

// Notification routing logic moved to src/lib/notificationRouting.js
// so the bell popup AND the full-page Notifications list use the
// same destination logic — they used to disagree, sending users to
// different places for identical notification rows. See the util's
// docstring for the full priority order.

// Icon per notification type
function NotifIcon({ type, title }) {
  const t = title || "";
  if (t.includes("تقييم")) return <span className="text-lg">⭐</span>;
  if (t.includes("حجز جديد") || t.includes("طلب حجز")) return <span className="text-lg">🎉</span>;
  if (t.includes("انطلقت")) return <span className="text-lg">🚗</span>;
  if (t.includes("اكتملت")) return <span className="text-lg">✅</span>;
  if (t.includes("إلغاء") || t.includes("ملغ")) return <span className="text-lg">❌</span>;
  if (type === "new_trip") return <span className="text-lg">🗺️</span>;
  return <span className="text-lg">🔔</span>;
}

export default function NotificationBell({ userEmail }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 60, left: 8, width: 340 });
  const btnRef = useRef(null);
  // popupRef points at the portaled motion.div. The outside-click
  // handler must check this in addition to btnRef — without it, every
  // click inside the popup is treated as "outside the bell" because
  // the popup is portaled to document.body (not nested inside the
  // bell button). That race closes the popup on mousedown/touchstart
  // BEFORE the row's onClick fires on click/touchend, which is why
  // most taps on the bell rows did nothing on mobile.
  const popupRef = useRef(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", userEmail],
    queryFn: () => userEmail
      ? api.entities.Notification.filter({ user_email: userEmail }, "-created_date", 20)
      : [],
    enabled: !!userEmail,
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Track the latest seen notification id so the realtime handler can decide
  // whether the inbound payload is genuinely new (vs. an echo of something we
  // already showed). useRef so updates don't re-run the realtime effect.
  const seenIdsRef = useRef(new Set());
  useEffect(() => {
    notifications.forEach(n => seenIdsRef.current.add(n.id));
  }, [notifications]);

  useEffect(() => {
    if (!userEmail) return;
    // Distinct channel from the entity-level subscribe so we get the row
    // payload directly — Notification.subscribe just invalidates the query
    // cache and doesn't expose the new row to us.
    const channel = supabase
      .channel(`notif-push-${userEmail}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_email=eq.${userEmail}`,
        },
        (payload) => {
          const row = payload?.new;
          if (!row) return;
          if (seenIdsRef.current.has(row.id)) return;
          seenIdsRef.current.add(row.id);
          // Refresh the inbox so the bell badge updates.
          qc.invalidateQueries({ queryKey: ["notifications", userEmail] });
          // Fire the toast / native banner. Click jumps to the right page.
          showIncomingNotification(row, {
            onClick: (n) => {
              const target = getNotifTarget(n);
              if (target) navigate(target);
            },
          });
        }
      )
      .subscribe();
    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, [userEmail, navigate, qc]);

  // Keep the older entity-level subscribe too for cache invalidation when an
  // INSERT goes through a path that doesn't hit the filtered channel above
  // (e.g. another tab marking-as-read causes UPDATEs we still want to reflect).
  useEffect(() => {
    if (!userEmail) return;
    const unsub = api.entities.Notification.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["notifications", userEmail] });
    });
    return () => unsub();
  }, [userEmail, qc]);

  // Mark-as-read / mark-all / delete actions are unified across surfaces.
  // The hook handles optimistic updates, rollback on RLS denial, and
  // cross-cache invalidation so the bell and the /notifications list
  // page can't disagree about which rows are read.
  const { markRead, markAllRead, removeNotif } = useNotificationActions(userEmail);

  // Close on outside click. Critical: both refs must be checked.
  // btnRef = the trigger button (not portaled). popupRef = the popup
  // motion.div (portaled to document.body via createPortal). A click
  // inside EITHER counts as "inside the bell" and should not close.
  // If we only checked btnRef, every tap on a notification row would
  // fire setOpen(false) on touchstart (the popup is outside btnRef
  // because it's in a portal), the popup would unmount before click
  // fires, and the row's onClick would never run.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      setOpen(false);
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
      const desiredWidth = isMobile
        ? Math.min(window.innerWidth - 32, 320)
        : 360;
      let left = rect.right - desiredWidth;
      left = Math.max(16, Math.min(left, window.innerWidth - desiredWidth - 16));
      setPos({ top: rect.bottom + 8, left, width: desiredWidth });
    }
    setOpen(v => {
      const next = !v;
      // Lazy ask for OS notification permission — only when the user actually
      // engages with the bell, never on first page load. ensurePermission() is
      // idempotent and self-throttling so it's safe to call on every open.
      if (next) {
        ensurePermission().catch(() => {});
      }
      return next;
    });
  };

  const handleNotifClick = (notif) => {
    if (!notif.is_read) markRead(notif.id);
    setOpen(false);
    const target = getNotifTarget(notif);
    // Null target = notification has no meaningful destination (e.g.
    // admin_broadcast). Just close the popup and stay where we are.
    if (target) navigate(target);
  };

  return (
    <div ref={btnRef}>
      <button onClick={handleToggle}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
        aria-label="الإشعارات">
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
              ref={popupRef}
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
                  <span className="font-bold text-sm">الإشعارات</span>
                  {unreadCount > 0 && (
                    <span className="bg-primary text-primary-foreground text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button onClick={() => markAllRead()}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground text-xs flex items-center gap-1"
                      title="تحديد الكل كمقروء">
                      <CheckCheck className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Link to="/notifications" onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-muted" title="الإعدادات">
                    <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                  </Link>
                  <button onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Notifications list */}
              <div className="max-h-80 overflow-y-auto divide-y divide-border/40">
                {notifications.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد إشعارات</p>
                    <Link to="/notifications" onClick={() => setOpen(false)}
                      className="text-xs text-primary mt-1 block hover:underline">
                      أضف مسارات للحصول على إشعارات
                    </Link>
                  </div>
                ) : notifications.map(notif => (
                  <div key={notif.id}
                    className={`flex items-center gap-3 px-3 py-3 hover:bg-muted/40 transition-colors cursor-pointer group ${!notif.is_read ? "bg-primary/5" : ""}`}
                    style={{ touchAction: "manipulation" }}
                    onClick={() => handleNotifClick(notif)}>

                    {/* Icon */}
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <NotifIcon type={notif.type} title={notif.title} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-tight truncate ${!notif.is_read ? "font-bold text-foreground" : "font-medium text-muted-foreground"}`}>
                        {notif.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {notif.message}
                      </p>
                    </div>

                    {/* Unread dot + delete.
                        The delete button used to be `opacity-0
                        group-hover:opacity-100` — invisible without
                        hover. On mobile (no hover state) the button
                        was permanently invisible BUT still occupied
                        space and stopped propagation, so taps on the
                        right edge of the row silently did nothing
                        because they were hitting an invisible
                        button. Now always at 50% opacity (visible
                        but unobtrusive), full opacity on hover. */}
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      {!notif.is_read && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeNotif(notif.id); }}
                        className="opacity-50 hover:opacity-100 p-1 rounded-lg hover:bg-muted transition-opacity"
                        aria-label="حذف">
                        <X className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div className="px-4 py-2.5 border-t border-border bg-muted/20 text-center">
                  <Link to="/notifications" onClick={() => setOpen(false)}
                    className="text-xs text-primary hover:underline">
                    عرض جميع الإشعارات وإدارة التفضيلات
                  </Link>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      , document.body)}
    </div>
  );
}
