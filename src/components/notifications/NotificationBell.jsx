import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, Check, CheckCheck, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

const typeConfig = {
  new_trip:   { dot: "bg-primary" },
  price_drop: { dot: "bg-green-500" },
  date_match: { dot: "bg-accent" },
  system:     { dot: "bg-muted-foreground" },
};

export default function NotificationBell({ userEmail }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 64, right: 8 });
  const ref = useRef(null);
  const btnRef = useRef(null);
  const qc = useQueryClient();

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
      await Promise.all(notifications.filter(n => !n.is_read)
        .map(n => base44.entities.Notification.update(n.id, { is_read: true })));
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
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
        aria-label="الإشعارات"
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-destructive rounded-full text-[9px] text-white flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown — always fixed below header, full width on mobile */}
      <AnimatePresence>
        {open && createPortal(
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[9990]"
              onClick={() => setOpen(false)}
            />
            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="fixed top-[57px] right-2 left-2 sm:left-auto sm:right-4 sm:w-80 bg-card border border-border rounded-2xl shadow-2xl z-[9991] overflow-hidden"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-sm">الإشعارات</h3>
                  {unreadCount > 0 && (
                    <span className="bg-destructive text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button onClick={() => markAllRead.mutate()}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="تحديد الكل">
                      <CheckCheck className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Link to="/notifications" onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-muted">
                    <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                  </Link>
                  <button onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-muted">
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد إشعارات</p>
                    <Link to="/notifications" onClick={() => setOpen(false)}
                      className="text-xs text-primary mt-1 block hover:underline">
                      أضف مسارات مفضلة
                    </Link>
                  </div>
                ) : notifications.map(notif => {
                  const cfg = typeConfig[notif.type] || typeConfig.system;
                  return (
                    <div key={notif.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 ${!notif.is_read ? "bg-primary/5" : ""}`}>
                      <div className={`w-2 h-2 rounded-full ${cfg.dot} mt-1.5 shrink-0 ${notif.is_read ? "opacity-30" : ""}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-tight ${notif.is_read ? "text-muted-foreground" : "text-foreground"}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{notif.message}</p>
                        {notif.trip_id && (
                          <Link to={`/trip/${notif.trip_id}`}
                            onClick={() => { markRead.mutate(notif.id); setOpen(false); }}
                            className="text-xs text-primary mt-1 hover:underline inline-block">
                            عرض الرحلة ←
                          </Link>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {!notif.is_read && (
                          <button onClick={() => markRead.mutate(notif.id)}
                            className="p-1 rounded hover:bg-muted">
                            <Check className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                        <button onClick={() => deleteNotif.mutate(notif.id)}
                          className="p-1 rounded hover:bg-muted">
                          <X className="w-3 h-3 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {notifications.length > 0 && (
                <div className="p-3 border-t border-border text-center">
                  <Link to="/notifications" onClick={() => setOpen(false)}
                    className="text-xs text-primary hover:underline">
                    إدارة تفضيلات الإشعارات
                  </Link>
                </div>
              )}
            </motion.div>
          </>,
          document.body
        )}
      </AnimatePresence>
    </div>
  );
}
