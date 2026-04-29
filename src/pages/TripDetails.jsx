import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
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
import RouteMap from "@/components/shared/RouteMap";

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
  useSEO({ title: "تفاصيل الرحلة", description: "احجز مقعدك في هذه الرحلة" });

  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [booked, setBooked] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [seatsToBook, setSeatsToBook] = useState(1);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;

  const { user } = useAuth();

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => base44.entities.Trip.list("-created_date", 50),
  });

  const bookingMutation = useMutation({
    mutationFn: (tripData) => {
      // Block self-booking — driver cannot book a seat in their own trip
      if (tripData?.driver_email && user?.email && tripData.driver_email === user.email) {
        return Promise.reject(new Error("لا يمكنك حجز مقعد في رحلتك الخاصة"));
      }
      return base44.entities.Booking.create({
        trip_id: tripData.id,
        passenger_name: user?.full_name || user?.email?.split("@")[0] || "راكب",
        passenger_email: user?.email || "",
        seats_booked: seatsToBook,
        total_price: tripData.price * seatsToBook,
        status: "pending",
        payment_method: "نقداً",
      });
    },
    onMutate: () => {
      setBooked(true);
      return null;
    },
    onError: (err) => {
      setBooked(false);
      toast.error(err?.message || "فشل الحجز");
    },
    onSuccess: () => {
      toast.success("تم الحجز بنجاح! 🎉");
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      navigate(`/booking-confirmation?trip=${trip?.id}`);
    },
  });

  const trip = trips.find((t) => t.id === id);
  const tripsLoading = trips.length === 0;
  const isOwnTrip = !!(trip && user && trip.driver_email === user.email);

  // Still loading the list — show spinner
  if (tripsLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  // List loaded but this trip ID doesn't exist
  if (!trip) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">🔍</span>
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">الرحلة غير موجودة</h2>
        <p className="text-sm text-muted-foreground mb-6">قد تكون الرحلة قد ألغيت أو الرابط غير صحيح</p>
        <Link to="/search">
          <Button className="rounded-xl">العودة للبحث</Button>
        </Link>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" dir="rtl">

        {/* ===== LEFT SIDEBAR (Booking) ===== */}
        <div className="space-y-4">
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

              {/* "This is your trip" notice — shown when viewer is the driver */}
              {isOwnTrip && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 my-2 text-center">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 mb-2">
                    <span className="text-xl">🚗</span>
                  </div>
                  <p className="font-bold text-foreground mb-1">هذه رحلتك</p>
                  <p className="text-xs text-muted-foreground mb-3">أنت السائق - لا يمكنك حجز مقعد في رحلتك الخاصة</p>
                  <Link to="/my-trips">
                    <Button variant="outline" className="rounded-xl text-sm">إدارة رحلاتي</Button>
                  </Link>
                </div>
              )}

              {/* Seats selector — hidden when viewing own trip */}
              {!booked && !isOwnTrip && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">عدد المقاعد</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSeatsToBook(s => Math.max(1, s - 1))}
                      className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors"
                    >−</button>
                    <span className="font-bold text-lg w-6 text-center">{seatsToBook}</span>
                    <button
                      onClick={() => setSeatsToBook(s => Math.min(trip?.available_seats || 4, s + 1))}
                      className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors"
                    >+</button>
                  </div>
                </div>
              )}
              {!booked && !isOwnTrip && seatsToBook > 1 && (
                <div className="flex items-center justify-between text-sm text-muted-foreground pb-1">
                  <span>الإجمالي</span>
                  <span className="font-bold text-primary">₪{(trip?.price || 0) * seatsToBook}</span>
                </div>
              )}

              {/* Book button — hidden when viewing your own trip */}
              {!isOwnTrip && (
                <Button
                  className={`w-full h-11 rounded-xl font-bold gap-2 mt-1 ${booked ? "bg-accent hover:bg-accent/90 text-accent-foreground" : "bg-primary hover:bg-primary/90 text-primary-foreground"}`}
                  onClick={() => !booked && bookingMutation.mutate(trip)}
                  disabled={bookingMutation.isPending || booked}
                >
                  {booked ? <><CheckCircle className="w-5 h-5" />تم الحجز</> : bookingMutation.isPending ? "جاري الحجز..." : `احجز ${seatsToBook > 1 ? seatsToBook + " مقاعد" : "الآن"}`}
                </Button>
              )}

              {/* WhatsApp Contact */}
              {trip?.driver_phone && (
                <a
                  href={`https://wa.me/970${trip.driver_phone.replace(/\D/g, '')}?text=${encodeURIComponent("مرحباً، أود الاستفسار عن رحلتك من " + trip.from_city + " إلى " + trip.to_city)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" className="w-full rounded-xl gap-2 border-green-200 text-green-700 hover:bg-green-50">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    تواصل عبر واتساب
                  </Button>
                </a>
              )}

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

            {/* Interactive Route Map */}
            <RouteMap
              fromCity={trip.from_city}
              toCity={trip.to_city}
              height="220px"
              showStats={true}
              className="mt-2"
            />

            {/* Route pickup/dropoff points */}
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border text-sm">
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">نقطة الانطلاق</p>
                  <p className="font-medium">{trip.from_location || trip.from_city}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-destructive mt-1.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">نقطة الوصول</p>
                  <p className="font-medium">{trip.to_location || trip.to_city}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Trip Details */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-4">تفاصيل الرحلة</h3>
            <div className="space-y-3 text-sm">
              {[
                { icon: Calendar, label: `${trip.date} • 08:30 – 09:30 صباحاً` },
                { icon: MapPin, label: `${trip.from_city} – ${trip.from_location || "دوار المنارة"}` },
                { icon: MapPin, label: `${trip.to_city} – ${trip.to_location || "دوار الشهداء"}` },
                { icon: Navigation, label: "فوق نوع الرحلة" },
                { icon: Users, label: `عدد المقاعد المتاحة: ${trip.available_seats || 3}` },
                { icon: Briefcase, label: "أدنية متوسطة واحدة" },
              ].map((item, i) => (
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
                  <img loading="lazy" src={trip.driver_avatar} alt="" className="w-full h-full object-cover" />
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
                <p className="text-xs text-muted-foreground">خبرة في مِشوار</p>
              </div>
            </div>

            {/* Car */}
            <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
              <div className="w-20 h-14 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {trip.car_image ? (
                  <img loading="lazy" src={trip.car_image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <img loading="lazy" src="https://images.unsplash.com/photo-1541443131876-44b03de101c5?w=200&h=120&fit=crop" alt="سيارة" className="w-full h-full object-cover" />
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

            {/* Checkpoint Warning */}
            {trip.has_checkpoint && (
              <div className="mt-3 p-3 bg-orange-500/10 rounded-xl border border-orange-500/20">
                <p className="text-sm font-medium text-orange-800 mb-1">⚠️ تحذير: المسار يمر بحاجز</p>
                <p className="text-xs text-orange-700">{trip.checkpoint_note || "يرجى متابعة أخبار الحواجز قبل الانطلاق"}</p>
              </div>
            )}
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

      {/* ── Mobile Sticky Booking Bar ─────────────────────── */}
      {isMobile && trip && !booked && !isOwnTrip && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/98 backdrop-blur-xl border-t border-border p-4"
          style={{ paddingBottom: "calc(80px + env(safe-area-inset-bottom))" }}>
          <div className="flex items-center gap-3">
            <div>
              <div className="text-2xl font-black text-primary leading-none">₪{trip.price * seatsToBook}</div>
              {seatsToBook > 1 && <div className="text-xs text-muted-foreground">{seatsToBook} مقاعد</div>}
            </div>
            <div className="flex items-center gap-2 mr-1">
              <button onClick={() => setSeatsToBook(s => Math.max(1, s - 1))}
                className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold text-lg active:bg-muted/80">−</button>
              <span className="font-bold w-5 text-center">{seatsToBook}</span>
              <button onClick={() => setSeatsToBook(s => Math.min(trip?.available_seats || 4, s + 1))}
                className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold text-lg active:bg-muted/80">+</button>
            </div>
            <Button
              className="flex-1 h-12 rounded-xl font-bold text-base bg-primary text-primary-foreground active:bg-primary/80"
              onClick={() => bookingMutation.mutate(trip)}
              disabled={bookingMutation.isPending}
            >
              {bookingMutation.isPending ? "..." : "احجز الآن"}
            </Button>
            {trip?.driver_phone && (
              <a href={`https://wa.me/970${trip.driver_phone.replace(/\D/g,'')}?text=${encodeURIComponent("مرحباً، أود الاستفسار عن رحلتك")}`}
                target="_blank" rel="noopener noreferrer"
                className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </a>
            )}
          </div>
        </div>
      )}

      {/* Bottom trust badges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border">
        {[
          { icon: Headphones, title: "دعم على مدار الساعة", desc: "فريق الدعم جاهز لمساعدتك في أي وقت" },
          { icon: Shield, title: "طرق دفع آمنة", desc: "حماية كاملة لبياناتك ومعاملاتك المالية" },
          { icon: X, title: "إلغاء مجاني", desc: "إلغاء مجاني حتى موعد الرحلة بساعتين" },
          { icon: Users, title: "مجتمع موثوق", desc: "آلاف المستخدمين يثقون في مِشوار كل يوم" },
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