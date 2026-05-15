import React, { useState, useRef, useEffect } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { Home, Search, MapPin, MessageSquare, User, ArrowLeft, ArrowRight, Menu, X, Settings, HelpCircle, LogOut, Shield, Info, FileText, MessageSquarePlus, Plus, Heart, BookOpen, Bell, ShieldCheck, Sparkles, Car, CreditCard, Users, Flag, Wallet, Inbox, LayoutDashboard } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import NotificationBell from "@/components/notifications/NotificationBell";
import BookingRequestPopup from "@/components/driver/BookingRequestPopup";
import ExpiredTripNotifier from "@/components/driver/ExpiredTripNotifier";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useUnreadMessageCount } from "@/lib/useUnreadMessageCount";

const MOBILE_TABS = [
  { id: "home",     label: "الرئيسية", icon: Home,          path: "/" },
  { id: "search",   label: "بحث",      icon: Search,        path: "/search" },
  { id: "trips",    label: "رحلاتي",   icon: MapPin,        path: "/my-trips" },
  { id: "messages", label: "الرسائل",  icon: MessageSquare, path: "/messages" },
  { id: "profile",  label: "الملف",    icon: User,          path: "/profile?email=" },
];

const PAGE_TITLES = {
  "/":                     "الرئيسية",
  "/search":               "البحث عن رحلة",
  "/my-trips":             "رحلاتي",
  "/messages":             "الرسائل",
  "/favorites":            "المفضلة",
  "/notifications":        "الإشعارات",
  "/account-settings":     "الإعدادات",
  "/settings":             "الحساب",
  "/create-trip":          "نشر رحلة",
  "/request-trip":         "اطلب رحلة",
  "/my-requests":          "طلباتي",
  "/passenger-requests":   "طلبات الركاب",
  "/verify-passenger":     "توثيق الهوية",
  "/driver":               "لوحة السائق",
  "/how-it-works":         "كيف يعمل مشوارو؟",
  "/about":                "عن مشوارو",
  "/about-us":             "عن مشوارو",
  "/help":                 "المساعدة",
  "/feedback":             "اقتراحات وشكاوى",
  "/privacy":              "سياسة الخصوصية",
  "/privacy-policy":       "سياسة الخصوصية",
  "/terms":                "الشروط والأحكام",
  "/terms-of-service":     "الشروط والأحكام",
  "/safety":               "الأمان والسلامة",
  "/community":            "المجتمع",
  "/blog":                 "المدونة",
  "/booking-confirmation": "تأكيد الحجز",
  "/onboarding":           "مرحباً بك",
  "/dashboard":            "لوحة الإدارة",
};

// Resolve the mobile header title for routes that aren't a perfect literal
// match in PAGE_TITLES — dynamic paths like /trip/:id and /profile must
// not fall through to the bottom-tab's label, which (because the home tab
// is "الرئيسية") incorrectly displayed the word "الرئيسية" everywhere
// the route wasn't in the static map. Returns null when no rule applies
// so the existing fallback chain still runs.
function resolveDynamicTitle(pathname) {
  if (pathname.startsWith("/trip/"))            return "تفاصيل الرحلة";
  if (pathname.startsWith("/profile"))          return "الملف الشخصي";
  if (pathname.startsWith("/account-settings")) return "الإعدادات";
  if (pathname.startsWith("/booking/"))         return "الحجز";
  if (pathname.startsWith("/edit-trip/"))       return "تعديل الرحلة";
  return null;
}

