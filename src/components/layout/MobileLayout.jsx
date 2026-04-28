import React, { useState, useRef, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Home, Search, MapPin, MessageSquare, User, ArrowLeft, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-lg">س</span>
              </div>
            )}
            
            <h1 className="flex-1 text-center font-bold text-foreground text-sm truncate">
              {headerTitle || currentTab?.label || "سيرتنا"}
            </h1>
            
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="h-10 w-10 rounded-lg hover:bg-muted flex items-center justify-center"
            >
              {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
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

      {/* Bottom Tab Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border safe-area-inset-bottom">
        <div className="flex items-center justify-around h-20 px-2">
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = location.pathname.startsWith(tab.path.split("?")[0]);
            const href = tab.id === "profile" ? `${tab.path}${user?.email}` : tab.path;
            
            return (
              <Link
                key={tab.id}
                to={href}
                onClick={() => setShowMobileMenu(false)}
                className={`flex flex-col items-center justify-center flex-1 h-full rounded-lg transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-6 h-6 mb-1" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowMobileMenu(false)} />
      )}
    </div>
  );
}