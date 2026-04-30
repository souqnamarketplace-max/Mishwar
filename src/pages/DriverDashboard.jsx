import { useSEO } from "@/hooks/useSEO";
import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Car, Users, DollarSign, Star, ChevronDown, Plus, X,
  TrendingUp, CreditCard, CheckCircle
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import DriverStats from "../components/driver/DriverStats";
import DriverTripsList from "../components/driver/DriverTripsList";
import DriverPassengers from "../components/driver/DriverPassengers";
import DriverVehicleEditor from "../components/driver/DriverVehicleEditor";
import DriverRatePassengers from "../components/driver/DriverRatePassengers";
import DriverPaymentSetup from "../components/driver/DriverPaymentSetup";

// ─── Tab definitions ────────────────────────────────────────────────────────
const TABS = [
  { id: "trips",      label: "رحلاتي",      icon: Car,        color: "text-primary"   },
  { id: "passengers", label: "الركاب",       icon: Users,      color: "text-blue-600"  },
  { id: "earnings",   label: "الأرباح",      icon: DollarSign, color: "text-green-600" },
  { id: "ratings",    label: "التقييمات",    icon: Star,       color: "text-yellow-600"},
  { id: "vehicle",    label: "مركبتي",       icon: Car,        color: "text-accent"    },
  { id: "payments",   label: "الدفع",        icon: CreditCard, color: "text-purple-600"},
];