export default function MobileLayout({ children, user, showHeader = true, headerTitle = "" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  // For "both" account users (driver + passenger combined), the center FAB
  // opens a chooser sheet instead of navigating directly — they can pick
  // between posting a trip (driving) or requesting one (riding).
  const [showFabChooser, setShowFabChooser] = useState(false);
  // contentRef is the inner scroll container — kept around so sub-components
  // can read the DOM if needed. PTR moved out to the dedicated
  // PullToRefresh wrapper in AppLayout (which finds this element by walking
  // up from the touch target to the nearest y-scrollable ancestor).
  const contentRef = useRef(null);
  const tabHistoryRef = useRef({});
  
  // Detect if viewport is mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;

  // ─── Unread messages count (drives red badge on الرسائل tab) ───
  // Hook handles the COUNT query + Supabase realtime subscription.
  // Same hook is used by Navbar.jsx so desktop + mobile stay in sync.
  const unreadCount = useUnreadMessageCount(user?.email);

  // ─── Support phone for the emergency CTA (pulled from settings so
  // admin can edit without a deploy; same pattern as Help.jsx and
  // Footer.jsx). The CTA is hidden when no admin has configured a
  // number — showing a placeholder hotline that goes nowhere is worse
  // than showing nothing for a safety feature. */}
  const { data: settingsArrM = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => api.entities.AppSettings.list(),
    staleTime: 5 * 60 * 1000,
  });
  const supportPhoneM = settingsArrM[0]?.support_phone || "";

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

  // Pull-to-refresh used to be implemented inline here with a 60px hair
  // trigger that was easy to fire by accident, AND it raced with the
  // dedicated PullToRefresh component AppLayout wraps around the page —
  // two handlers fighting for the same gesture meant neither worked
  // reliably. PullToRefresh now owns the gesture exclusively.

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Sticky Header */}
      {showHeader && (
        <div className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-border safe-area-inset-top">
          <div className="flex items-center justify-between h-14 px-4 gap-2" dir="rtl">
            {/* RIGHT side (RTL start): Hamburger + (signup pill if anonymous) + Bell */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="h-10 w-10 rounded-lg hover:bg-muted flex items-center justify-center"
              >
                {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {/* Anonymous CTA — without this, mobile visitors had zero
                  visible auth surface anywhere on the screen (Navbar.jsx
                  handles the desktop case but is hidden under 1024px).
                  Lands on /login?signup=1 so the signup tab opens directly
                  rather than the login tab — matches the desktop nav's
                  "إنشاء حساب" button. Slightly compact (px-2.5 h-9) so it
                  doesn't crowd the centered page title on a 375px viewport. */}
              {!user && (
                <Link to="/login?signup=1">
                  <Button
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-2.5 h-9 text-xs font-bold whitespace-nowrap"
                  >
                    إنشاء حساب
                  </Button>
                </Link>
              )}
              <NotificationBell userEmail={user?.email} />
            </div>

            {/* CENTER: Page title */}
            <h1 className="flex-1 text-center font-bold text-foreground text-sm truncate">
              {headerTitle || PAGE_TITLES[location.pathname] || resolveDynamicTitle(location.pathname) || currentTab?.label || "مشوارو"}
            </h1>

            {/* LEFT side (RTL end): Logo or Back arrow */}
            {location.pathname !== "/" ? (
              <Link to="/">
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
            ) : (
              <Link to="/">
                <img src="/logo.png" alt="مشوارو" className="h-8 w-8 rounded-lg object-cover" />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Main Content. data-mobile-content is the stable hook the
          chat-overlay-active body rule uses to remove pb-20 (which
          exists to clear the tab bar) when the tab bar itself is
          hidden — otherwise an 80px dead zone sits between the chat
          and the keyboard. Pairs with index.css. */}
      <div
        ref={contentRef}
        data-mobile-content
        className="flex-1 overflow-y-auto pb-20 relative"
      >
        {children}
        {/* Emergency / SOS strip — desktop has this in <Footer />, mobile
            wasn't rendering it anywhere, leaving people on phones with no
            quick way to reach the abuse hotline. Pinned at the bottom of
            the scroll content (above the tab bar) so users see it after
            scrolling any page to the end. tel: links open the dialer
            on every modern mobile OS. */}
        {supportPhoneM && (
          <a
            href={`tel:${supportPhoneM.replace(/\s/g, "")}`}
            className="block bg-red-800/90 text-white text-center text-sm py-2.5 px-4 -mx-0 active:bg-red-900"
            dir="rtl"
          >
            <span className="opacity-90">🆘 طوارئ أو إساءة؟ </span>
            <span className="font-bold underline">اتصل: {supportPhoneM}</span>
          </a>
        )}
      </div>

      {/* Bottom Tab Bar — with integrated driver post-trip button.
          The data-mobile-nav attribute is the stable target for CSS
          rules that need to hide the nav while a full-height surface
          takes over the bottom edge (e.g. an active chat thread whose
          composer must sit just above the keyboard). Don't remove or
          rename without updating the matching rules in index.css. */}
      <div
        data-mobile-nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border safe-area-inset-bottom"
      >
        <div className="flex items-end justify-around h-20 px-2 pb-1">
          {MOBILE_TABS.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = location.pathname.startsWith(tab.path.split("?")[0]);
            const href = tab.id === "profile" ? `${tab.path}${user?.email}` : tab.path;
            const isDriver = user?.account_type === "driver" || user?.account_type === "both";
            const isPassenger = user?.account_type === "passenger";
            const isBoth = user?.account_type === "both";
            // Center FAB inserted between the 2nd and 3rd tabs (visually
            // sits in the middle of the 5-tab strip). Role-aware:
            //   - Pure driver    → "نشر رحلة" → /create-trip      (direct)
            //   - Pure passenger → "اطلب رحلة" → /request-trip     (direct)
            //   - Both accounts  → opens chooser sheet so the user picks
            //                       what they want (post or request)
            //   - Anonymous users → no FAB (must log in)
            const centerInsert = (isDriver || isPassenger) && idx === 2;
            const fabHref  = isPassenger && !isDriver ? "/request-trip" : "/create-trip";
            const fabLabel = isBoth ? "إنشاء" : (isPassenger && !isDriver ? "اطلب رحلة" : "نشر رحلة");

            const handleTabClick = (e) => {
              if (isActive && location.pathname !== tab.path.split("?")[0]) {
                e.preventDefault();
                navigate(tab.path);
              }
              setShowMobileMenu(false);
            };

            return (
              <React.Fragment key={tab.id}>
                {centerInsert && (
                  isBoth ? (
                    <button type="button"
                      onClick={() => { setShowFabChooser(true); setShowMobileMenu(false); }}
                      className="flex flex-col items-center justify-end flex-1 pb-1 -mt-5">
                      <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-lg border-4 border-card active:scale-95 transition-transform mb-0.5">
                        <Plus className="w-7 h-7 text-primary-foreground" strokeWidth={2.5} />
                      </div>
                      <span className="text-[10px] font-bold text-primary">{fabLabel}</span>
                    </button>
                  ) : (
                    <RouterLink to={fabHref}
                      className="flex flex-col items-center justify-end flex-1 pb-1 -mt-5"
                      onClick={() => setShowMobileMenu(false)}>
                      <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-lg border-4 border-card active:scale-95 transition-transform mb-0.5">
                        <Plus className="w-7 h-7 text-primary-foreground" strokeWidth={2.5} />
                      </div>
                      <span className="text-[10px] font-bold text-primary">{fabLabel}</span>
                    </RouterLink>
                  )
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
                <div className="relative">
                  <Icon className="w-6 h-6 mb-1" />
                  {tab.id === "messages" && unreadCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md ring-2 ring-card animate-pulse"
                      aria-label={`${unreadCount} رسائل غير مقروءة`}
                    >
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
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
          <div className="fixed top-0 right-0 bottom-0 z-50 w-72 bg-card shadow-2xl flex flex-col overflow-hidden"
            style={{ borderRadius: "24px 0 0 24px" }}>

            {user ? (
              <>
            {/* User Header */}
            <div className="bg-primary px-4 pt-6 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center overflow-hidden shrink-0">
                  {user?.avatar_url
                    ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <span className="text-primary-foreground font-bold text-base">{user?.full_name?.[0] || "م"}</span>
                  }
                </div>
                <div className="min-w-0">
                  <p className="text-primary-foreground font-bold text-sm truncate">{user?.full_name || "مرحباً"}</p>
                  <p className="text-primary-foreground/70 text-[11px] truncate">{user?.email || ""}</p>
                </div>
              </div>
            </div>

            {/* Main Nav — Account section + Quick links */}
            <div className="flex-1 overflow-y-auto" dir="rtl">
              {/* Account Section */}
              <div className="py-2">
                <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider">حسابي</p>
                {[
                  { icon: User,          label: "إعدادات الملف الشخصي", path: "/account-settings/profile" },
                  // Verification entry routes by account_type:
                  //   - passenger / no account → /verify-passenger (ID verification gate for trip-requests)
                  //   - driver / both          → /account-settings?section=verification (driver license docs)
                  // Without this split, passengers were sent to a section that
                  // doesn't render meaningful content for them.
                  {
                    icon: ShieldCheck,
                    label: "توثيق الهوية",
                    path: (user?.account_type === "driver" || user?.account_type === "both")
                      ? "/account-settings?section=verification"
                      : "/verify-passenger",
                  },
                  { icon: Bell,          label: "إعدادات الإشعارات",       path: "/account-settings?section=notifications" },
                  { icon: Sparkles,      label: "التفضيلات",                path: "/account-settings?section=preferences" },
                  ...(user?.account_type === "driver" || user?.account_type === "both"
                    ? [{ icon: Car, label: "تفاصيل السيارة", path: "/account-settings?section=vehicle" }]
                    : []
                  ),
                  ...(user?.account_type === "passenger" || user?.account_type === "both" || !user?.account_type
                    ? [{ icon: CreditCard, label: "سجل المدفوعات", path: "/account-settings?section=payments" }]
                    : []
                  ),
                  ...(user?.account_type === "driver" || user?.account_type === "both"
                    ? [
                        { icon: CreditCard, label: "مدفوعات السائق",  path: "/driver?tab=payments"     },
                        { icon: Wallet,     label: "اشتراك المنصة",   path: "/driver?tab=subscription" },
                      ]
                    : []
                  ),
                  // Become-a-driver entry — passenger-only. Mirrors the
                  // top-of-list gradient card in AccountHub. Without this
                  // a mobile passenger has no obvious in-app path into
                  // the upgrade wizard from the side drawer.
                  ...(user && user.account_type === "passenger"
                    ? [{ icon: Car, label: "كن سائقاً في مشوارو", path: "/become-driver" }]
                    : []
                  ),
                  // Trip-requests feature surfaces — without these, users
                  // had no in-app path from the mobile drawer to manage
                  // their requests (passenger) or browse them (driver).
                  // The center FAB shows a chooser but doesn't surface
                  // ongoing/historical lists.
                  // Direct "post a request" entry — passengers + both. This
                  // duplicates the FAB for users who prefer the drawer flow
                  // (or are still discovering the FAB exists).
                  ...(user?.account_type === "passenger" || user?.account_type === "both" || !user?.account_type
                    ? [{ icon: Plus, label: "اطلب رحلة جديدة", path: "/request-trip" }]
                    : []
                  ),
                  { icon: Inbox, label: "طلباتي",       path: "/my-requests" },
                  ...(user?.account_type === "driver" || user?.account_type === "both"
                    ? [{ icon: Inbox, label: "طلبات الركاب", path: "/passenger-requests" }]
                    : []
                  ),
                  // Safety / moderation entries — without these, mobile users
                  // could file reports or block people from a 3-dot menu but
                  // had no obvious way to follow up on submitted reports or
                  // un-block someone they regretted blocking. The entries
                  // existed in /settings but only via deep-scroll. Surface
                  // them in the drawer next to the rest of the account menu.
                  { icon: Flag,    label: "بلاغاتي",                path: "/settings?section=reports" },
                  { icon: Shield,  label: "المستخدمون المحظورون",   path: "/settings?section=blocked" },
                  // إعدادات متقدمة links to the license management section,
                  // which is driver-only. For passengers this would link
                  // to a section that isn't rendered for them — confusing.
                  ...(user?.account_type === "driver" || user?.account_type === "both"
                    ? [{ icon: Settings, label: "إعدادات متقدمة", path: "/account-settings/profile#license" }]
                    : []
                  ),
                ].map(({ icon: Icon, label, path }) => (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setShowMobileMenu(false)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-foreground"
                  >
                    <Icon className="w-5 h-5 text-primary shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                  </Link>
                ))}
              </div>

              <div className="mx-4 my-1 border-t border-border" />

              {/* Quick Links Section */}
              <div className="py-2">
                <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider">روابط سريعة</p>
                {[
                  { icon: Heart,         label: "المفضلة",          path: "/favorites" },
                  ...(user?.account_type === "driver" || user?.account_type === "both"
                    ? [{ icon: Settings, label: "لوحة تحكم السائق", path: "/driver" }]
                    : []
                  ),
                ].map(({ icon: Icon, label, path }) => (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setShowMobileMenu(false)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-foreground"
                  >
                    <Icon className="w-5 h-5 text-primary shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                  </Link>
                ))}
              </div>

              <div className="mx-4 my-1 border-t border-border" />

              <div className="py-2">
                <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider">معلومات</p>
                {[
                  { icon: BookOpen,        label: "كيف يعمل مشوارو",    path: "/how-it-works" },
                { icon: Users,             label: "مجتمع مشواروو",      path: "/community" },
                { icon: Bell,           label: "إشعاراتي ومساراتي",  path: "/notifications" },
                { icon: MessageSquarePlus, label: "اقتراحات وشكاوى", path: "/feedback" },
                { icon: HelpCircle,     label: "المساعدة",            path: "/help" },
                { icon: Shield,         label: "الخصوصية والأمان",    path: "/privacy" },
                { icon: FileText,       label: "الشروط والأحكام",     path: "/terms" },
                { icon: Info,           label: "عن مشوارو",            path: "/about" },
                ].map(({ icon: Icon, label, path }) => (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setShowMobileMenu(false)}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-muted transition-colors text-muted-foreground"
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-sm">{label}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Admin Panel — only for admin role. Without this, admins on
                mobile had no in-app path from the drawer to /dashboard
                and had to type the URL by hand on every visit. Placed
                in its own bordered section just above sign-out for
                visual prominence. */}
            {user?.role === "admin" && (
              <div className="border-t border-border" dir="rtl">
                <Link
                  to="/dashboard"
                  onClick={() => setShowMobileMenu(false)}
                  className="flex items-center gap-3 w-full px-4 py-3 hover:bg-amber-100/60 transition-colors bg-amber-50/50 text-amber-900"
                >
                  <LayoutDashboard className="w-5 h-5 shrink-0 text-amber-600" />
                  <span className="text-sm font-medium">لوحة الإدارة</span>
                </Link>
              </div>
            )}

            {/* Sign Out + Version */}
            <div className="border-t border-border" dir="rtl">
              <button
                onClick={() => { setShowMobileMenu(false); api.auth.logout(); }}
                className="flex items-center gap-3 w-full px-4 py-3 hover:bg-destructive/10 transition-colors text-destructive"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span className="text-sm font-medium">تسجيل الخروج</span>
              </button>
              <p className="text-center text-[11px] text-muted-foreground pb-2">مشوارو · النسخة 1.0</p>
            </div>
              </>
            ) : (
              // ───────── Anonymous drawer ─────────
              // The drawer used to render the authenticated entries (Account
              // settings, verification, payments, sign-out, etc.) regardless
              // of auth state — anonymous visitors saw a header reading
              // "مرحباً" with an empty email line and links to features
              // they couldn't actually use, plus a "تسجيل الخروج" button
              // that did nothing for them. This branch shows a welcome
              // header with explicit sign-in/sign-up CTAs and only the
              // public surfaces (browse, info, support) that work without
              // an account.
              <>
                {/* Welcome header with auth CTAs */}
                <div className="bg-primary px-4 pt-6 pb-5" dir="rtl">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-primary-foreground/15 flex items-center justify-center overflow-hidden shrink-0">
                      <img src="/logo.png" alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-primary-foreground font-bold text-sm">أهلاً بك في مشوارو</p>
                      <p className="text-primary-foreground/75 text-[11px] truncate">سجّل دخولك لحجز ونشر الرحلات</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Link to="/login?signup=1" onClick={() => setShowMobileMenu(false)}>
                      <Button className="w-full h-10 bg-white text-primary hover:bg-white/90 rounded-xl text-xs font-bold">
                        إنشاء حساب
                      </Button>
                    </Link>
                    <Link to="/login" onClick={() => setShowMobileMenu(false)}>
                      <Button variant="outline" className="w-full h-10 bg-transparent border-white/40 text-primary-foreground hover:bg-white/10 rounded-xl text-xs font-bold">
                        تسجيل الدخول
                      </Button>
                    </Link>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto" dir="rtl">
                  {/* Browse — public, no account needed */}
                  <div className="py-2">
                    <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider">تصفح</p>
                    {[
                      { icon: Home,     label: "الرئيسية",        path: "/" },
                      { icon: Search,   label: "بحث عن رحلة",     path: "/search" },
                      { icon: BookOpen, label: "كيف يعمل مشوارو", path: "/how-it-works" },
                      { icon: Users,    label: "مجتمع مشوارو",    path: "/community" },
                    ].map(({ icon: Icon, label, path }) => (
                      <Link
                        key={path}
                        to={path}
                        onClick={() => setShowMobileMenu(false)}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-foreground"
                      >
                        <Icon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-sm font-medium">{label}</span>
                      </Link>
                    ))}
                  </div>

                  <div className="mx-4 my-1 border-t border-border" />

                  <div className="py-2">
                    <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider">معلومات</p>
                    {[
                      { icon: HelpCircle, label: "المساعدة",            path: "/help" },
                      { icon: Shield,     label: "الخصوصية والأمان",     path: "/privacy" },
                      { icon: FileText,   label: "الشروط والأحكام",     path: "/terms" },
                      { icon: Info,       label: "عن مشوارو",            path: "/about" },
                    ].map(({ icon: Icon, label, path }) => (
                      <Link
                        key={path}
                        to={path}
                        onClick={() => setShowMobileMenu(false)}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-muted transition-colors text-muted-foreground"
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-sm">{label}</span>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border py-2" dir="rtl">
                  <p className="text-center text-[11px] text-muted-foreground pb-1">مشوارو · النسخة 1.0</p>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ─── Center-FAB chooser sheet (only for "both" account users) ─── */}
      {showFabChooser && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[60]"
            onClick={() => setShowFabChooser(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[61] bg-card rounded-t-3xl shadow-2xl p-5 pb-8 safe-area-inset-bottom"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-4" />
            <h3 className="text-lg font-bold text-foreground text-center mb-1">ماذا تريد أن تفعل؟</h3>
            <p className="text-xs text-muted-foreground text-center mb-5">
              حسابك يدعم النشر والطلب — اختر ما يناسبك الآن
            </p>
            <div className="grid grid-cols-2 gap-3">
              <RouterLink
                to="/create-trip"
                onClick={() => setShowFabChooser(false)}
                className="flex flex-col items-center gap-2 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-2xl p-4 transition-colors active:scale-95"
              >
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Car className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-bold text-foreground">نشر رحلة</p>
                <p className="text-[11px] text-muted-foreground text-center leading-snug">
                  لديك سيارة وتريد ركاباً
                </p>
              </RouterLink>
              <RouterLink
                to="/request-trip"
                onClick={() => setShowFabChooser(false)}
                className="flex flex-col items-center gap-2 bg-accent/5 hover:bg-accent/10 border border-accent/20 rounded-2xl p-4 transition-colors active:scale-95"
              >
                <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center">
                  <MapPin className="w-6 h-6 text-accent" />
                </div>
                <p className="text-sm font-bold text-foreground">اطلب رحلة</p>
                <p className="text-[11px] text-muted-foreground text-center leading-snug">
                  تبحث عن سائق لرحلتك
                </p>
              </RouterLink>
            </div>
            <button
              type="button"
              onClick={() => setShowFabChooser(false)}
              className="w-full mt-4 py-2.5 text-sm text-muted-foreground hover:text-foreground"
            >
              إلغاء
            </button>
          </div>
        </>
      )}
    </div>
  );
}