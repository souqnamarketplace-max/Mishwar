import React, { useState, useRef, useEffect } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { Home, Search, Plus, Bell, User, Heart, ArrowRight, ChevronLeft, Car, Map } from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// ─── Tab definitions per role ───────────────────────────────────────────────

// For drivers/both — center FAB = "أنشر رحلة", right slot = "لوحتي"
const TABS_DRIVER = [
  { id: "home",    label: "الرئيسية", icon: Home,   path: "/" },
  { id: "search",  label: "بحث",      icon: Search, path: "/search" },
  { id: "create",  label: "أنشر",     icon: Plus,   path: "/create-trip", isAction: true },
  { id: "driver",  label: "لوحتي",    icon: Car,    path: "/driver" },
  { id: "profile", label: "حسابي",    icon: User,   path: "/profile" },
];

// For passengers — no FAB, show my-trips and favorites
const TABS_PASSENGER = [
  { id: "home",      label: "الرئيسية", icon: Home,   path: "/" },
  { id: "search",    label: "بحث",      icon: Search, path: "/search" },
  { id: "mytrips",   label: "رحلاتي",   icon: Map,    path: "/my-trips" },
  { id: "favorites", label: "المفضلة",  icon: Heart,  path: "/favorites" },
  { id: "profile",   label: "حسابي",    icon: User,   path: "/profile" },
];

function getVisibleTabs(user) {
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";
  return isDriver ? TABS_DRIVER : TABS_PASSENGER;
}

// Pages that hide the bottom nav
const HIDE_NAV_PATHS = ["/onboarding", "/login", "/booking-confirmation"];

// Pages that show a back button in the header
const BACK_BUTTON_PATHS = [
  "/trip/", "/create-trip", "/settings", "/help", "/about", "/blog",
  "/safety", "/my-trips", "/favorites", "/messages", "/notifications",
  "/profile", "/driver", "/how-it-works", "/community", "/booking-confirmation",
];

const PAGE_TITLES = {
  "/": "مِشوار",
  "/search": "ابحث عن رحلة",
  "/my-trips": "رحلاتي",
  "/create-trip": "أنشر رحلة",
  "/notifications": "الإشعارات",
  "/messages": "الرسائل",
  "/favorites": "المفضلة",
  "/profile": "ملفي الشخصي",
  "/settings": "الإعدادات",
  "/how-it-works": "كيف تعمل؟",
  "/driver": "لوحة السائق",
  "/help": "المساعدة",
  "/about": "من نحن",
  "/community": "المجتمع",
  "/blog": "المدونة",
  "/safety": "الأمان",
  "/booking-confirmation": "تم الحجز! 🎉",
};

