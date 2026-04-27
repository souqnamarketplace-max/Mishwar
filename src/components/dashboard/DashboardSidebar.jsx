import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, CalendarCheck, Truck, CreditCard,
  Star, BarChart3, Bell, Headphones, FileText, Tag, Settings, Activity, Home, LogOut
} from "lucide-react";

const menuItems = [
  { icon: Home, label: "الرئيسية", path: "/dashboard" },
  { icon: LayoutDashboard, label: "لوحة التحكم", path: "/dashboard" },
  { icon: Users, label: "إدارة المستخدمين", path: "/dashboard" },
  { icon: Car, label: "إدارة الرحلات", path: "/dashboard" },
  { icon: CalendarCheck, label: "إدارة الحجوزات", path: "/dashboard" },
  { icon: Truck, label: "إدارة المركبات", path: "/dashboard" },
  { icon: CreditCard, label: "المعاملات والمدفوعات", path: "/dashboard" },
  { icon: Star, label: "التقييمات والمراجعات", path: "/dashboard" },
  { icon: BarChart3, label: "التقارير والإحصائيات", path: "/dashboard" },
  { icon: Bell, label: "الإشعارات", path: "/dashboard" },
  { icon: Headphones, label: "الدعم والشكاوى", path: "/dashboard" },
  { icon: FileText, label: "إدارة المحتوى", path: "/dashboard" },
  { icon: Tag, label: "إدارة العروض والكوبونات", path: "/dashboard" },
  { icon: Settings, label: "إعدادات النظام", path: "/dashboard" },
  { icon: Activity, label: "سجل النشاطات", path: "/dashboard" },
];

export default function DashboardSidebar() {
  const location = useLocation();

  return (
    <aside className="hidden lg:flex flex-col w-64 bg-sidebar border-l border-sidebar-border min-h-screen sticky top-0">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sidebar-primary rounded-xl flex items-center justify-center">
            <span className="text-sidebar-primary-foreground font-bold text-lg">س</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-sidebar-foreground">سيرتنا</h1>
            <p className="text-[10px] text-sidebar-foreground/50">شارك الطريق، وفر أكثر</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {menuItems.map((item) => (
          <Link
            key={item.label}
            to={item.path}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
              location.pathname === item.path && item.label === "الرئيسية"
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }`}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
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