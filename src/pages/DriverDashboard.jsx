import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, Users, DollarSign, TrendingUp, Plus, BarChart2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import DriverStats from "../components/driver/DriverStats";
import DriverTripsList from "../components/driver/DriverTripsList";
import DriverPassengers from "../components/driver/DriverPassengers";
import DriverVehicleEditor from "../components/driver/DriverVehicleEditor";

const tabs = [
  { id: "trips", label: "رحلاتي", icon: Car },
  { id: "passengers", label: "الركاب", icon: Users },
  { id: "earnings", label: "الأرباح", icon: DollarSign },
  { id: "vehicle", label: "مركبتي", icon: Car },
];

export default function DriverDashboard() {
  const [activeTab, setActiveTab] = useState("trips");
  const [selectedTripId, setSelectedTripId] = useState(null);

  const { data: trips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 50),
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["bookings"],
    queryFn: () => base44.entities.Booking.list("-created_date", 100),
  });

  // Stats
  const totalEarnings = bookings
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .reduce((sum, b) => sum + (b.total_price || 0), 0);
  const totalPassengers = bookings.filter((b) => b.status !== "cancelled").length;
  const activeTrips = trips.filter((t) => t.status === "confirmed" || t.status === "in_progress").length;
  const completedTrips = trips.filter((t) => t.status === "completed").length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
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

      {activeTab === "vehicle" && (
        <DriverVehicleEditor trips={trips} />
      )}
    </div>
  );
}

function EarningsTab({ bookings, trips, totalEarnings }) {
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو"];
  const monthlyData = months.map((m, i) => ({
    month: m,
    amount: Math.floor(Math.random() * 800 + 200),
  }));
  const maxAmount = Math.max(...monthlyData.map((d) => d.amount));

  const confirmed = bookings.filter((b) => b.status === "confirmed" || b.status === "completed");

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "إجمالي الأرباح", value: `₪${totalEarnings.toLocaleString()}`, color: "text-primary", bg: "bg-primary/10" },
          { label: "هذا الشهر", value: `₪${Math.floor(totalEarnings * 0.3)}`, color: "text-accent", bg: "bg-accent/10" },
          { label: "المعلق للصرف", value: `₪${Math.floor(totalEarnings * 0.15)}`, color: "text-yellow-600", bg: "bg-yellow-500/10" },
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
                  <p className="text-xs text-muted-foreground">{b.seats_booked || 1} مقعد • {new Date(b.created_date).toLocaleDateString("ar")}</p>
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