export default function MobileLayout({ children, user }) {
  const location   = useLocation();
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const contentRef = useRef(null);
  const pullStartRef = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isMobile   = typeof window !== "undefined" && window.innerWidth < 1024;
  const visibleTabs = getVisibleTabs(user);

  // Unread notifications badge (realtime)
  const { data: notifications = [] } = useQuery({
    queryKey: ["mobile-notif-badge", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Notification.filter({ user_email: user.email, is_read: false }, "-created_date", 20)
      : [],
    enabled: !!user?.email,
    refetchInterval: false,
  });
  const unreadCount = notifications.length;

  useEffect(() => {
    if (!user?.email) return;
    const unsub = base44.entities.Notification.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["mobile-notif-badge", user.email] });
    });
    return () => unsub();
  }, [user?.email, qc]);

  const showBackButton = BACK_BUTTON_PATHS.some(p => location.pathname.startsWith(p));
  const hideNav        = HIDE_NAV_PATHS.some(p => location.pathname.startsWith(p));
  const pageTitle      = PAGE_TITLES[location.pathname]
    || (location.pathname.startsWith("/trip/") ? "تفاصيل الرحلة" : "مِشوار");

  // Pull-to-refresh
  const handleTouchStart = (e) => {
    if (contentRef.current?.scrollTop === 0) pullStartRef.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e) => {
    if (contentRef.current?.scrollTop === 0 && pullStartRef.current > 0) {
      if (e.touches[0].clientY - pullStartRef.current > 70 && !isRefreshing) {
        setIsRefreshing(true);
        pullStartRef.current = 0;
      }
    }
  };
  const handleTouchEnd = async () => {
    if (isRefreshing) {
      await qc.refetchQueries();
      setTimeout(() => setIsRefreshing(false), 800);
    }
    pullStartRef.current = 0;
  };

  if (!isMobile) return children;

  return (
    <div className="fixed inset-0 bg-background flex flex-col" dir="rtl">

      {/* ── Top header ── */}
      <div className="flex-shrink-0 bg-card/98 backdrop-blur-xl border-b border-border"
        style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex items-center h-14 px-4 gap-3">

          {showBackButton ? (
            <button onClick={() => navigate(-1)}
              className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-muted active:bg-muted/80 -mr-1">
              <ChevronLeft className="w-6 h-6 text-foreground" />
            </button>
          ) : (
            <Link to="/" className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm">
                <span className="text-primary-foreground font-black text-base">م</span>
              </div>
            </Link>
          )}

          <h1 className="flex-1 font-bold text-foreground text-base leading-tight">{pageTitle}</h1>

          {/* Notification bell + avatar */}
          <div className="flex items-center gap-1">
            {user && (
              <Link to="/notifications"
                className="relative w-11 h-11 flex items-center justify-center rounded-xl hover:bg-muted active:bg-muted/80">
                <Bell className="w-5 h-5 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] bg-destructive text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            )}
            {user?.avatar_url ? (
              <Link to="/profile" className="w-9 h-9 rounded-full overflow-hidden border-2 border-primary/20">
                <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              </Link>
            ) : user && (
              <Link to="/profile"
                className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                {user.full_name?.[0] || "م"}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Pull-to-refresh indicator */}
      {isRefreshing && (
        <div className="flex-shrink-0 bg-primary/10 border-b border-primary/20 px-4 py-2 text-center text-xs text-primary font-medium">
          🔄 جاري التحديث...
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div
        ref={contentRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: hideNav ? "env(safe-area-inset-bottom)" : "80px" }}
      >
        {children}
      </div>

      {/* ── Bottom tab bar ── */}
      {!hideNav && (
        <div
          className="flex-shrink-0 fixed bottom-0 left-0 right-0 z-50 bg-card/98 backdrop-blur-xl border-t border-border"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex items-end justify-around h-16 px-1">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(tab.path);

              // Center action button (FAB) — only for drivers
              if (tab.isAction) {
                return (
                  <Link key={tab.id} to={tab.path}
                    className="flex flex-col items-center justify-center -mt-5 mb-1">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all active:scale-95 ${
                      isActive ? "bg-primary/80" : "bg-primary"
                    }`}>
                      <Icon className="w-7 h-7 text-primary-foreground" strokeWidth={2.5} />
                    </div>
                    <span className="text-[9px] font-medium text-primary mt-0.5">{tab.label}</span>
                  </Link>
                );
              }

              // Driver dashboard tab — special highlight
              const isDashTab = tab.id === "driver";
              const href = tab.id === "profile"
                ? `/profile?email=${user?.email || ""}`
                : tab.path;

              return (
                <Link key={tab.id} to={href}
                  className={`relative flex flex-col items-center justify-center flex-1 h-full pt-2 pb-1 gap-0.5 transition-colors active:opacity-70 ${
                    isActive ? "text-primary" : isDashTab ? "text-accent" : "text-muted-foreground"
                  }`}
                >
                  {/* Active dot */}
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-primary" />
                  )}

                  <div className={`relative w-10 h-8 flex items-center justify-center rounded-xl transition-all ${
                    isActive
                      ? "bg-primary/10"
                      : isDashTab && !isActive
                      ? "bg-accent/8 group-hover:bg-accent/15"
                      : ""
                  }`}>
                    <Icon className={`w-5 h-5 transition-all ${
                      isActive ? "scale-110" : "scale-100"
                    }`} strokeWidth={isActive ? 2.5 : 2} />
                    {/* Notification badge (for bell tab if we ever add it) */}
                    {tab.id === "notifs" && unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </div>

                  <span className={`text-[10px] font-medium leading-tight ${
                    isActive ? "text-primary font-semibold" : isDashTab ? "text-accent" : ""
                  }`}>
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
