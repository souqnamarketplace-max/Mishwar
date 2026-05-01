import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, CheckCheck, Settings } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

// Determine where each notification should navigate
function getNotifTarget(notif) {
  const t = notif.title || "";
  const type = notif.type || "system";

  if (notif.trip_id) {
    // Booking requests → driver dashboard
    if (t.includes("حجز جديد") || t.includes("طلب حجز")) return "/driver?tab=passengers";
    // Trip started/completed for passenger → my trips
    if (t.includes("انطلقت") || t.includes("اكتملت") || t.includes("قيّم السائق")) return "/my-trips";
    // New trip match → trip details
    if (type === "new_trip") return `/trip/${notif.trip_id}`;
    // Rating received → driver ratings
    if (t.includes("تقييم جديد")) return "/driver?tab=ratings";
    // Default with trip_id → trip details
    return `/trip/${notif.trip_id}`;
  }
  // No trip_id
  if (t.includes("تقييم")) return "/driver?tab=ratings";
  if (t.includes("حجز")) return "/my-trips";
  return "/notifications";
}

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
  const [pos, setPos] = useState({ top: 60, right: 8 });
  const btnRef = useRef(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", userEmail],
    queryFn: () => userEmail
      ? base44.entities.Notification.filter({ user_email: userEmail }, "-created_date", 20)
      : [],
    enabled: !!userEmail,
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  useEffect(() => {
    if (!userEmail) return;
    const unsub = base44.entities.Notification.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["notifications", userEmail] });
    });
    return () => unsub();
  }, [userEmail]);

  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Notification.update(id, { is_read: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userEmail] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter(n => !n.is_read);
      await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { is_read: true })));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userEmail] }),
  });

  const deleteNotif = useMutation({
    mutationFn: (id) => base44.entities.Notification.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userEmail] }),
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
      setPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right - 4) });
    }
    setOpen(v => !v);
  };

  const handleNotifClick = (notif) => {
    markRead.mutate(notif.id);
    setOpen(false);
    navigate(getNotifTarget(notif));
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
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              style={{
                position: "fixed",
                top: pos.top,
                right: pos.right,
                width: Math.min(340, window.innerWidth - 16),
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
                    <button onClick={() => markAllRead.mutate()}
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

                    {/* Unread dot + delete */}
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      {!notif.is_read && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteNotif.mutate(notif.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-muted transition-opacity"
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
