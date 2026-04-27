import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import {
  Car, MapPin, Clock, Star, Users, ArrowLeft, Download,
  Search, CheckCircle, AlertCircle, XCircle, Navigation
} from "lucide-react";

const tabs = [
  { id: "all", label: "الكل", icon: Car },
  { id: "confirmed", label: "القادمة", icon: Clock },
  { id: "in_progress", label: "يتم تنفيذها", icon: Navigation },
  { id: "completed", label: "المكتملة", icon: CheckCircle },
  { id: "cancelled", label: "الملغاة", icon: XCircle },
];

const statusConfig = {
  confirmed: { label: "مؤكدة", color: "bg-accent/10 text-accent border-accent/20" },
  in_progress: { label: "مباشر", color: "bg-primary/10 text-primary border-primary/20" },
  completed: { label: "مكتملة", color: "bg-muted text-muted-foreground border-border" },
  cancelled: { label: "ملغاة", color: "bg-destructive/10 text-destructive border-destructive/20" },
};

export default function MyTrips() {
  const [activeTab, setActiveTab] = useState("all");

  const { data: trips = [], isLoading } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 50),
  });

  const filtered = activeTab === "all" ? trips : trips.filter((t) => t.status === activeTab);

  const grouped = {
    confirmed: filtered.filter((t) => t.status === "confirmed"),
    in_progress: filtered.filter((t) => t.status === "in_progress"),
    completed: filtered.filter((t) => t.status === "completed"),
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Car className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">رحلاتي</h1>
        <p className="text-muted-foreground text-sm mt-1">جميع رحلاتك الحالية والسابقة في مكان واحد</p>
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

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-2xl border p-6 animate-pulse">
              <div className="h-5 bg-muted rounded w-48 mb-3" />
              <div className="h-4 bg-muted rounded w-32" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Car className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات</h3>
          <p className="text-muted-foreground text-sm mb-4">ابدأ بحجز رحلة أو أنشئ رحلة جديدة</p>
          <div className="flex justify-center gap-3">
            <Link to="/search"><Button className="rounded-xl">ابحث عن رحلة</Button></Link>
            <Link to="/create-trip"><Button variant="outline" className="rounded-xl">أنشر رحلة</Button></Link>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([status, statusTrips]) => {
            if (statusTrips.length === 0) return null;
            const config = statusConfig[status];
            return (
              <div key={status}>
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  {config?.label || status}
                  <span className="text-sm font-normal text-muted-foreground">({statusTrips.length})</span>
                </h3>
                <div className="space-y-3">
                  {statusTrips.map((trip) => (
                    <Link key={trip.id} to={`/trip/${trip.id}`}>
                      <div className="bg-card rounded-2xl border border-border p-4 hover:shadow-md transition-all">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          {/* Date */}
                          <div className="text-center bg-muted/50 rounded-xl px-4 py-3 shrink-0">
                            <p className="text-xs text-muted-foreground">{trip.date?.split(" ")[0] || "السبت"}</p>
                            <p className="text-2xl font-bold text-foreground">{trip.date?.split(" ")[1] || "25"}</p>
                            <p className="text-xs text-muted-foreground">{trip.time || "08:30"}</p>
                          </div>

                          {/* Route */}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 font-bold text-foreground mb-1">
                              <MapPin className="w-4 h-4 text-primary" />
                              <span>{trip.from_city}</span>
                              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                              <span>{trip.to_city}</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Users className="w-3.5 h-3.5" />
                                {trip.available_seats} مقاعد
                              </span>
                              <span className="flex items-center gap-1">
                                <Star className="w-3.5 h-3.5 text-yellow-500" />
                                {trip.driver_rating || "4.5"}
                              </span>
                            </div>
                          </div>

                          {/* Price + Status */}
                          <div className="flex items-center gap-3">
                            <Badge className={config?.color}>
                              {config?.label}
                            </Badge>
                            <span className="text-xl font-bold text-primary">₪{trip.price}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}