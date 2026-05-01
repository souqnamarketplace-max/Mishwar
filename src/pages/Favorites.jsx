import { useSEO } from "@/hooks/useSEO";
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Car, Users, MapPin, Star, ArrowLeft, Bell, TrendingDown, Clock, ChevronLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import TripCard from "../components/shared/TripCard";
import EmptyState from "@/components/shared/EmptyState";

const tabs = [
  { id: "all", label: "جميع المفضلة", icon: Heart },
  { id: "trips", label: "الرحلات", icon: Car },
  { id: "drivers", label: "السائقون", icon: Users },
  { id: "routes", label: "المسارات", icon: MapPin },
];

const sidebarItems = [
  { icon: TrendingDown, title: "تحديثات الأسعار", desc: "تحصل على إشعارات عند انخفاض أسعار الرحلات في مساراتك المفضلة" },
  { icon: Bell, title: "إشعارات الرحلات", desc: "تلقّ إشعارات فورية عند إضافة رحلات جديدة لمساراتك المفضلة" },
  { icon: Clock, title: "المفضلة مؤخراً", desc: "عرض آخر العناصر التي أضفتها لقائمة المفضلة لديك" },
];

export default function Favorites() {
  useSEO({ title: "المفضلة", description: "الرحلات والمسارات المفضلة لديك" });

  const [activeTab, setActiveTab] = useState("all");
  const [favorites, setFavorites] = useState(new Set());
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  // Read favorited trip IDs from localStorage
  const getFavIds = (email) => {
    try { return new Set(JSON.parse(localStorage.getItem(`mishwar-favs-${email || "anon"}`) || "[]")); }
    catch { return new Set(); }
  };

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 200),
  });

  const { data: userPreferences = [] } = useQuery({
    queryKey: ["preferences", user?.email],
    queryFn: () => user?.email ? base44.entities.TripPreference.filter({ user_email: user.email }) : [],
    enabled: !!user?.email,
  });

  // REAL DB: drivers the user has previously booked rides with
  const { data: pastBookings = [] } = useQuery({
    queryKey: ["favorites-bookings", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Booking.filter({ passenger_email: user.email }, "-created_date", 50)
      : [],
    enabled: !!user?.email,
  });

  // Get unique drivers from those bookings (cross-ref via trips)
  const bookedTripIds = pastBookings.map(b => b.trip_id).filter(Boolean);
  // Filter out user-dismissed favorites
  const getDismissedIds = () => {
    const key = `mishwar-dismissed-favs-${user?.email || "anon"}`;
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
  };
  const sampleDrivers = React.useMemo(() => {
    const driversMap = new Map();
    const dismissedIds = getDismissedIds();
    trips.filter(t => bookedTripIds.includes(t.id) && !dismissedIds.has(String(t.id))).forEach(t => {
      if (!t.driver_email) return;
      if (!driversMap.has(t.driver_email)) {
        driversMap.set(t.driver_email, {
          name: t.driver_name || "سائق",
          email: t.driver_email,
          rating: t.driver_rating || 0,
          trips: 0,
          since: t.created_at ? new Date(t.created_at).toLocaleDateString("ar", { month: "long", year: "numeric" }) : "",
          badge: (t.driver_rating || 0) >= 4.5 ? "سائق موثق" : "سائق نشط",
        });
      }
      driversMap.get(t.driver_email).trips += 1;
    });
    return Array.from(driversMap.values());
  }, [trips, bookedTripIds]);

  // Routes from preferences (the ones the user is following)
  const sampleRoutes = userPreferences
    .filter(p => p.from_city && p.to_city)
    .map(p => ({ from: p.from_city, to: p.to_city, count: 0 }));

  const enablePriceMutation = useMutation({
    mutationFn: async () => {
      if (userPreferences.length > 0) {
        const prefs = userPreferences[0];
        await base44.entities.TripPreference.update(prefs.id, { notify_on_price: true });
      } else {
        await base44.entities.TripPreference.create({
          user_email: user?.email,
          user_name: user?.full_name,
          from_city: "",
          to_city: "",
          notify_on_price: true,
          notify_on_date: false,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preferences", user?.email] });
      toast.success("تم تفعيل تحديثات الأسعار ✓");
    },
  });

  const enableTripMutation = useMutation({
    mutationFn: async () => {
      if (userPreferences.length > 0) {
        const prefs = userPreferences[0];
        await base44.entities.TripPreference.update(prefs.id, { notify_on_date: true });
      } else {
        await base44.entities.TripPreference.create({
          user_email: user?.email,
          user_name: user?.full_name,
          from_city: "",
          to_city: "",
          notify_on_price: false,
          notify_on_date: true,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["preferences", user?.email] });
      toast.success("تم تفعيل إشعارات الرحلات ✓");
    },
  });

  // Persist dismissed favorites so they survive page refresh
  const DISMISSED_KEY = `mishwar-dismissed-favs-${user?.email || "anon"}`;
  const getDismissed = () => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); } catch { return new Set(); }
  };

  const removeFavorite = (id) => {
    // Update local state immediately
    setFavorites(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
    // Persist to localStorage so it survives refresh
    const dismissed = getDismissed();
    dismissed.add(String(id));
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
    toast.success("تم إزالة من المفضلة ✓");
  };

  const handleSidebarAction = (action) => {
    if (action === "prices") {
      enablePriceMutation.mutate();
    } else if (action === "trips") {
      enableTripMutation.mutate();
    } else if (action === "recent") {
      setActiveTab("all");
    }
  };

  return (
    <div>
      {/* Hero Banner */}
      <div className="relative h-40 overflow-hidden">
        <img loading="lazy"
          src="https://images.unsplash.com/photo-1539768942893-daf53e448371?w=1400&h=400&fit=crop"
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-primary/60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
          <div className="flex items-center gap-2 mb-1">
            <Heart className="w-6 h-6 fill-white" />
            <h1 className="text-3xl font-bold">المفضلة</h1>
          </div>
          <p className="text-white/85 text-sm">رحلاتك وحجوزاتك المفضلة في مكان واحد</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border-b border-border sticky top-16 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 py-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Main Content */}
          <div className="lg:col-span-2 space-y-10">

            {/* Favorite Trips */}
            {(activeTab === "all" || activeTab === "trips") && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Car className="w-4 h-4 text-primary" /> رحلات مفضلة
                  </h3>
                  <Link to="/search" className="text-sm text-primary hover:underline flex items-center gap-1">
                    عرض الكل <ChevronLeft className="w-3 h-3" />
                  </Link>
                </div>
                {(() => {
                  const favIds = getFavIds(user?.email);
                  const favTrips = trips.filter(t => favIds.has(t.id));
                  if (favTrips.length === 0) return (
                    <div className="text-center py-10 text-muted-foreground">
                      <Heart className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">لم تضف أي رحلة للمفضلة بعد</p>
                      <Link to="/search" className="text-primary text-sm hover:underline mt-1 block">ابحث عن رحلات</Link>
                    </div>
                  );
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {favTrips.map((trip) => (
                        <div key={trip.id} className="relative">
                          <button
                            onClick={() => {
                              const favs = getFavIds(user?.email);
                              favs.delete(trip.id);
                              localStorage.setItem(`mishwar-favs-${user?.email || "anon"}`, JSON.stringify([...favs]));
                              window.location.reload();
                            }}
                            className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-destructive flex items-center justify-center hover:bg-destructive/90 transition-colors"
                          >
                            <Heart className="w-3.5 h-3.5 text-white fill-white" />
                          </button>
                          <TripCard trip={trip} />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Favorite Drivers */}
            {(activeTab === "all" || activeTab === "drivers") && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" /> سائقون مفضلون
                  </h3>
                  <button className="text-sm text-primary hover:underline flex items-center gap-1">
                    عرض الكل <ChevronLeft className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {sampleDrivers.map((driver) => (
                    <div key={driver.name} className="bg-card rounded-2xl border border-border p-4 text-center hover:shadow-md transition-all relative">
                      <button 
                        onClick={() => removeFavorite(driver.name)}
                        className="absolute top-2 left-2 w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center hover:bg-destructive/20 transition-colors"
                      >
                        <Heart className="w-3 h-3 text-destructive fill-destructive" />
                      </button>
                      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary mx-auto mb-2 overflow-hidden">
                        {driver.name[0]}
                      </div>
                      <h4 className="font-bold text-sm">{driver.name}</h4>
                      <div className="flex items-center justify-center gap-1 mt-1 mb-1">
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        <span className="text-sm font-medium">{driver.rating}</span>
                        <span className="text-xs text-muted-foreground">({driver.trips})</span>
                      </div>
                      <p className="text-xs text-muted-foreground">عضو منذ {driver.since}</p>
                      <span className={`inline-block mt-2 px-2 py-0.5 text-xs rounded-full ${driver.badge === "سائق موثق" ? "bg-accent/10 text-accent" : "bg-primary/10 text-primary"}`}>
                        {driver.badge}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Favorite Routes */}
            {(activeTab === "all" || activeTab === "routes") && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" /> مسارات مفضلة
                  </h3>
                </div>
                <div className="space-y-3">
                  {sampleRoutes.map((route) => (
                    <Link key={route.from + route.to} to={`/search?from=${route.from}&to=${route.to}`}>
                      <div className="bg-card rounded-xl border border-border px-4 py-3 flex items-center justify-between hover:shadow-sm hover:border-primary/20 transition-all">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <MapPin className="w-4 h-4 text-primary" />
                          <span>{route.from}</span>
                          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                          <span>{route.to}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">{route.count} رحلة متاحة</span>
                          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="space-y-4">
            {/* Manage favorites */}
            <div className="bg-card rounded-2xl border border-border p-5">
              <h3 className="font-bold text-foreground mb-4">إدارة المفضلة</h3>
              <p className="text-sm text-muted-foreground mb-3">نظّم مفضلتك بسهولة</p>
              <div className="space-y-3">
                <button 
                  onClick={() => handleSidebarAction("prices")}
                  disabled={enablePriceMutation.isPending}
                  className="w-full flex items-start gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors text-right disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <TrendingDown className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">تحديثات الأسعار</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{userPreferences[0]?.notify_on_price ? "✓ مفعّل" : "تحصل على إشعارات عند انخفاض أسعار الرحلات"}</p>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </button>
                <button 
                  onClick={() => handleSidebarAction("trips")}
                  disabled={enableTripMutation.isPending}
                  className="w-full flex items-start gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors text-right disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bell className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">إشعارات الرحلات</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{userPreferences[0]?.notify_on_date ? "✓ مفعّل" : "تلقّ إشعارات فورية عند إضافة رحلات جديدة"}</p>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </button>
                <button 
                  onClick={() => handleSidebarAction("recent")}
                  className="w-full flex items-start gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors text-right"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Clock className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">المفضلة مؤخراً</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">عرض آخر العناصر التي أضفتها لقائمة المفضلة لديك</p>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </button>
              </div>
            </div>

            {/* CTA Card */}
            <div className="relative rounded-2xl overflow-hidden">
              <img loading="lazy"
                src="https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&h=400&fit=crop"
                alt=""
                className="w-full h-48 object-cover"
              />
              <div className="absolute inset-0 bg-primary/70" />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                <p className="text-white font-bold text-lg leading-tight mb-1">كل رحلة توصلك لأحبائك وتدعم مجتمعك</p>
                <Link to="/search">
                  <Button size="sm" className="mt-3 bg-white text-primary hover:bg-white/90 rounded-xl font-medium">
                    احجز رحلة الآن
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}