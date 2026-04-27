import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Heart, Car, Users, MapPin, Star, ArrowLeft } from "lucide-react";
import TripCard from "../components/shared/TripCard";

const tabs = [
  { id: "all", label: "جميع المفضلة", icon: Heart },
  { id: "trips", label: "الرحلات", icon: Car },
  { id: "drivers", label: "السائقون", icon: Users },
  { id: "routes", label: "المسارات", icon: MapPin },
];

const sampleDrivers = [
  { name: "أحمد أبو الخير", rating: 4.8, trips: 170, since: "يناير 2025", badge: "سائق موثق" },
  { name: "محمد درويش", rating: 4.6, trips: 89, since: "مارس 2022", badge: "سائق نشط" },
  { name: "سامي أبو أحمد", rating: 4.7, trips: 801, since: "أكتوبر 2022", badge: "سائق نشط" },
  { name: "يوسف حمدان", rating: 4.5, trips: 210, since: "ديسمبر 2022", badge: "سائق موثق" },
];

const sampleRoutes = [
  { from: "رام الله", to: "غزة", count: 18 },
  { from: "نابلس", to: "رام الله", count: 12 },
  { from: "الخليل", to: "بيت لحم", count: 8 },
  { from: "جنين", to: "نابلس", count: 5 },
];

export default function Favorites() {
  const [activeTab, setActiveTab] = useState("all");

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 20),
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
          <Heart className="w-7 h-7 text-destructive" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">المفضلة</h1>
        <p className="text-muted-foreground text-sm mt-1">رحلاتك وحجوزاتك المفضلة في مكان واحد</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-card border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="space-y-8">
        {/* Trips */}
        {(activeTab === "all" || activeTab === "trips") && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">رحلات مفضلة</h3>
              <button className="text-sm text-primary hover:underline">عرض الكل</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {trips.slice(0, 3).map((trip) => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </div>
          </div>
        )}

        {/* Drivers */}
        {(activeTab === "all" || activeTab === "drivers") && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">سائقون مفضلون</h3>
              <button className="text-sm text-primary hover:underline">عرض الكل</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {sampleDrivers.map((driver) => (
                <div key={driver.name} className="bg-card rounded-2xl border border-border p-4 text-center hover:shadow-md transition-all">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary mx-auto mb-3">
                    {driver.name[0]}
                  </div>
                  <Heart className="w-4 h-4 text-destructive fill-destructive absolute top-3 left-3" />
                  <h4 className="font-bold">{driver.name}</h4>
                  <div className="flex items-center justify-center gap-1 mt-1 mb-2">
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-medium">{driver.rating}</span>
                    <span className="text-xs text-muted-foreground">({driver.trips})</span>
                  </div>
                  <p className="text-xs text-muted-foreground">عضو منذ {driver.since}</p>
                  <span className="inline-block mt-2 px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full">{driver.badge}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Routes */}
        {(activeTab === "all" || activeTab === "routes") && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">مسارات مفضلة</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {sampleRoutes.map((route) => (
                <div key={route.from + route.to} className="bg-card rounded-2xl border border-border p-4 hover:shadow-md transition-all">
                  <div className="flex items-center gap-2 font-bold text-foreground mb-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span>{route.from}</span>
                    <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                    <span>{route.to}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{route.count} رحلة متاحة</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}