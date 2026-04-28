import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, Menu, X, Search, LogOut, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import NotificationBell from "../notifications/NotificationBell";

const LOGO_URL = "https://media.base44.com/images/public/user_69994c756ca2186c5598c809/a83e759cf_ChatGPTImageApr27202601_01_06PM.png";

const getNavLinks = (user) => {
  const links = [
    { label: "الرئيسية", path: "/" },
    { label: "رحلاتي", path: "/my-trips" },
    { label: "المفضلة", path: "/favorites" },
    { label: "كيف تعمل؟", path: "/how-it-works" },
    { label: "مجتمع سيرتنا", path: "/community" },
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
  const location = useLocation();

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

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
              <h1 className="text-lg font-bold text-foreground leading-tight">سيرتنا</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">شارك الطريق، وفر أكثر</p>
            </div>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {getNavLinks(user).map((link) => (
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
            <Link to="/create-trip">
              <Button size="sm" className="hidden sm:flex bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
                أنشر رحلة
              </Button>
            </Link>
            <Link to="/messages" className="relative p-2 rounded-lg hover:bg-muted transition-colors">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full"></span>
            </Link>
            <NotificationBell userEmail={user?.email} />
            
            {/* Profile Menu */}
            <div className="relative hidden lg:block">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                title="ملفي الشخصي"
              >
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <span className="font-bold text-sm">{user?.full_name?.[0] || "م"}</span>
                )}
              </button>
              
              {profileOpen && (
                <div className="absolute left-0 mt-2 w-48 bg-card rounded-xl border border-border shadow-lg overflow-hidden z-50">
                  <Link
                    to={`/profile?email=${user?.email}`}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                  >
                    <Settings className="w-4 h-4 text-muted-foreground" />
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
                  <button
                    onClick={() => { base44.auth.logout(); setProfileOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              )}
            </div>
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
              {getNavLinks(user).map((link) => (
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
              <Link to="/create-trip" onClick={() => setMobileOpen(false)}>
                <Button className="w-full mt-2 bg-primary text-primary-foreground rounded-xl">
                  أنشر رحلة
                </Button>
              </Link>
              <Link
                to={`/profile?email=${user?.email}`}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                <Settings className="w-4 h-4" />
                ملفي الشخصي
              </Link>
              <button
                onClick={() => { base44.auth.logout(); setMobileOpen(false); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                تسجيل الخروج
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}