// ─── Mobile dropdown tab selector ──────────────────────────────────────────
function MobileTabSelector({ tabs, active, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activeTab = tabs.find(t => t.id === active) || tabs[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative md:hidden mb-4" dir="rtl">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 bg-card border border-border rounded-2xl px-4 py-3.5 text-right shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl bg-muted flex items-center justify-center`}>
            <activeTab.icon className={`w-4 h-4 ${activeTab.color}`} />
          </div>
          <span className="font-semibold text-foreground">{activeTab.label}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="absolute top-full right-0 left-0 mt-1.5 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-50">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              onClick={() => { onChange(tab.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-right transition-colors ${
                i < tabs.length - 1 ? "border-b border-border/50" : ""
              } ${tab.id === active ? "bg-primary/5" : "hover:bg-muted/50"}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                tab.id === active ? "bg-primary/10" : "bg-muted"
              }`}>
                <tab.icon className={`w-4 h-4 ${tab.id === active ? tab.color : "text-muted-foreground"}`} />
              </div>
              <span className={`font-medium text-sm ${tab.id === active ? "text-foreground" : "text-muted-foreground"}`}>
                {tab.label}
              </span>
              {tab.id === active && (
                <CheckCircle className="w-4 h-4 text-primary mr-auto" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Desktop tab bar ────────────────────────────────────────────────────────
function DesktopTabBar({ tabs, active, onChange }) {
  return (
    <div className="hidden md:flex gap-1 bg-muted/50 p-1 rounded-xl mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
            active === tab.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <tab.icon className="w-4 h-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Earnings tab (inline) ──────────────────────────────────────────────────
function EarningsTab({ bookings, trips, totalEarnings }) {
  const confirmed = bookings.filter(b => b.status === "confirmed" || b.status === "completed");
  const byMethod = confirmed.reduce((acc, b) => {
    const m = b.payment_method || "cash";
    acc[m] = (acc[m] || 0) + (b.total_price || 0);
    return acc;
  }, {});
  const methodLabel = { cash: "نقداً 💵", bank_transfer: "تحويل 🏦", reflect: "Reflect 💜", jawwal_pay: "Jawwal 📱", card: "بطاقة 💳" };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Summary card */}
      <div className="bg-gradient-to-br from-primary to-accent rounded-2xl p-5 text-primary-foreground">
        <p className="text-sm opacity-80 mb-1">إجمالي الأرباح</p>
        <p className="text-4xl font-black">₪{totalEarnings.toLocaleString()}</p>
        <p className="text-xs opacity-70 mt-2">{confirmed.length} حجز مؤكد</p>
      </div>

      {/* By payment method */}
      {Object.keys(byMethod).length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="font-bold text-sm mb-3">حسب طريقة الدفع</p>
          <div className="space-y-2">
            {Object.entries(byMethod).map(([method, amount]) => (
              <div key={method} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-sm font-medium">₪{amount.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground">{methodLabel[method] || method}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-trip breakdown */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <p className="font-bold text-sm mb-3">تفصيل الرحلات</p>
        {trips.length === 0
          ? <p className="text-sm text-muted-foreground text-center py-4">لا توجد رحلات بعد</p>
          : trips.slice(0, 10).map(trip => {
              const tripBookings = confirmed.filter(b => b.trip_id === trip.id);
              const earned = tripBookings.reduce((s, b) => s + (b.total_price || 0), 0);
              if (earned === 0) return null;
              return (
                <div key={trip.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                  <span className="text-sm font-bold text-primary">₪{earned}</span>
                  <div className="text-right">
                    <p className="text-sm font-medium">{trip.from_city} ← {trip.to_city}</p>
                    <p className="text-xs text-muted-foreground">{trip.date} · {tripBookings.length} راكب</p>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function DriverDashboard() {
  useSEO({ title: "لوحة السائق", description: "لوحة قيادة السائق في مِشوار" });

  const [activeTab, setActiveTab] = useState("trips");
  const [selectedTripId, setSelectedTripId] = useState(null);
  const qc = useQueryClient();

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => base44.auth.me() });

  const { data: trips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ["driver-trips", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Trip.filter({ driver_email: user.email }, "-created_date", 50)
      : [],
    enabled: !!user?.email,
  });

  const tripIds = trips.map(t => t.id);
  const { data: allBookings = [] } = useQuery({
    queryKey: ["driver-bookings", user?.email],
    queryFn: () => base44.entities.Booking.list("-created_date", 500),
    enabled: !!user?.email,
  });
  const bookings = allBookings.filter(b => tripIds.includes(b.trip_id));

  const totalEarnings    = bookings.filter(b => b.status === "confirmed" || b.status === "completed").reduce((s, b) => s + (b.total_price || 0), 0);
  const totalPassengers  = bookings.filter(b => b.status !== "cancelled").length;
  const activeTrips      = trips.filter(t => t.status === "confirmed" || t.status === "in_progress").length;
  const completedTrips   = trips.filter(t => t.status === "completed").length;

  // Realtime
  React.useEffect(() => {
    if (!user?.email) return;
    const u = base44.entities.Booking.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["driver-bookings", user.email] });
      qc.invalidateQueries({ queryKey: ["driver-trips", user.email] });
    });
    return () => u();
  }, [user?.email, qc]);

  const handleTabChange = (tab) => setActiveTab(tab);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8" dir="rtl">

      {/* ── Mobile header: compact ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">لوحة السائق</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">أدِر رحلاتك وتابع أرباحك</p>
        </div>
        <Link to="/create-trip">
          <Button className="bg-primary text-primary-foreground rounded-xl gap-1.5 h-9 px-3 sm:h-10 sm:px-4 text-sm">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">رحلة جديدة</span>
            <span className="sm:hidden">أضف</span>
          </Button>
        </Link>
      </div>

      {/* ── Stats grid: 2×2 on mobile, 4 columns on lg ── */}
      <DriverStats
        totalEarnings={totalEarnings}
        totalPassengers={totalPassengers}
        activeTrips={activeTrips}
        completedTrips={completedTrips}
      />

      {/* ── Mobile: dropdown selector ── */}
      <MobileTabSelector tabs={TABS} active={activeTab} onChange={handleTabChange} />

      {/* ── Desktop: horizontal tab bar ── */}
      <DesktopTabBar tabs={TABS} active={activeTab} onChange={handleTabChange} />

      {/* ── Content ── */}
      <div>
        {activeTab === "trips" && (
          <DriverTripsList
            trips={trips}
            bookings={bookings}
            loading={tripsLoading}
            onSelectTrip={(id) => { setSelectedTripId(id); setActiveTab("passengers"); }}
          />
        )}

        {activeTab === "passengers" && (
          <DriverPassengers
            trips={trips}
            bookings={bookings}
            selectedTripId={selectedTripId}
            onSelectTrip={setSelectedTripId}
          />
        )}

        {activeTab === "earnings" && (
          <EarningsTab bookings={bookings} trips={trips} totalEarnings={totalEarnings} />
        )}

        {activeTab === "ratings" && (
          <DriverRatePassengers trips={trips} bookings={bookings} />
        )}

        {activeTab === "vehicle" && (
          <DriverVehicleEditor user={user} />
        )}

        {activeTab === "payments" && (
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-1">طرق استلام المدفوعات</h3>
            <p className="text-sm text-muted-foreground mb-4">أضف بياناتك لاستلام مدفوعات الرحلات من الركاب</p>
            <DriverPaymentSetup user={user} />
          </div>
        )}
      </div>
    </div>
  );
}
