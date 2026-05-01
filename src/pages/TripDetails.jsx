import React, { useState, useEffect } from "react";
import RouteMap from "@/components/shared/RouteMap";
import { useParams, Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, MapPin, Clock, Calendar, Users, Star, Car,
  Shield, Phone, MessageCircle, Heart, Share2, Navigation,
  Snowflake, Music, Cigarette, Briefcase, ChevronLeft, CheckCircle,
  Headphones, X, Check
} from "lucide-react";
import { toast } from "sonner";

const amenityIcons = {
  "تكييف": Snowflake,
  "موسيقى": Music,
  "مسموح بالتدخين": Cigarette,
  "متاح للأمتعة": Briefcase,
  "رحلة مباشرة": Navigation,
  "wifi": Shield,
};

const whyChoose = [
  "سائق موثوق ومشهور عالٍ",
  "أقل سعر متوفر في هذا الوقت",
  "رحلة مباشرة بدون توقف",
  "تقييمات ممتازة من الركاب",
];

export default function TripDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [booked, setBooked] = useState(false);
  const [favorited, setFavorited] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 50),
  });

  const bookingMutation = useMutation({
    mutationFn: (tripData) => base44.entities.Booking.create({
      trip_id: tripData.id,
      passenger_name: user?.full_name || user?.email?.split("@")[0] || "راكب",
      passenger_email: user?.email || "",
      seats_booked: 1,
      total_price: tripData.price,
      status: "pending",
      payment_method: "نقداً",
    }),
    onMutate: () => {
      setBooked(true);
      return null;
    },
    onError: () => {
      setBooked(false);
      toast.error("فشل الحجز");
    },
    onSuccess: () => {
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

        {/* ===== LEFT SIDEBAR (Booking) ===== */}
        <div className="lg:order-first order-last space-y-4">
          <div className="bg-card rounded-2xl border border-border overflow-hidden sticky top-24">
            {/* Price header */}
            <div className="bg-primary p-4 text-primary-foreground">
              <p className="text-3xl font-bold">₪{trip.price}</p>
              <p className="text-sm text-primary-foreground/80">للمقعد الواحد</p>
            </div>

            <div className="p-4 space-y-3">
              {/* Seat & amenity highlights */}
              <div className="space-y-2 text-sm">
                {[
                  { icon: Users, text: `${trip.available_seats || 3} مقاعد متاحة` },
                  { icon: Briefcase, text: "متاح حقيبة متوسطة" },
                  { icon: Snowflake, text: "تكييف" },
                  { icon: Music, text: "موسيقى" },
                  { icon: Cigarette, text: "مسموح بالتدخين" },
                ].map((item) => (
                  <div key={item.text} className="flex items-center gap-2 text-foreground">
                    <item.icon className="w-4 h-4 text-primary shrink-0" />
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>

              {/* Book button */}
              <Button
                className={`w-full h-11 rounded-xl font-bold gap-2 mt-2 ${booked ? "bg-accent hover:bg-accent/90 text-accent-foreground" : "bg-primary hover:bg-primary/90 text-primary-foreground"}`}
                onClick={() => !booked && bookingMutation.mutate(trip)}
                disabled={bookingMutation.isPending}
              >
                {booked ? <><CheckCircle className="w-5 h-5" />تم الحجز بنجاح</> : bookingMutation.isPending ? "جاري الحجز..." : "احجز الآن"}
              </Button>

              {/* Favorite */}
              <Button
                variant="outline"
                className={`w-full rounded-xl gap-2 ${favorited ? "border-destructive text-destructive" : ""}`}
                onClick={() => { setFavorited(!favorited); toast(favorited ? "تمت الإزالة من المفضلة" : "تمت الإضافة للمفضلة ❤️"); }}
              >
                <Heart className={`w-4 h-4 ${favorited ? "fill-destructive text-destructive" : ""}`} />
                {favorited ? "في المفضلة" : "إضافة للمفضلة"}
              </Button>
            </div>

            {/* Trust info */}
            <div className="border-t border-border divide-y divide-border">
              <div className="flex items-start gap-3 p-4">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">رحلة آمنة</p>
                  <p className="text-xs text-muted-foreground">جميع السائقين موثقين وندعم مدار الساعة</p>
                  <button className="text-xs text-primary mt-1 hover:underline">تعرف على المزيد</button>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4">
                <X className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">سياسة الإلغاء</p>
                  <p className="text-xs text-muted-foreground">إلغاء مجاني حتى موعد الرحلة بساعتين</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== MAIN CONTENT (Middle) ===== */}
        <div className="lg:col-span-1 space-y-6">
          {/* Route Header */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
                <span>{trip.from_city}</span>
                <ArrowRight className="w-5 h-5 text-primary" />
                <span>{trip.to_city}</span>
              </div>
              <Badge className="bg-accent/10 text-accent border-accent/20">مؤكدة</Badge>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
              <Calendar className="w-4 h-4" />
              <span>{trip.date}</span>
              <span>•</span>
              <Clock className="w-4 h-4" />
              <span>{trip.time} صباحاً</span>
            </div>

            {/* Map */}
            <RouteMap
              fromCity={trip.from_city}
              toCity={trip.to_city}
              stops={trip.stops || []}
              height="220px"
              showStats={false}
              className="mt-2"
            />

            {/* Route stats */}
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border text-center">
              <div>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mb-1">
                  <MapPin className="w-3 h-3" /> {trip.to_city}
                </p>
                {trip.to_location && <p className="text-xs font-medium">{trip.to_location}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">المسافة</p>
                <p className="text-xs font-medium">{trip.distance || "45 كم"}</p>
                <p className="text-xs text-muted-foreground">المدة</p>
                <p className="text-xs font-medium">{trip.duration || "55 د"} تقريباً</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mb-1">
                  <MapPin className="w-3 h-3" /> {trip.from_city}
                </p>
                {trip.from_location && <p className="text-xs font-medium">{trip.from_location}</p>}
              </div>
            </div>
          </div>

          {/* Trip Details */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-4">تفاصيل الرحلة</h3>
            <div className="space-y-3 text-sm">
              {[
                { icon: Calendar, label: `${trip.date} • ${trip.time} صباحاً` },
                trip.from_location && { icon: MapPin, label: `${trip.from_city} – ${trip.from_location}` },
                trip.to_location && { icon: MapPin, label: `${trip.to_city} – ${trip.to_location}` },
                { icon: Users, label: `عدد المقاعد المتاحة: ${trip.available_seats || 3}` },
              ].filter(Boolean).map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-foreground">
                  <item.icon className="w-4 h-4 text-primary shrink-0" />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Driver */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-4">عن السائق</h3>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary shrink-0 overflow-hidden">
                {trip.driver_avatar ? (
                  <img src={trip.driver_avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  trip.driver_name?.[0] || "م"
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold">{trip.driver_name || "محمد درويش"}</h4>
                  <Badge className="bg-accent/10 text-accent text-xs">موثق</Badge>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-medium">{trip.driver_rating || 4.6}</span>
                  <span className="text-xs text-muted-foreground">({trip.driver_reviews_count || 89} تقييم)</span>
                </div>
              </div>
              <Link to={`/profile?email=${trip.created_by || ""}`} className="text-xs text-primary hover:underline">
                عرض الملف ←
              </Link>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center p-2 bg-muted/50 rounded-lg">
                <p className="text-base font-bold text-primary">92%</p>
                <p className="text-xs text-muted-foreground">معدل القبول</p>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded-lg">
                <p className="text-base font-bold text-primary">150+</p>
                <p className="text-xs text-muted-foreground">رحلة مكتملة</p>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded-lg">
                <p className="text-base font-bold text-primary">سنتان</p>
                <p className="text-xs text-muted-foreground">خبرة في سيرتنا</p>
              </div>
            </div>

            {/* Car */}
            <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
              <div className="w-20 h-14 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {trip.car_image ? (
                  <img src={trip.car_image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <img src="https://images.unsplash.com/photo-1541443131876-44b03de101c5?w=200&h=120&fit=crop" alt="سيارة" className="w-full h-full object-cover" />
                )}
              </div>
              <div>
                <p className="font-bold text-sm">{trip.car_model || "كيا سيراتو 2020"}</p>
                <p className="text-xs text-muted-foreground">لون {trip.car_color || "فضي"}</p>
                <p className="text-xs text-muted-foreground">🔢 {trip.car_plate || "6-1234-95"}</p>
              </div>
            </div>

            {/* Payment Methods */}
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">طرق الدفع المقبولة</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "cash", label: "نقداً", icon: "💵" },
                  { id: "bank_transfer", label: "تحويل بنكي", icon: "🏦" },
                  { id: "card", label: "بطاقة ائتمان", icon: "💳" },
                ].map((m) => (
                  (trip.payment_methods?.includes(m.id) || (trip.payment_methods?.length === 0 && m.id === "cash")) && (
                    <span key={m.id} className="flex items-center gap-1 text-xs bg-accent/10 text-accent px-2 py-1 rounded-lg">
                      <span>{m.icon}</span>
                      {m.label}
                    </span>
                  )
                ))}
              </div>
            </div>

            {/* Driver note */}
            <div className="mt-3 p-3 bg-primary/5 rounded-xl">
              <p className="text-sm">
                😊 {trip.driver_note || "مرحباً بالجميع الرحلة مريحة وآمنة إن شاء الله، يرجى التواصل معي في أي استفسار."}
              </p>
            </div>
          </div>
        </div>

        {/* ===== RIGHT SIDEBAR ===== */}
        <div className="space-y-4">
          {/* Why choose */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-3">لماذا تختار هذه الرحلة؟</h3>
            <div className="space-y-2">
              {whyChoose.map((reason) => (
                <div key={reason} className="flex items-center gap-2 text-sm">
                  <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-accent" />
                  </div>
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Driver note (right column) */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-3">ملاحظة من السائق</h3>
            <p className="text-sm text-muted-foreground">
              😊 {trip.driver_note || "مرحباً بالجميع الرحلة مريحة وآمنة إن شاء الله. يرجى التواصل معي في أي استفسار."}
            </p>
          </div>

          {/* Contact */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-3">تواصل مع السائق</h3>
            <div className="space-y-2">
              <Button variant="outline" className="w-full rounded-xl gap-2" onClick={() => navigate("/messages")}>
                <MessageCircle className="w-4 h-4" />
                محادثة
              </Button>
              {trip.status === "confirmed" && trip.driver_phone && (
                <Button variant="outline" className="w-full rounded-xl gap-2">
                  <Phone className="w-4 h-4" />
                  {trip.driver_phone}
                </Button>
              )}
              {trip.status !== "confirmed" && (
                <p className="text-xs text-muted-foreground text-center py-2">رقم الهاتف متاح بعد تأكيد الحجز</p>
              )}
            </div>
          </div>

          {/* Share */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <p className="text-sm font-medium mb-3">شارك الرحلة مع أصدقائك!</p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
                onClick={() => {
                  const url = `https://wa.me/?text=انضم معي في رحلة من ${trip.from_city} إلى ${trip.to_city} بسعر ₪${trip.price}`;
                  window.open(url, "_blank");
                }}
              >
                واتساب
              </button>
              <button
                className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
                onClick={() => {
                  const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`;
                  window.open(url, "_blank");
                }}
              >
                فيسبوك
              </button>
              <button
                className="bg-muted text-foreground px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  toast.success("تم نسخ الرابط! 📋");
                }}
              >
                نسخ الرابط
              </button>
              <button
                className="bg-muted text-foreground px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
                onClick={async () => {
                  if (navigator.share) {
                    try {
                      await navigator.share({
                        title: `رحلة من ${trip.from_city} إلى ${trip.to_city}`,
                        text: `انضم معي في رحلة بسعر ₪${trip.price}`,
                        url: window.location.href,
                      });
                    } catch (err) {
                      if (err.name !== "AbortError") toast.error("فشلت المشاركة");
                    }
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                    toast.success("تم نسخ الرابط! 📋");
                  }
                }}
              >
                مشاركة
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom trust badges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border">
        {[
          { icon: Headphones, title: "دعم على مدار الساعة", desc: "فريق الدعم جاهز لمساعدتك في أي وقت" },
          { icon: Shield, title: "طرق دفع آمنة", desc: "حماية كاملة لبياناتك ومعاملاتك المالية" },
          { icon: X, title: "إلغاء مجاني", desc: "إلغاء مجاني حتى موعد الرحلة بساعتين" },
          { icon: Users, title: "مجتمع موثوق", desc: "آلاف المستخدمين يثقون في سيرتنا كل يوم" },
        ].map((b) => (
          <div key={b.title} className="flex items-start gap-3 p-4 bg-card rounded-xl border border-border">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <b.icon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">{b.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{b.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}