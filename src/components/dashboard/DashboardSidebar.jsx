import React from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, CalendarCheck, CreditCard, Wallet,
  Star, BarChart3, Bell, Headphones, FileText, Tag, Settings, Activity, Home, LogOut, Shield, MessageSquarePlus, ImageIcon, Flag, ChevronDown, MapPin
} from "lucide-react";

const menuItems = [
  { id: "overview", icon: LayoutDashboard, label: "لوحة التحكم" },
  { id: "users", icon: Users, label: "إدارة المستخدمين" },
  { id: "trips", icon: Car, label: "إدارة الرحلات" },
  { id: "bookings", icon: CalendarCheck, label: "إدارة الحجوزات" },
  { id: "reviews", icon: Star, label: "التقييمات والمراجعات" },
  { id: "payments", icon: CreditCard, label: "المعاملات والمدفوعات" },
  { id: "subscriptions", icon: Wallet, label: "اشتراكات السائقين" },
  { id: "reports", icon: Flag, label: "بلاغات المستخدمين" },
  { id: "notifications", icon: Bell, label: "الإشعارات" },
  { id: "support", icon: Headphones, label: "الدعم والشكاوى" },
  { id: "feedback", icon: MessageSquarePlus, label: "الاقتراحات والشكاوى" },
  { id: "licenses", icon: Shield, label: "توثيق السائقين" },
  { id: "cities", icon: MapPin, label: "المدن المقترحة" },
  { id: "content", icon: FileText, label: "إدارة المحتوى" },
  { id: "hero-slides", icon: ImageIcon, label: "شرائح الصفحة الرئيسية" },
  // OFFERS / COUPONS — HIDDEN FOR v1.0 LAUNCH (M-06 in pre-launch audit).
  // The admin UI to CREATE coupons works, but the redemption side is
  // completely unwired: there's no input field on the booking flow,
  // no validation RPC, no uses_count increment, no per-user redemption
  // tracking. Shipping the create-only side risks an admin generating
  // a code, sharing it on social, and customers being unable to redeem
  // it — which damages launch trust.
  // Re-enable when the redemption pipeline ships (post-launch).
  // { id: "offers", icon: Tag, label: "إدارة العروض والكوبونات" },
  { id: "settings", icon: Settings, label: "إعدادات النظام" },
  { id: "logs", icon: Activity, label: "سجل النشاطات" },
];

/**
 * Mobile-only dropdown picker for the 16 admin tabs.
 *
 * Without this, mobile admins lost ALL navigation between admin sections
 * — the desktop <aside> sidebar is `hidden lg:flex` (≥1024px) and nothing
 * replaced it below that breakpoint. So an admin on a phone could land on
 * the overview page but had no way to reach Users / Trips / Bookings /
 * Reports / Logs / etc. Mirrors the pattern used by DriverDashboard's
 * MobileTabSelector for consistency.
 */
export function DashboardMobileTabSelector({ activePage, setActivePage }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const active = menuItems.find(m => m.id === activePage) || menuItems[0];

  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="lg:hidden mb-4 relative" dir="rtl">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 bg-card border border-border rounded-2xl px-4 py-3 text-right shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <active.icon className="w-4 h-4 text-primary" />
          </div>
          <span className="font-semibold text-foreground text-sm">{active.label}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 mt-1.5 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {menuItems.map((item, i) => (
            <button
              key={item.id}
              onClick={() => { setActivePage(item.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-colors ${
                i < menuItems.length - 1 ? "border-b border-border/50" : ""
              } ${item.id === activePage ? "bg-primary/5" : "hover:bg-muted/50"}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                item.id === activePage ? "bg-primary/10" : "bg-muted"
              }`}>
                <item.icon className={`w-4 h-4 ${item.id === activePage ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <span className={`font-medium text-sm ${item.id === activePage ? "text-foreground" : "text-muted-foreground"}`}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardSidebar({ activePage, setActivePage }) {
  return (
    <aside className="hidden lg:flex flex-col w-64 bg-sidebar border-l border-sidebar-border min-h-screen sticky top-0">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sidebar-primary rounded-xl flex items-center justify-center">
            <img src="/logo.png" alt="مشوارو" className="w-8 h-8 rounded-lg object-cover" />
          </div>
          <div>
            <h1 className="text-base font-bold text-sidebar-foreground">مِشوار</h1>
            <p className="text-[10px] text-sidebar-foreground/50">شارك الطريق، وفر أكثر</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 w-full text-right ${
              activePage === item.id
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <Link to="/" className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground rounded-lg">
          <Home className="w-4 h-4" />
          عرض الموقع
        </Link>
        <button className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-sidebar-accent rounded-lg w-full">
          <LogOut className="w-4 h-4" />
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}