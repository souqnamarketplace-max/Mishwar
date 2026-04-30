import { useSEO } from "@/hooks/useSEO";
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, Users, DollarSign, TrendingUp, Plus, BarChart2, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import DriverStats from "../components/driver/DriverStats";
import DriverTripsList from "../components/driver/DriverTripsList";
import DriverPassengers from "../components/driver/DriverPassengers";
import DriverVehicleEditor from "../components/driver/DriverVehicleEditor";
import DriverRatePassengers from "../components/driver/DriverRatePassengers";
import DriverPaymentSetup from "../components/driver/DriverPaymentSetup";

const tabs = [
  { id: "trips", label: "رحلاتي", icon: Car },
  { id: "passengers", label: "الركاب", icon: Users },
  { id: "earnings", label: "الأرباح", icon: DollarSign },
  { id: "ratings", label: "التقييمات", icon: Star },
  { id: "vehicle", label: "مركبتي", icon: Car },
  { id: "payments", label: "الدفع", icon: DollarSign },
];

export default function DriverDashboard() {
  useSEO({ title: "لوحة السائق", description: "لوحة قيادة السائق في مِشوار" });

  const [activeTab, setActiveTab] = useState("trips");
  const [selectedTripId, setSelectedTripId] = useState(null);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  // Only load THIS driver's trips
  const { data: trips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ["driver-trips", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Trip.filter({ driver_email: user.email }, "-created_date", 50)
      : [],
    enabled: !!user?.email,
  });

  // Only load bookings for THIS driver's trips
  const tripIds = trips.map(t => t.id);
  const { data: allBookings = [] } = useQuery({
    queryKey: ["driver-bookings", user?.email],
    queryFn: () => base44.entities.Booking.list("-created_date", 500),
    enabled: !!user?.email,
  });
  const bookings = allBookings.filter(b => tripIds.includes(b.trip_id));

  // Stats — scoped to this driver only
  const totalEarnings = bookings
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .reduce((sum, b) => sum + (b.total_price || 0), 0);
  const totalPassengers = bookings.filter((b) => b.status !== "cancelled").length;
  const activeTrips = trips.filter((t) => t.status === "confirmed" || t.status === "in_progress").length;
  const completedTrips = trips.filter((t) => t.status === "completed").length;

  // Realtime: new bookings appear instantly in driver dashboard
  React.useEffect(() => {
    if (!user?.email) return;
    const u = base44.entities.Booking.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["driver-bookings", user.email] });
      qc.invalidateQueries({ queryKey: ["driver-trips", user.email] });
    });
    return () => u();
  }, [user?.email]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">لوحة السائق</h1>
          <p className="text-sm text-muted-foreground mt-0.5">أدِر رحلاتك وتابع أرباحك</p>
        </div>
        <Link to="/create-trip">
          <Button className="bg-primary text-primary-foreground rounded-xl gap-2 h-10">
            <Plus className="w-4 h-4" />
            رحلة جديدة
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <DriverStats
        totalEarnings={totalEarnings}
        totalPassengers={totalPassengers}
        activeTrips={activeTrips}
        completedTrips={completedTrips}
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-xl mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-1 justify-center ${
              activeTab === tab.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
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
        <DriverVehicleEditor />
      )}

      {activeTab === "payments" && user && (
        <DriverPaymentSetup user={user} />
      )}
    </div>
  );
}

function EarningsTab({ bookings, trips, totalEarnings }) {
  // Build real monthly earnings from actual bookings
  const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const now = new Date();
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const month = monthNames[d.getMonth()];
    const amount = bookings
      .filter(b => {
        if (b.status !== "confirmed" && b.status !== "completed") return false;
        const bd = new Date(b.created_at);
        return bd.getFullYear() === d.getFullYear() && bd.getMonth() === d.getMonth();
      })
      .reduce((sum, b) => sum + (b.total_price || 0), 0);
    return { month, amount };
  });
  const maxAmount = Math.max(...monthlyData.map((d) => d.amount), 1);

  // Real "this month" earnings
  const thisMonth = bookings.filter(b => {
    if (b.status !== "confirmed" && b.status !== "completed") return false;
    const bd = new Date(b.created_at);
    return bd.getMonth() === now.getMonth() && bd.getFullYear() === now.getFullYear();
  }).reduce((sum, b) => sum + (b.total_price || 0), 0);

  // Pending = pending bookings
  const pendingEarnings = bookings
    .filter(b => b.status === "pending")
    .reduce((sum, b) => sum + (b.total_price || 0), 0);

  const confirmed = bookings.filter((b) => b.status === "confirmed" || b.status === "completed");

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "إجمالي الأرباح", value: `₪${totalEarnings.toLocaleString()}`, color: "text-primary", bg: "bg-primary/10" },
          { label: "هذا الشهر", value: `₪${thisMonth.toLocaleString()}`, color: "text-accent", bg: "bg-accent/10" },
          { label: "معلق (قيد الانتظار)", value: `₪${pendingEarnings.toLocaleString()}`, color: "text-yellow-600", bg: "bg-yellow-500/10" },
        ].map((card) => (
          <div key={card.label} className="bg-card rounded-2xl border border-border p-5">
            <div className={`w-10 h-10 rounded-xl ${card.bg} flex items-center justify-center mb-3`}>
              <DollarSign className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-sm text-muted-foreground mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Monthly Bar Chart */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-5">
          <BarChart2 className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-foreground">الأرباح الشهرية</h3>
        </div>
        <div className="flex items-end gap-3 h-40">
          {monthlyData.map((d) => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-muted-foreground">₪{d.amount}</span>
              <div
                className="w-full rounded-t-lg bg-primary/80 transition-all"
                style={{ height: `${(d.amount / maxAmount) * 100}%` }}
              />
              <span className="text-xs text-muted-foreground">{d.month}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Transactions */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-bold text-foreground">آخر المعاملات</h3>
        </div>
        {confirmed.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">لا توجد معاملات بعد</div>
        ) : (
          <div className="divide-y divide-border">
            {confirmed.slice(0, 10).map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{b.passenger_name || "راكب"}</p>
                  <p className="text-xs text-muted-foreground">{b.seats_booked || 1} مقعد • {new Date(b.created_at).toLocaleDateString("ar")}</p>
                </div>
                <span className="text-sm font-bold text-primary">+₪{b.total_price || 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}