import React, { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { Home, Search, MapPin, MessageSquare, User, ArrowLeft, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const MOBILE_TABS = [
  { id: "home", label: "الرئيسية", icon: Home, path: "/" },
  { id: "search", label: "بحث", icon: Search, path: "/search" },
  { id: "trips", label: "رحلاتي", icon: MapPin, path: "/my-trips" },
  { id: "messages", label: "الرسائل", icon: MessageSquare, path: "/messages" },
  { id: "profile", label: "الملف", icon: User, path: "/profile?email=" },
];

export default function MobileLayout({ children, user, showHeader = true, headerTitle = "" }) {
  const location = useLocation();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  
  // Detect if viewport is mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;
  
  if (!isMobile) return children;

  const currentTab = MOBILE_TABS.find(tab => location.pathname.startsWith(tab.path.split("?")[0]));

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
      <div className="flex-1 overflow-y-auto pb-20">
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