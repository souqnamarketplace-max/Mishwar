import React, {useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, Menu, X, Search, LogOut, Settings, Shield, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import NotificationBell from "../notifications/NotificationBell";

const LOGO_URL = "https://media.base44.com/images/public/user_69994c756ca2186c5598c809/a83e759cf_ChatGPTImageApr27202601_01_06PM.png";

const getNavLinks = (user, isAuthenticated) => {
  const publicLinks = [
    { label: "الرئيسية", path: "/" },
    { label: "ابحث عن رحلة", path: "/search" },
    { label: "كيف تعمل؟", path: "/how-it-works" },
    { label: "مجتمع مِشوار", path: "/community" },
    { label: "المساعدة", path: "/help" },
  ];
  if (!isAuthenticated) return publicLinks;

  // Authenticated user — show personal links
  const links = [
    { label: "الرئيسية", path: "/" },
    { label: "رحلاتي", path: "/my-trips" },
    { label: "المفضلة", path: "/favorites" },
    { label: "كيف تعمل؟", path: "/how-it-works" },
    { label: "مجتمع مِشوار", path: "/community" },
    { label: "المساعدة", path: "/help" },
  ];
  if (user?.account_type === "driver" || user?.account_type === "both") {
    links.splice(1, 0, { label: "لوحة السائق", path: "/driver" });
  }
  return links;
};

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    // Delay attach so the click that OPENED it doesn't immediately close it
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClick), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [profileOpen]);
  const location = useLocation();

  const { user, isAuthenticated } = useAuth();

  // Only drivers (or both) can post trips
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";

  return (
    <nav className="sticky top-0 z-50 bg-card/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">س</span>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold text-foreground leading-tight">مِشوار</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">شارك الطريق، وفر أكثر</p>
            </div>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {getNavLinks(user, isAuthenticated).map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === link.path
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {(!isAuthenticated || !user?.id) && (
              <>
                <Link to="/login" className="hidden sm:block">
                  <Button size="sm" variant="outline" className="rounded-xl border-border">
                    تسجيل الدخول
                  </Button>
                </Link>
                <Link to="/login?signup=1">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
                    إنشاء حساب
                  </Button>
                </Link>
              </>
            )}
            {user?.id && isAuthenticated && isDriver && (
              <Link to="/create-trip">
                <Button size="sm" className="hidden sm:flex bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
                  أنشر رحلة
                </Button>
              </Link>
            )}
            {(isAuthenticated && user?.id) && (
              <>
                <Link to="/messages" className="relative p-2 rounded-lg hover:bg-muted transition-colors">
                  <MessageSquare className="w-5 h-5 text-muted-foreground" />
                  <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full"></span>
                </Link>
                <NotificationBell userEmail={user?.email} />
              </>
            )}
            
            {/* Profile Menu — only when authenticated */}
            {(isAuthenticated && user?.id) && (
            <div ref={profileMenuRef} className="relative hidden lg:block">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-muted transition-colors border border-border"
                title="ملفي الشخصي"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center shrink-0">
                  {user?.avatar_url ? (
                    <img loading="lazy" src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-bold text-sm text-primary">{user?.full_name?.[0] || "م"}</span>
                  )}
                </div>
                <div className="hidden md:block text-right">
                  <p className="text-xs font-medium text-foreground leading-tight">{user?.full_name?.split(" ")[0] || "مستخدم"}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{user?.account_type === "driver" ? "سائق" : user?.account_type === "both" ? "سائق/راكب" : "راكب"}</p>
                </div>
              </button>
              
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-card rounded-xl border border-border shadow-xl overflow-hidden z-[999]">
                  <Link
                    to={`/profile?email=${user?.email}`}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                  >
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">ملفي الشخصي</span>
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                  >
                    <Settings className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">إعدادات الحساب</span>
                  </Link>
                  {user?.role === "admin" && (
                    <Link
                      to="/dashboard"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors border-b border-border bg-primary/[0.03]"
                    >
                      <Shield className="w-4 h-4 text-primary" />
                      <span className="text-sm font-bold text-primary">لوحة الإدارة</span>
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      base44.auth.logout();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              )}
            </div>
            )}
            <button
              className="lg:hidden p-2 rounded-lg hover:bg-muted"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="lg:hidden border-t border-border overflow-hidden bg-card"
          >
            <div className="px-4 py-3 space-y-1">
              {getNavLinks(user, isAuthenticated).map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === link.path
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              {!isAuthenticated ? (
                <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-border">
                  <Link to="/login" onClick={() => setMobileOpen(false)}>
                    <Button variant="outline" className="w-full rounded-xl border-border">تسجيل الدخول</Button>
                  </Link>
                  <Link to="/login?signup=1" onClick={() => setMobileOpen(false)}>
                    <Button className="w-full bg-primary text-primary-foreground rounded-xl">إنشاء حساب جديد</Button>
                  </Link>
                </div>
              ) : (
                <>
                  {isDriver && (
                    <Link to="/create-trip" onClick={() => setMobileOpen(false)}>
                      <Button className="w-full mt-2 bg-primary text-primary-foreground rounded-xl">
                        أنشر رحلة
                      </Button>
                    </Link>
                  )}
                  <Link
                    to={`/profile?email=${user?.email}`}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    ملفي الشخصي
                  </Link>
                  <button
                    onClick={() => { setMobileOpen(false); base44.auth.logout(); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    تسجيل الخروج
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}