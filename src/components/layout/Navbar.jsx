import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, Menu, X, Search, LogOut, Settings, Inbox, ShieldCheck, Plus, LayoutDashboard } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { useUnreadMessageCount } from "@/lib/useUnreadMessageCount";
import { toast } from "sonner";
import NotificationBell from "../notifications/NotificationBell";

const LOGO_URL = "/logo.png";

const getNavLinks = (user) => {
  const links = [
    { label: "الرئيسية", path: "/" },
    { label: "رحلاتي", path: "/my-trips" },
    { label: "المفضلة", path: "/favorites" },
    { label: "كيف تعمل؟", path: "/how-it-works" },
    { label: "مجتمع مشوارو", path: "/community" },
    { label: "المساعدة", path: "/help" },
    { label: "اقتراحات", path: "/feedback" },
  ];
  if (user?.account_type === "driver" || user?.account_type === "both") {
    links.splice(1, 0, { label: "لوحة السائق", path: "/driver" });
  }
  return links;
};

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const location = useLocation();

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.auth.me(),
  });

  // Drives the red badge on the message icon. Live-updated via the
  // hook's internal Supabase realtime subscription — no manual
  // refresh needed when a new message arrives.
  const unreadMessages = useUnreadMessageCount(user?.email);

  // Close the profile dropdown on outside click. Previously the
  // dropdown only closed via tapping a menu item or the trigger
  // button — tapping anywhere else on the page left it open,
  // sometimes blocking other UI surfaces (especially on mobile
  // where the dropdown overlaps page content). Same pattern as
  // AdminNotificationBell uses.
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e) => {
      if (profileRef.current && profileRef.current.contains(e.target)) return;
      setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [profileOpen]);

  // Shared logout handler — awaits the promise so failures surface
  // as toasts. Previously both logout buttons (lines ~238 + ~320)
  // did `api.auth.logout(); setX(false)` fire-and-forget. If the
  // request failed (network blip, expired refresh token, etc.),
  // the menu closed but the user stayed signed in with no feedback.
  // Now: explicit error toast on failure. Success path doesn't
  // toast — AuthContext picks up SIGNED_OUT and routes the user
  // appropriately.
  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {
      toast.error("فشل تسجيل الخروج. حاول مجدداً.");
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-card/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="مشوارو" className="h-11 w-11 rounded-xl object-cover shadow-sm" />
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold text-foreground leading-tight">مشوارو</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">رحلتك أسهل، أوفر، وأسرع</p>
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
            {/* Primary CTA — context-aware.
                - Drivers / both         → "أنشر رحلة" (their primary action)
                - Passengers             → "اطلب رحلة" (primary, green)
                                           + "كن سائقاً" (secondary, outlined)
                - Anonymous / no account → no CTA (login flow surfaces from header)
                Previously passengers only saw "كن سائقاً", which forced
                them to discover the trip-request feature elsewhere — most
                never did. */}
            {(user?.account_type === "driver" || user?.account_type === "both") ? (
              <Link to="/create-trip">
                <Button size="sm" className="hidden sm:flex bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
                  أنشر رحلة
                </Button>
              </Link>
            ) : user ? (
              <>
                <Link to="/request-trip">
                  <Button size="sm" className="hidden sm:flex bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
                    اطلب رحلة
                  </Button>
                </Link>
                <Link to="/become-driver">
                  <Button size="sm" variant="outline" className="hidden md:flex border-primary/30 text-primary hover:bg-primary/5 rounded-xl">
                    كن سائقاً
                  </Button>
                </Link>
              </>
            ) : (
              // Anonymous visitors: surface auth CTAs in the top nav.
              // Without these, a first-time visitor's only login path was
              // the burger-menu (mobile) or profile dropdown (desktop) —
              // both of which are invisible until you know they exist.
              // The "إنشاء حساب" pill is shown on every viewport so it's
              // visible on the cramped mobile nav too. "تسجيل الدخول" is
              // a secondary text link, hidden on the narrowest screens
              // to keep the bell + burger reachable. Login route uses
              // ?signup=1 to land directly on the signup tab.
              <>
                <Link to="/login" className="hidden sm:inline-flex text-sm font-medium text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg transition-colors">
                  تسجيل الدخول
                </Link>
                <Link to="/login?signup=1">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-3 sm:px-4">
                    إنشاء حساب
                  </Button>
                </Link>
              </>
            )}
            <Link to="/messages" className="relative p-2 rounded-lg hover:bg-muted transition-colors" aria-label={unreadMessages > 0 ? `الرسائل (${unreadMessages} غير مقروءة)` : "الرسائل"}>
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              {/* Real badge tied to the unread-messages hook. Was
                  previously a static dot that always appeared, even
                  with zero unread messages — defeating the whole
                  point. Style matches the mobile bottom-tabs badge
                  (red bg, white text, ring + pulse) for consistency
                  across the two surfaces. */}
              {unreadMessages > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md ring-2 ring-card animate-pulse"
                  aria-hidden="true"
                >
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Link>
            <NotificationBell userEmail={user?.email} />
            
            {/* Profile Menu */}
            <div ref={profileRef} className="relative hidden lg:block">
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
                <div className="absolute right-0 mt-2 w-56 bg-card rounded-xl border border-border shadow-xl overflow-hidden z-[999]">
                  <Link
                    to={`/profile?email=${user?.email}`}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                  >
                    <Settings className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">ملفي الشخصي</span>
                  </Link>

                  {/* Trip-requests entries — primary actions for any user.
                      Drivers (and "both") also see these because they may
                      occasionally need a ride themselves. */}
                  {(user?.account_type !== "driver") && (
                    <Link
                      to="/request-trip"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                    >
                      <Plus className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">اطلب رحلة</span>
                    </Link>
                  )}
                  <Link
                    to="/my-requests"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                  >
                    <Inbox className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">طلباتي</span>
                  </Link>
                  {(user?.account_type === "driver" || user?.account_type === "both") && (
                    <Link
                      to="/passenger-requests"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                    >
                      <Inbox className="w-4 h-4 text-accent" />
                      <span className="text-sm font-medium">طلبات الركاب</span>
                    </Link>
                  )}

                  {/* Verification entry — passengers and "both" need this
                      before they can post requests. Drivers don't (they
                      don't post passenger requests). */}
                  {(user?.account_type !== "driver") && (
                    <Link
                      to="/verify-passenger"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                    >
                      <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">توثيق الهوية</span>
                    </Link>
                  )}

                  <Link
                    to="/settings"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border"
                  >
                    <Settings className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">إعدادات الحساب</span>
                  </Link>
                  {/* Admin panel entry — only visible to admins. Without this,
                      admins landing on / had no in-app path to /dashboard
                      and had to type the URL by hand. Placed just above
                      logout so it's always reachable regardless of how
                      many other entries appear above. */}
                  {user?.role === "admin" && (
                    <Link
                      to="/dashboard"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors border-b border-border bg-amber-50/50"
                    >
                      <LayoutDashboard className="w-4 h-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-900">لوحة الإدارة</span>
                    </Link>
                  )}
                  <button
                    onClick={() => { setProfileOpen(false); handleLogout(); }}
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
              {(user?.account_type === "driver" || user?.account_type === "both") ? (
                <Link to="/create-trip" onClick={() => setMobileOpen(false)}>
                  <Button className="w-full mt-2 bg-primary text-primary-foreground rounded-xl">
                    أنشر رحلة
                  </Button>
                </Link>
              ) : user ? (
                <>
                  <Link to="/request-trip" onClick={() => setMobileOpen(false)}>
                    <Button className="w-full mt-2 bg-primary text-primary-foreground rounded-xl">
                      اطلب رحلة
                    </Button>
                  </Link>
                  <Link to="/become-driver" onClick={() => setMobileOpen(false)}>
                    <Button variant="outline" className="w-full mt-2 border-primary/30 text-primary rounded-xl">
                      كن سائقاً
                    </Button>
                  </Link>
                </>
              ) : null}
              <Link
                to={`/profile?email=${user?.email}`}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                <Settings className="w-4 h-4" />
                ملفي الشخصي
              </Link>
              {user?.role === "admin" && (
                <Link
                  to="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-sm font-medium text-amber-900 bg-amber-50/50 hover:bg-amber-100/60 transition-colors"
                >
                  <LayoutDashboard className="w-4 h-4 text-amber-600" />
                  لوحة الإدارة
                </Link>
              )}
              <button
                onClick={() => { setMobileOpen(false); handleLogout(); }}
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