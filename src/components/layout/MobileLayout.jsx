import React, { useState, useRef, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Home, Search, MapPin, MessageSquare, User, ArrowLeft, Menu, X, Settings, HelpCircle, LogOut, Shield, Info, FileText, MessageSquarePlus, Plus, Heart, BookOpen, Bell } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import NotificationBell from "@/components/notifications/NotificationBell";
import BookingRequestPopup from "@/components/driver/BookingRequestPopup";
import ExpiredTripNotifier from "@/components/driver/ExpiredTripNotifier";
import { useQueryClient } from "@tanstack/react-query";

const MOBILE_TABS = [
  { id: "home", label: "الرئيسية", icon: Home, path: "/" },
  { id: "search", label: "بحث", icon: Search, path: "/search" },
  { id: "trips", label: "رحلاتي", icon: MapPin, path: "/my-trips" },
  { id: "messages", label: "الرسائل", icon: MessageSquare, path: "/messages" },
  { id: "profile", label: "الملف", icon: User, path: "/profile?email=" },
];

export default function MobileLayout({ children, user, showHeader = true, headerTitle = "" }) {
  const location = useLocation();
  const qc = useQueryClient();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const contentRef = useRef(null);
  const pullStartRef = useRef(0);
  const tabHistoryRef = useRef({});
  
  // Detect if viewport is mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;

  const currentTab = MOBILE_TABS.find(tab => location.pathname.startsWith(tab.path.split("?")[0]));

  // Track tab history/stacks (unconditional)
  useEffect(() => {
    if (currentTab?.id && !tabHistoryRef.current[currentTab.id]) {
      tabHistoryRef.current[currentTab.id] = [];
    }
    if (currentTab?.id) {
      const stack = tabHistoryRef.current[currentTab.id];
      if (stack[stack.length - 1] !== location.pathname) {
        stack.push(location.pathname);
      }
    }
  }, [currentTab?.id, location.pathname]);

  if (!isMobile) return children;

  // Pull-to-refresh handler
  const handleTouchStart = (e) => {
    if (contentRef.current?.scrollTop === 0) {
      pullStartRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e) => {
    if (contentRef.current?.scrollTop === 0 && pullStartRef.current > 0) {
      const pullDistance = e.touches[0].clientY - pullStartRef.current;
      if (pullDistance > 60 && !isRefreshing) {
        setIsRefreshing(true);
        pullStartRef.current = 0;
      }
    }
  };

  const handleTouchEnd = async () => {
    if (isRefreshing) {
      await qc.refetchQueries();
      setIsRefreshing(false);
    }
    pullStartRef.current = 0;
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Sticky Header */}
      {showHeader && (
        <div className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-border safe-area-inset-top">
          <div className="flex items-center justify-between h-14 px-4 gap-2">
            {location.pathname !== "/" ? (
              <Link to="/">
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
            ) : (
              <Link to="/">
                <img src="/logo.png" alt="مشوارو" className="h-10 w-10 rounded-xl object-cover" />
              </Link>
            )}
            
            <h1 className="flex-1 text-center font-bold text-foreground text-sm truncate">
              {location.pathname === "/" ? (
                <img src="/logo.png" alt="مشوارو" className="h-8 w-8 rounded-lg object-cover mx-auto" />
              ) : (headerTitle || currentTab?.label || "مشوارو")}
            </h1>
            
            <div className="flex items-center gap-1">
              <NotificationBell userEmail={user?.email} />
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="h-10 w-10 rounded-lg hover:bg-muted flex items-center justify-center"
              >
                {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div
        ref={contentRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 overflow-y-auto pb-20 relative"
      >
        {isRefreshing && (
          <div className="sticky top-0 left-0 right-0 z-20 bg-primary/10 border-b border-primary/20 px-4 py-2 text-center text-xs text-primary font-medium">
            🔄 جاري التحديث...
          </div>
        )}
        {children}
      </div>

      {/* Bottom Tab Bar — with integrated driver post-trip button */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border safe-area-inset-bottom">
        <div className="flex items-end justify-around h-20 px-2 pb-1">
          {MOBILE_TABS.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = location.pathname.startsWith(tab.path.split("?")[0]);
            const href = tab.id === "profile" ? `${tab.path}${user?.email}` : tab.path;
            const isDriver = user?.account_type === "driver" || user?.account_type === "both";
            // Insert driver post-trip button in the center (after index 1)
            const centerInsert = isDriver && idx === 2;

            const handleTabClick = (e) => {
              if (isActive && location.pathname !== tab.path.split("?")[0]) {
                e.preventDefault();
                window.location.href = tab.path.split("?")[0];
              }
              setShowMobileMenu(false);
            };

            return (
              <React.Fragment key={tab.id}>
                {centerInsert && (
                  <RouterLink to="/create-trip"
                    className="flex flex-col items-center justify-end flex-1 pb-1 -mt-5"
                    onClick={() => setShowMobileMenu(false)}>
                    <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-lg border-4 border-card active:scale-95 transition-transform mb-0.5">
                      <Plus className="w-7 h-7 text-primary-foreground" strokeWidth={2.5} />
                    </div>
                    <span className="text-[10px] font-bold text-primary">نشر رحلة</span>
                  </RouterLink>
                )}
              <Link
                to={href}
                onClick={handleTabClick}
                className={`flex flex-col items-center justify-center flex-1 h-full rounded-lg transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-6 h-6 mb-1" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Global Booking Request Popup for drivers */}
      <BookingRequestPopup user={user} />
      <ExpiredTripNotifier user={user} />

      {/* Mobile Menu Overlay + Drawer */}
      {showMobileMenu && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowMobileMenu(false)} />
          <div className="fixed top-0 left-0 bottom-0 z-50 w-72 bg-card shadow-2xl flex flex-col overflow-hidden"
            style={{ borderRadius: "0 24px 24px 0" }}>

            {/* User Header */}
            <div className="bg-primary px-5 pt-10 pb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary-foreground/20 flex items-center justify-center overflow-hidden shrink-0">
                  {user?.avatar_url
                    ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <span className="text-primary-foreground font-bold text-lg">{user?.full_name?.[0] || "م"}</span>
                  }
                </div>
                <div className="min-w-0">
                  <p className="text-primary-foreground font-bold text-sm truncate">{user?.full_name || "مرحباً"}</p>
                  <p className="text-primary-foreground/70 text-xs truncate">{user?.email || ""}</p>
                </div>
              </div>
            </div>

            {/* Main Nav — mirrors bottom tabs */}
            <div className="flex-1 overflow-y-auto" dir="rtl">
              <div className="py-2">
                {[
                  { icon: Home,          label: "الرئيسية",        path: "/" },
                  { icon: Search,        label: "بحث عن رحلة",     path: "/search" },
                  { icon: MapPin,        label: "رحلاتي",           path: "/my-trips" },
                  { icon: MessageSquare, label: "الرسائل",          path: "/messages" },
                  { icon: Heart,         label: "المفضلة",          path: "/favorites" },
                  { icon: User,          label: "الملف الشخصي",    path: user?.email ? `/profile?email=${user.email}` : "/profile" },
                  ...(user?.account_type === "driver" || user?.account_type === "both"
                    ? [{ icon: Settings, label: "لوحة تحكم السائق", path: "/driver" }]
                    : [{ icon: Settings, label: "الإعدادات",         path: "/account-settings" }]
                  ),
                ].map(({ icon: Icon, label, path }) => (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setShowMobileMenu(false)}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted transition-colors text-foreground"
                  >
                    <Icon className="w-5 h-5 text-primary shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                  </Link>
                ))}
              </div>

              <div className="mx-4 my-1 border-t border-border" />

              <div className="py-2">
                {[
                  { icon: BookOpen,        label: "كيف يعمل مِشوار",    path: "/how-it-works" },
                { icon: Bell,           label: "إشعاراتي ومساراتي",  path: "/notifications" },
                { icon: MessageSquarePlus, label: "اقتراحات وشكاوى", path: "/feedback" },
                { icon: HelpCircle,     label: "المساعدة",            path: "/help" },
                { icon: Shield,         label: "الخصوصية والأمان",    path: "/privacy" },
                { icon: FileText,       label: "الشروط والأحكام",     path: "/terms" },
                { icon: Info,           label: "عن مِشوار",            path: "/about" },
                ].map(({ icon: Icon, label, path }) => (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setShowMobileMenu(false)}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-muted transition-colors text-muted-foreground"
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-sm">{label}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Sign Out + Version */}
            <div className="border-t border-border" dir="rtl">
              <button
                onClick={() => { setShowMobileMenu(false); base44.auth.logout(); }}
                className="flex items-center gap-3 w-full px-5 py-4 hover:bg-destructive/10 transition-colors text-destructive"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span className="text-sm font-medium">تسجيل الخروج</span>
              </button>
              <p className="text-center text-xs text-muted-foreground pb-4">مِشوار · النسخة 1.0</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}