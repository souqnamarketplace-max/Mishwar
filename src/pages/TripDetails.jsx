import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, MapPin, Clock, Calendar, Users, Star, Car,
  Shield, Phone, MessageCircle, Heart, Share2, Navigation,
  Snowflake, Music, Cigarette, Briefcase, ChevronLeft, CheckCircle
} from "lucide-react";
import { toast } from "sonner";

const amenityIcons = {
  "تكييف": Snowflake,
  "موسيقى": Music,
  "مسموح بالتدخين": Cigarette,
  "متاح للأمتعة": Briefcase,
  "رحلة مباشرة": Navigation,
};

export default function TripDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [booked, setBooked] = useState(false);
  const [favorited, setFavorited] = useState(false);

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 50),
  });

  const bookingMutation = useMutation({
    mutationFn: (tripData) => base44.entities.Booking.create({
      trip_id: tripData.id,
      seats_booked: 1,
      total_price: tripData.price,
      status: "confirmed",
    }),
    onSuccess: () => {
      setBooked(true);
      toast.success("تم الحجز بنجاح! 🎉");
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });

  const trip = trips.find((t) => t.id === id) || trips[0];

  if (!trip) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Back */}
      <Link to="/search" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ChevronLeft className="w-4 h-4" />
        العودة إلى النتائج
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Route Header */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-2xl font-bold text-foreground">
                <span>{trip.from_city}</span>
                <ArrowRight className="w-6 h-6 text-primary" />
                <span>{trip.to_city}</span>
              </div>
              <Badge className="bg-accent/10 text-accent border-accent/20">مؤكدة</Badge>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>{trip.date}</span>
              <span className="mx-1">•</span>
              <Clock className="w-4 h-4" />
              <span>{trip.time}</span>
            </div>

            {/* Map placeholder */}
            <div className="mt-6 rounded-xl overflow-hidden bg-muted h-64 flex items-center justify-center">
              <div className="text-center">
                <MapPin className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">خريطة المسار</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {trip.from_city} ({trip.from_location || "نقطة الانطلاق"}) → {trip.to_city} ({trip.to_location || "نقطة الوصول"})
                </p>
              </div>
            </div>

            {/* Trip Stats */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 mt-6 pt-4 border-t border-border">
              {[
                { icon: Navigation, label: "المسافة", value: trip.distance || "45 كم" },
                { icon: Clock, label: "المدة", value: trip.duration || "55 دقيقة" },
                { icon: MapPin, label: "نقطة الانطلاق", value: trip.from_location || "دوار المنارة" },
                { icon: MapPin, label: "نقطة الوصول", value: trip.to_location || "دوار الشهداء" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <stat.icon className="w-5 h-5 text-primary mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-sm font-medium">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Amenities */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="font-bold text-foreground mb-4">مميزات الرحلة</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(trip.amenities || ["رحلة مباشرة", "متاح للأمتعة", "تكييف", "موسيقى"]).map((amenity) => {
                const Icon = amenityIcons[amenity] || Shield;
                return (
                  <div key={amenity} className="flex items-center gap-2 p-3 rounded-xl bg-muted/50">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="text-sm">{amenity}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Driver Info */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="font-bold text-foreground mb-4">عن السائق</h3>
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary shrink-0">
                {trip.driver_name?.[0] || "م"}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-bold text-lg">{trip.driver_name || "محمد درويش"}</h4>
                  <Badge className="bg-accent/10 text-accent text-xs">موثق</Badge>
                </div>
                <div className="flex items-center gap-1 mb-3">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <span className="font-medium">{trip.driver_rating || 4.6}</span>
                  <span className="text-muted-foreground text-sm">({trip.driver_reviews_count || 89} تقييم)</span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-2 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold text-primary">92%</p>
                    <p className="text-xs text-muted-foreground">معدل القبول</p>
                  </div>
                  <div className="text-center p-2 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold text-primary">150+</p>
                    <p className="text-xs text-muted-foreground">رحلة مكتملة</p>
                  </div>
                  <div className="text-center p-2 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold text-primary">سنتان</p>
                    <p className="text-xs text-muted-foreground">خبرة في سيرتنا</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Car */}
            <div className="mt-6 pt-4 border-t border-border">
              <h4 className="font-medium text-sm text-muted-foreground mb-3">السيارة</h4>
              <div className="flex items-center gap-4">
                <div className="w-24 h-16 rounded-lg bg-muted flex items-center justify-center">
                  <Car className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="font-bold">{trip.car_model || "كيا سيراتو 2020"}</p>
                  <p className="text-sm text-muted-foreground">لون {trip.car_color || "فضي"} • {trip.car_plate || "6-1234-95"}</p>
                </div>
              </div>
            </div>

            {/* Driver Note */}
            {(trip.driver_note || true) && (
              <div className="mt-4 p-4 bg-primary/5 rounded-xl">
                <p className="text-sm">
                  <span className="font-medium">ملاحظة من السائق: </span>
                  {trip.driver_note || "مرحباً بالجميع 😊 الرحلة مريحة وآمنة إن شاء الله. يرجى التواصل معي لأي استفسار."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Booking */}
        <div className="space-y-4">
          <div className="bg-card rounded-2xl border border-border p-6 sticky top-24">
            <div className="text-center mb-6">
              <p className="text-3xl font-bold text-primary">₪{trip.price}</p>
              <p className="text-sm text-muted-foreground">للمقعد الواحد</p>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  المقاعد المتاحة
                </span>
                <span className="font-medium">{trip.available_seats || 3} من {trip.total_seats || 3}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Briefcase className="w-4 h-4" />
                  حقيبة متوسطة
                </span>
                <span className="font-medium">متاح</span>
              </div>
            </div>

            <Button
              className={`w-full h-12 rounded-xl text-lg font-bold mb-3 gap-2 ${booked ? "bg-accent hover:bg-accent/90 text-accent-foreground" : "bg-primary hover:bg-primary/90 text-primary-foreground"}`}
              onClick={() => !booked && bookingMutation.mutate(trip)}
              disabled={bookingMutation.isPending}
            >
              {booked ? <><CheckCircle className="w-5 h-5" />تم الحجز بنجاح</> : bookingMutation.isPending ? "جاري الحجز..." : "احجز الآن"}
            </Button>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className={`flex-1 rounded-xl gap-2 ${favorited ? "border-destructive text-destructive" : ""}`}
                onClick={() => { setFavorited(!favorited); toast(favorited ? "تمت الإزالة من المفضلة" : "تمت الإضافة للمفضلة ❤️"); }}
              >
                <Heart className={`w-4 h-4 ${favorited ? "fill-destructive text-destructive" : ""}`} />
                {favorited ? "في المفضلة" : "إضافة للمفضلة"}
              </Button>
              <Button variant="outline" className="rounded-xl">
                <Share2 className="w-4 h-4" />
              </Button>
            </div>

            {/* Contact */}
            <div className="mt-6 pt-4 border-t border-border">
              <h4 className="font-medium mb-3">تواصل مع السائق</h4>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="rounded-xl gap-2 text-sm" onClick={() => navigate("/messages")}>
                  <MessageCircle className="w-4 h-4" />
                  محادثة
                </Button>
                <Button variant="outline" className="rounded-xl gap-2 text-sm">
                  <Phone className="w-4 h-4" />
                  اتصال
                </Button>
              </div>
            </div>
          </div>

          {/* Trust badges */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Shield, title: "رحلة آمنة", desc: "جميع السائقين موثقين" },
              { icon: Clock, title: "دعم 24/7", desc: "فريق دعم جاهز لمساعدتك" },
            ].map((badge) => (
              <div key={badge.title} className="bg-card rounded-xl border border-border p-3 text-center">
                <badge.icon className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-xs font-medium">{badge.title}</p>
                <p className="text-[10px] text-muted-foreground">{badge.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}