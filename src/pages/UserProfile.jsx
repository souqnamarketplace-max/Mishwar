import React, { useState } from "react";
import React, { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Star, Car, MapPin, Calendar, Shield, Award, MessageCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import RatingSummary from "../components/reviews/RatingSummary";
import ReviewsList from "../components/reviews/ReviewsList";

export default function UserProfile() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email");
  const [tab, setTab] = useState("reviews");

  const { data: trips = [] } = useQuery({
    queryKey: ["driver-trips", email],
    queryFn: () =>
      email ? base44.entities.Trip.filter({ created_by: email }, "-created_date", 50) : [],
    enabled: !!email,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ["reviews", email],
    queryFn: () =>
      email ? base44.entities.Review.filter({ driver_email: email, review_type: "passenger_rates_driver" }, "-created_date", 100) : [],
    enabled: !!email,
  });

  const avgRating = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

  const completedTrips = trips.filter((t) => t.status === "completed").length;
  const driverName = trips[0]?.driver_name || email?.split("@")[0] || "سائق";
  const driverAvatar = trips[0]?.driver_avatar;

  if (!email) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">لم يتم تحديد ملف المستخدم</p>
        <Link to="/search"><Button className="mt-4 rounded-xl">العودة للبحث</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Back */}
      <Link to="/search" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </Link>

      {/* Profile Card */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden mb-6">
        <div className="h-24 bg-gradient-to-l from-primary to-accent" />
        <div className="px-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10 mb-4">
            <div className="w-20 h-20 rounded-2xl border-4 border-card bg-primary/10 flex items-center justify-center text-3xl font-bold text-primary overflow-hidden shrink-0">
              {driverAvatar ? (
                <img src={driverAvatar} alt="" className="w-full h-full object-cover" />
              ) : (
                driverName[0]
              )}
            </div>
            <div className="flex-1 pt-2 sm:pt-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-foreground">{driverName}</h1>
                <Badge className="bg-accent/10 text-accent border-accent/20">
                  <Shield className="w-3 h-3 mr-1" />
                  سائق موثق
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <span className="font-bold text-foreground">{avgRating.toFixed(1)}</span>
                  ({reviews.length} تقييم)
                </span>
                <span className="flex items-center gap-1">
                  <Car className="w-4 h-4" />
                  {completedTrips} رحلة مكتملة
                </span>
              </div>
            </div>
            <Link to={`/messages`}>
              <Button variant="outline" className="rounded-xl gap-2 h-9">
                <MessageCircle className="w-4 h-4" />
                تواصل
              </Button>
            </Link>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "التقييم", value: avgRating ? avgRating.toFixed(1) : "—", icon: Star, color: "text-yellow-500" },
              { label: "الرحلات", value: completedTrips, icon: Car, color: "text-primary" },
              { label: "معدل القبول", value: "92%", icon: Award, color: "text-accent" },
            ].map((stat) => (
              <div key={stat.label} className="bg-muted/40 rounded-xl p-3 text-center">
                <stat.icon className={`w-5 h-5 ${stat.color} mx-auto mb-1`} />
                <p className="text-lg font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-xl mb-6">
        {[
          { id: "reviews", label: `التقييمات (${reviews.length})` },
          { id: "trips", label: `الرحلات (${trips.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "reviews" && (
        <div className="space-y-4">
          <RatingSummary driverEmail={email} />
          <ReviewsList driverEmail={email} />
        </div>
      )}

      {tab === "trips" && (
        <div className="space-y-3">
          {trips.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-10 text-center text-muted-foreground">
              <Car className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد رحلات</p>
            </div>
          ) : (
            trips.map((trip) => (
              <Link key={trip.id} to={`/trip/${trip.id}`}>
                <div className="bg-card rounded-2xl border border-border p-4 hover:shadow-md transition-all">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <MapPin className="w-4 h-4 text-primary" />
                      <span>{trip.from_city}</span>
                      <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                      <span>{trip.to_city}</span>
                    </div>
                    <span className="text-lg font-bold text-primary">₪{trip.price}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {trip.date} · {trip.time}
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}