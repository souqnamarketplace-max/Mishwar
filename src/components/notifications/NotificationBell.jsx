import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, MapPin, ArrowLeft, X, Check, CheckCheck, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

const typeConfig = {
  new_trip:   { color: "bg-primary/10 text-primary", dot: "bg-primary" },
  price_drop: { color: "bg-green-500/10 text-green-600", dot: "bg-green-500" },
  date_match: { color: "bg-accent/10 text-accent", dot: "bg-accent" },
  system:     { color: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

export default function NotificationBell({ userEmail }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", userEmail],
    queryFn: () =>
      userEmail
        ? base44.entities.Notification.filter({ user_email: userEmail }, "-created_date", 20)
        : [],
    enabled: !!userEmail,
    refetchInterval: 30000,
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Notification.update(id, { is_read: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userEmail] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter((n) => !n.is_read);
      await Promise.all(unread.map((n) => base44.entities.Notification.update(n.id, { is_read: true })));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userEmail] }),
  });

  const deleteNotif = useMutation({
    mutationFn: (id) => base44.entities.Notification.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userEmail] }),
  });

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
       aria-label="فتح الإشعارات">
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-destructive rounded-full text-[9px] text-white flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-12 w-80 bg-card border border-border rounded-2xl shadow-xl z-50 overflow-hidden"
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
                  <button
                    onClick={() => markAllRead.mutate()}
                    className="p-1.5 rounded-lg hover:bg-muted text-xs text-muted-foreground flex items-center gap-1"
                    title="تحديد الكل كمقروء"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                  </button>
                )}
                <Link
                  to="/notifications"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-muted"
                  title="إعدادات الإشعارات"
                >
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                </Link>
              </div>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">لا توجد إشعارات</p>
                  <Link
                    to="/notifications"
                    onClick={() => setOpen(false)}
                    className="text-xs text-primary mt-1 block hover:underline"
                  >
                    أضف مسارات مفضلة للحصول على إشعارات
                  </Link>
                </div>
              ) : (
                notifications.map((notif) => {
                  const cfg = typeConfig[notif.type] || typeConfig.system;
                  return (
                    <div
                      key={notif.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors ${!notif.is_read ? "bg-primary/3" : ""}`}
                    >
                      <div className={`w-2 h-2 rounded-full ${cfg.dot} mt-1.5 shrink-0 ${notif.is_read ? "opacity-30" : ""}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-tight ${notif.is_read ? "text-muted-foreground" : "text-foreground"}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{notif.message}</p>
                        {notif.trip_id && (
                          <Link
                            to={`/trip/${notif.trip_id}`}
                            onClick={() => { markRead.mutate(notif.id); setOpen(false); }}
                            className="text-xs text-primary mt-1 hover:underline inline-block"
                          >
                            عرض الرحلة ←
                          </Link>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {!notif.is_read && (
                          <button
                            onClick={() => markRead.mutate(notif.id)}
                            className="p-1 rounded hover:bg-muted"
                            title="تحديد كمقروء"
                          >
                            <Check className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                        <button
                          onClick={() => deleteNotif.mutate(notif.id)}
                          className="p-1 rounded hover:bg-muted"
                          aria-label="حذف الإشعار"
                          title="حذف الإشعار"
                        >
                          <X className="w-3 h-3 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {notifications.length > 0 && (
              <div className="p-3 border-t border-border text-center">
                <Link
                  to="/notifications"
                  onClick={() => setOpen(false)}
                  className="text-xs text-primary hover:underline"
                >
                  إدارة تفضيلات الإشعارات
                </Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}