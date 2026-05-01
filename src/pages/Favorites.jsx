import { useSEO } from "@/hooks/useSEO";
import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Heart, Search, Bell, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import TripCard from "../components/shared/TripCard";

export default function Favorites() {
  useSEO({ title: "المفضلة", description: "الرحلات المفضلة لديك" });
  const [, forceUpdate] = useState(0);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  const { data: trips = [], isLoading } = useQuery({
    queryKey: ["trips-all"],
    queryFn: () => base44.entities.Trip.list("-created_date", 200),
  });

  // Read/write favorites from localStorage
  const favKey = `mishwar-favs-${user?.email || "anon"}`;
  const getFavIds = useCallback(() => {
    try { return new Set(JSON.parse(localStorage.getItem(favKey) || "[]")); }
    catch { return new Set(); }
  }, [favKey]);

  const removeFav = (tripId) => {
    const favs = getFavIds();
    favs.delete(tripId);
    localStorage.setItem(favKey, JSON.stringify([...favs]));
    forceUpdate(n => n + 1); // re-render without reload
  };

  const favIds = getFavIds();
  const favTrips = trips.filter(t => favIds.has(t.id));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <Heart className="w-6 h-6 text-destructive fill-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-black text-foreground">الرحلات المفضلة</h1>
          <p className="text-sm text-muted-foreground">{favTrips.length} رحلة محفوظة</p>
        </div>
      </div>

      {/* Trips */}
      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-card rounded-2xl border border-border p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : favTrips.length === 0 ? (
        <div className="text-center py-20">
          <Heart className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
          <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات مفضلة بعد</h3>
          <p className="text-muted-foreground text-sm mb-6">
            اضغط على ❤️ في أي رحلة لحفظها هنا
          </p>
          <Link to="/search">
            <Button className="rounded-xl gap-2 bg-primary text-primary-foreground">
              <Search className="w-4 h-4" />
              ابحث عن رحلات
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {favTrips.map(trip => (
            <div key={trip.id} className="relative">
              {/* Remove button */}
              <button
                onClick={() => removeFav(trip.id)}
                className="absolute top-4 left-4 z-10 w-8 h-8 rounded-full bg-destructive flex items-center justify-center shadow-md hover:bg-destructive/80 transition-colors"
                title="إزالة من المفضلة"
              >
                <Heart className="w-4 h-4 text-white fill-white" />
              </button>
              <TripCard trip={trip} />
            </div>
          ))}
        </div>
      )}

      {/* Route alerts promo */}
      <div className="mt-8 bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Bell className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm text-foreground">تنبيهات المسارات</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            هل تريد إشعاراً عند توفر رحلة بين مدينتين بشكل دوري؟
          </p>
          <Link to="/notifications" className="text-primary text-xs font-bold hover:underline mt-1 inline-flex items-center gap-1">
            إضافة مسار مفضل <ArrowLeft className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
