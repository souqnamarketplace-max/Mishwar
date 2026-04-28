import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Car, Users, MapPin, Star, ArrowLeft, Bell, TrendingDown, Clock, ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import TripCard from "../components/shared/TripCard";

const tabs = [
  { id: "all", label: "جميع المفضلة", icon: Heart },
  { id: "trips", label: "الرحلات", icon: Car },
  { id: "drivers", label: "السائقون", icon: Users },
  { id: "routes", label: "المسارات", icon: MapPin },
];

const sampleDrivers = [
  { name: "أحمد أبو الخير", rating: 4.8, trips: 128, since: "يناير 2025", badge: "سائق موثق" },
  { name: "محمد درويش", rating: 4.6, trips: 89, since: "مارس 2022", badge: "سائق نشط" },
  { name: "سامي أبو أحمد", rating: 4.7, trips: 79, since: "أكتوبر 2022", badge: "سائق نشط" },
  { name: "يوسف حمدان", rating: 4.5, trips: 60, since: "ديسمبر 2022", badge: "سائق موثق" },
];

const sampleRoutes = [
  { from: "رام الله", to: "غزة", count: 18 },
  { from: "نابلس", to: "رام الله", count: 12 },
  { from: "الخليل", to: "بيت لحم", count: 8 },
  { from: "جنين", to: "نابلس", count: 7 },
];

const sidebarItems = [
  { icon: TrendingDown, title: "تحديثات الأسعار", desc: "تحصل على إشعارات عند انخفاض أسعار الرحلات في مساراتك المفضلة" },
  { icon: Bell, title: "إشعارات الرحلات", desc: "تلقّ إشعارات فورية عند إضافة رحلات جديدة لمساراتك المفضلة" },
  { icon: Clock, title: "المفضلة مؤخراً", desc: "عرض آخر العناصر التي أضفتها لقائمة المفضلة لديك" },
];

export default function Favorites() {
  const [activeTab, setActiveTab] = useState("all");
  const [favorites, setFavorites] = useState(new Set());
  const qc = useQueryClient();

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 20),
  });

  const removeFavorite = (id) => {
    setFavorites(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
    toast.success("تم إزالة من المفضلة");
  };

  return (
    <div>
      {/* Hero Banner */}
      <div className="relative h-40 overflow-hidden">
        <img
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(trips.length > 0 ? trips : [
                    { id: "1", from_city: "رام الله", to_city: "غزة", date: "السبت 25 مايو 2024", time: "08:30 صباحاً", price: 50, driver_name: "أحمد أبو الخير", driver_rating: 4.8, available_seats: 3, car_model: "كيا سبورتاج 2020", status: "confirmed" },
                    { id: "2", from_city: "نابلس", to_city: "رام الله", date: "الثلاثاء 28 مايو 2024", time: "10:00 صباحاً", price: 40, driver_name: "محمد درويش", driver_rating: 4.6, available_seats: 2, car_model: "هيونداي توسان 2018", status: "confirmed" },
                    { id: "3", from_city: "الخليل", to_city: "بيت لحم", date: "الأحد 30 يونيو 2024", time: "12:00 صباحاً", price: 35, driver_name: "سامي أبو أحمد", driver_rating: 4.7, available_seats: 4, car_model: "فولكس واغن بولو 2019", status: "confirmed" },
                  ]).slice(0, 3).map((trip) => (
                    <div key={trip.id} className="relative">
                      <button 
                        onClick={() => removeFavorite(trip.id)}
                        className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-destructive flex items-center justify-center hover:bg-destructive/90 transition-colors"
                      >
                        <Heart className="w-3.5 h-3.5 text-white fill-white" />
                      </button>
                      <TripCard trip={trip} />
                    </div>
                  ))}
                </div>
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
                {sidebarItems.map((item) => (
                  <button key={item.title} className="w-full flex items-start gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors text-right">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <item.icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            </div>

            {/* CTA Card */}
            <div className="relative rounded-2xl overflow-hidden">
              <img
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