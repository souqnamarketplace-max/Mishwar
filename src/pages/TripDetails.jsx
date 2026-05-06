import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import RouteMap from "@/components/shared/RouteMap";
import { isBookingClosed, isLastChance, minutesUntilTrip, isTripExpired } from "@/lib/tripScheduling";
import { useParams, Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/lib/supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, MapPin, Clock, Calendar, Users, Star, Car,
  Shield, Phone, MessageCircle, Heart, Share2, Navigation,
  Snowflake, Music, Cigarette, Briefcase, ChevronLeft, CheckCircle,
  Headphones, X, Check, CreditCard, Wallet, Building2, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import UserActionsMenu from "@/components/shared/UserActionsMenu";
import { useSEO } from "@/hooks/useSEO";
import { friendlyError } from "@/lib/errors";

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

  // ── 1. States (no deps) ──────────────────────────────────────
  const [justBooked, setJustBooked] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState("cash");

  // Scroll to top when trip page opens
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [id]);

  // ── 2. User query (must come before anything that uses user) ──
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  // ── 3. Existing booking check (depends on user) ──────────────
  // Fetch ALL bookings this user has made for this trip — newest first.
  // Filter to active (non-cancelled) on the client so a stale cancelled booking
  // doesn't shadow a fresh re-booking. Limit 5 is plenty.
  const { data: existingBookings = [] } = useQuery({
    queryKey: ["my-booking", id, user?.email],
    queryFn: () => user?.email
      ? base44.entities.Booking.filter({ trip_id: id, passenger_email: user.email }, "-created_date", 5)
      : [],
    enabled: !!user?.email && !!id,
  });
  // Only consider non-cancelled bookings as "already booked"
  const activeBooking = (existingBookings || []).find(b =>
    ["pending", "confirmed"].includes(b?.status)
  );
  const alreadyBooked = !!activeBooking;
  const booked = justBooked || alreadyBooked;

  // Favorites — persisted in localStorage per user (MUST be after user query to avoid TDZ)
  const favKey = `mishwar-favs-${user?.email || "anon"}`;
  const getFavs = () => { try { return new Set(JSON.parse(localStorage.getItem(favKey) || "[]")); } catch { return new Set(); } };
  const [favorited, setFavorited] = useState(() => getFavs().has(id));

  const toggleFavorite = () => {
    const favs = getFavs();
    if (favorited) { favs.delete(id); toast("تمت الإزالة من المفضلة"); }
    else { favs.add(id); toast.success("تمت الإضافة للمفضلة ❤️"); }
    localStorage.setItem(favKey, JSON.stringify([...favs]));
    setFavorited(!favorited);
  };

  // Fetch single trip by ID — smart, no need to load all trips
  const { data: tripData } = useQuery({
    queryKey: ["trip", id],
    queryFn: () => base44.entities.Trip.get(id),
    enabled: !!id,
    staleTime: 30000,
  });

  const { data: driverProfile } = useQuery({
    queryKey: ["driver-profile", tripData?.driver_id],
    queryFn: () => base44.entities.Profile.filter({ created_by: tripData.driver_id }, "-created_at", 1),
    enabled: !!tripData?.driver_id,
    select: (data) => data?.[0] || null,
  });

  const bookingMutation = useMutation({
    mutationFn: async (tripData) => {
      // Atomic seat booking via the `book_seat` RPC (migration 003).
      // SELECT FOR UPDATE → INSERT booking → UPDATE seats, all in one
      // transaction, so two concurrent passengers can't both succeed
      // on the last seat. RPC RAISE EXCEPTION strings are translated
      // to Arabic in src/lib/errors.js → friendlyError().
      const { data, error } = await supabase.rpc("book_seat", {
        p_trip_id:        tripData.id,
        p_seats:          1,
        p_payment_method: selectedPayment,
      });
      if (error) throw error;
      return data;
    },
    onMutate: () => null,
    onSuccess: () => {
      setShowConfirm(false);
      setJustBooked(true);
      toast.success("تم إرسال طلب الحجز! بانتظار موافقة السائق 🎉");
      qc.invalidateQueries({ queryKey: ["my-booking", id, user?.email] });
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["trip", id] });
    },
    onError: (err) => {
      setShowConfirm(false);
      toast.error(friendlyError(err, "فشل الحجز، حاول مجدداً"));
    },
  });

  const trip = tripData || null;
  const carImage = driverProfile?.car_image || tripData?.car_image || null;
  // Detect if current user is the driver of this trip
  const isOwnTrip = !!user?.email && !!trip?.created_by && user.email === trip.created_by;

  // Per-trip SEO. Each trip page becomes an indexable landing page for the
  // route — drives organic traffic for queries like "رام الله إلى نابلس
  // مشاركة سيارة". The OG meta is also set server-side by /api/trip when
  // a bot crawls; this hook covers in-app navigations.
  const seoTitle = trip
    ? `رحلة من ${trip.from_city} إلى ${trip.to_city} — ₪${trip.price}`
    : "تفاصيل الرحلة";
  const seoDescription = trip
    ? `احجز مقعدك في رحلة ${trip.from_city} ← ${trip.to_city} بسعر ${trip.price} شيكل. ${trip.available_seats || 0} مقاعد متاحة. السائق ${trip.driver_name || "موثوق"}.`
    : "تفاصيل الرحلة في مِشوار";
  const seoCanonical = trip ? `https://mishwar-nu.vercel.app/trip/${trip.id}` : undefined;
  useSEO({ title: seoTitle, description: seoDescription, canonical: seoCanonical });

  if (!trip) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">جاري التحميل...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Back — true browser back if there's history, else fall back to /search */}
      <button
        type="button"
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate("/search");
        }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        العودة
      </button>

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
              {isOwnTrip ? (
                <Button
                  className="w-full h-11 rounded-xl font-bold gap-2 mt-2 bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                  onClick={() => navigate(`/driver?tab=passengers&trip=${id}`)}
                >
                  <Users className="w-4 h-4" /> إدارة حجوزات هذه الرحلة
                </Button>
              ) : isBookingClosed(trip) && !booked ? (
                <div className="w-full h-11 rounded-xl bg-muted border border-border flex items-center justify-center gap-2 mt-2 text-sm text-muted-foreground">
                  ⏰ انتهى وقت الحجز
                </div>
              ) : booked ? (
                <div className="space-y-2 mt-2">
                  {activeBooking?.status === "confirmed" ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl h-9">
                      <CheckCircle className="w-4 h-4" /> تم تأكيد الحجز
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl h-9">
                      <span>⏳</span> بانتظار موافقة السائق
                    </div>
                  )}
                  <Button
                    className="w-full h-11 rounded-xl font-bold bg-primary text-primary-foreground"
                    onClick={() => navigate(`/my-trips?trip=${id}`)}
                  >
                    إدارة رحلتي ←
                  </Button>
                </div>
              ) : (
                <>
                  {isLastChance(trip) && (
                    <div className="text-center text-xs text-orange-600 font-bold bg-orange-50 rounded-lg py-1.5 mt-2">
                      ⏰ آخر فرصة — {minutesUntilTrip(trip)} دقيقة للحجز!
                    </div>
                  )}
                  <Button
                    className="w-full h-11 rounded-xl font-bold gap-2 mt-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => setShowConfirm(true)}
                    disabled={bookingMutation.isPending}
                  >
                    احجز الآن
                  </Button>
                </>
              )}

              {/* Favorite — only for passengers, not driver's own trip */}
              {!isOwnTrip && (
                <Button
                  variant="outline"
                  className={`w-full rounded-xl gap-2 ${favorited ? "border-destructive text-destructive" : ""}`}
                  onClick={toggleFavorite}
                >
                  <Heart className={`w-4 h-4 ${favorited ? "fill-destructive text-destructive" : ""}`} />
                  {favorited ? "في المفضلة ❤️" : "إضافة للمفضلة"}
                </Button>
              )}
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
              height="240px"
              showStats={true}
              className="mt-2"
            />

            {/* Stop badges */}
            {Array.isArray(trip.stops) && trip.stops.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs text-muted-foreground font-medium">محطات الطريق ({trip.stops.length})</p>
                {trip.stops.map((stop, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <div className="w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center text-white text-xs font-bold shrink-0">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground">{stop.city}</span>
                      {stop.location && <span className="text-xs text-muted-foreground mr-1">— {stop.location}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {stop.time && <span className="text-xs text-muted-foreground">⏰ {stop.time}</span>}
                      {stop.price_from_origin > 0 && <span className="text-xs font-bold text-primary">₪{stop.price_from_origin}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

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
                  <img loading="lazy" decoding="async" src={trip.driver_avatar} alt="" className="w-full h-full object-cover" />
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
                  <span className="text-sm font-medium">{trip.driver_rating ? trip.driver_rating.toFixed(1) : "جديد"}</span>
                  <span className="text-xs text-muted-foreground">{trip.driver_reviews_count ? `(${trip.driver_reviews_count} تقييم)` : "(لا يوجد تقييم بعد)"}</span>
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
                {carImage ? (
                  <img loading="lazy" decoding="async" src={carImage} alt="سيارة السائق" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">🚗</div>
                )}
              </div>
              <div>
                <p className="font-bold text-sm">{trip.car_model || "كيا سيراتو 2020"}</p>
                <p className="text-xs text-muted-foreground">لون {trip.car_color || "فضي"}</p>
                <p className="text-xs text-muted-foreground">🔢 {trip.car_plate || "6-1234-95"}</p>
              </div>
            </div>

            {/* Driver preferences chips — sibling row below the car so it sits
                on its own line, not as a flex item of the car block.
                CreateTrip denormalises pref_smoking / pref_chattiness /
                pref_pets onto the trip row at publish time, so what we render
                is what the driver wanted FOR THIS TRIP — even if they've
                changed prefs since. Older trips published before that
                denormalization existed still have the legacy "smoking" entry
                in their amenities array; we check that as a fallback so the
                chip surfaces for them too. Hidden entirely when no signal at
                all is available so empty rows don't appear. */}
            {(() => {
              const chips = [];
              const amenities = Array.isArray(trip.amenities) ? trip.amenities : [];
              const smokingInAmenities = amenities.includes("smoking");
              const petsInAmenities = amenities.includes("pets");

              // Smoking — pref column wins, amenities fallback for legacy trips
              if (trip.pref_smoking === "no" || trip.pref_smoking === "not_allowed") {
                chips.push({ icon: "🚭", label: "ممنوع التدخين" });
              } else if (trip.pref_smoking === "yes" || trip.pref_smoking === "allowed" || smokingInAmenities) {
                chips.push({ icon: "🚬", label: "مسموح بالتدخين" });
              }
              // Pets — explicit booleans from the column, plus amenities fallback
              if (trip.pref_pets === true || petsInAmenities) {
                chips.push({ icon: "🐾", label: "الحيوانات الأليفة مرحب بها" });
              } else if (trip.pref_pets === false) {
                chips.push({ icon: "🐾", label: "بدون حيوانات أليفة" });
              }
              // Chattiness — no amenities fallback, only show if explicitly set
              if (trip.pref_chattiness === "quiet") {
                chips.push({ icon: "🤫", label: "رحلة هادئة" });
              } else if (trip.pref_chattiness === "chatty" || trip.pref_chattiness === "very_chatty") {
                chips.push({ icon: "💬", label: "أحب الدردشة" });
              } else if (trip.pref_chattiness === "okay") {
                chips.push({ icon: "🙂", label: "دردشة معتدلة" });
              }
              if (chips.length === 0) return null;
              return (
                <div className="mt-3 flex flex-wrap gap-2">
                  {chips.map((c) => (
                    <span
                      key={c.label}
                      className="inline-flex items-center gap-1.5 bg-muted/40 text-foreground text-xs font-medium px-2.5 py-1 rounded-full border border-border/50"
                    >
                      <span aria-hidden="true">{c.icon}</span>
                      {c.label}
                    </span>
                  ))}
                </div>
              );
            })()}

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
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-foreground">تواصل مع السائق</h3>
              {trip?.driver_email && user?.email !== trip.driver_email && (
                <UserActionsMenu
                  targetEmail={trip.driver_email}
                  targetName={trip.driver_name}
                  contextType="trip"
                  contextId={trip.id}
                />
              )}
            </div>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full rounded-xl gap-2"
                onClick={() => {
                  if (!trip?.driver_email) {
                    toast.error("لا يمكن بدء المحادثة الآن");
                    return;
                  }
                  if (user?.email === trip.driver_email) {
                    toast.info("هذه رحلتك — لا يمكنك مراسلة نفسك");
                    return;
                  }
                  const params = new URLSearchParams({
                    to: trip.driver_email,
                    name: trip.driver_name || trip.driver_email.split("@")[0],
                    trip: trip.id,
                  });
                  navigate(`/messages?${params.toString()}`);
                }}
              >
                <MessageCircle className="w-4 h-4" />
                محادثة
              </Button>
              {/* Phone number intentionally NOT shown to passengers — privacy + App Store policy.
                   All driver communication happens via in-app chat. */}
            </div>
          </div>

          {/* Share */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <p className="text-sm font-medium mb-3">شارك الرحلة مع أصدقائك!</p>
            <div className="flex items-center justify-center gap-3 flex-wrap">


              <button
                className="bg-muted text-foreground px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
                onClick={async () => {
                  // navigator.clipboard.writeText fails silently on http
                  // contexts, in some embedded WebViews, and inside iframes
                  // without explicit clipboard-write permission. Fall back
                  // to the legacy execCommand approach via a temporary
                  // textarea so the share button works everywhere — App
                  // Store WebViews especially.
                  const url = window.location.href;
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(url);
                      toast.success("تم نسخ الرابط! 📋");
                      return;
                    }
                  } catch {}
                  try {
                    const ta = document.createElement("textarea");
                    ta.value = url;
                    ta.style.position = "fixed";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    const ok = document.execCommand("copy");
                    document.body.removeChild(ta);
                    if (ok) toast.success("تم نسخ الرابط! 📋");
                    else toast.error("تعذر نسخ الرابط — انسخه يدوياً من شريط العنوان");
                  } catch {
                    toast.error("تعذر نسخ الرابط — انسخه يدوياً من شريط العنوان");
                  }
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
                    // Same fallback as the dedicated copy-link button
                    // above — see comment there for why this matters in
                    // App Store WebView and non-HTTPS contexts.
                    const url = window.location.href;
                    try {
                      if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(url);
                        toast.success("تم نسخ الرابط! 📋");
                        return;
                      }
                    } catch {}
                    try {
                      const ta = document.createElement("textarea");
                      ta.value = url;
                      ta.style.position = "fixed";
                      ta.style.opacity = "0";
                      document.body.appendChild(ta);
                      ta.focus();
                      ta.select();
                      const ok = document.execCommand("copy");
                      document.body.removeChild(ta);
                      if (ok) toast.success("تم نسخ الرابط! 📋");
                      else toast.error("تعذر النسخ — انسخه يدوياً");
                    } catch {
                      toast.error("تعذر النسخ — انسخه يدوياً");
                    }
                  }
                }}
              >
                مشاركة
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating bottom bar (mobile only) — portal escapes Framer Motion transform ── */}
      {typeof document !== "undefined" && createPortal(
        <div className="lg:hidden" dir="rtl">
          {isOwnTrip ? (
            <div className="fixed bottom-24 left-4 right-4 z-[999]">
              <div className="bg-card border-2 border-primary rounded-2xl shadow-2xl shadow-primary/20 p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">هذه رحلتك</p>
                  <Button className="w-full h-10 rounded-xl font-bold bg-primary text-primary-foreground mt-1"
                    onClick={() => navigate("/driver?tab=passengers")}>
                    إدارة الحجوزات
                  </Button>
                </div>
              </div>
            </div>
          ) : booked ? (
            <div className="fixed bottom-24 left-4 right-4 z-[999]">
              <div className="bg-card rounded-2xl shadow-2xl shadow-black/20 border border-border/50 overflow-hidden">
                {activeBooking?.status === "confirmed" ? (
                  <div className="bg-green-500/10 border-b border-green-200 px-3 py-1.5 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-bold text-green-700">تم تأكيد الحجز</span>
                  </div>
                ) : (
                  <div className="bg-amber-500/10 border-b border-amber-200 px-3 py-1.5 flex items-center gap-2">
                    <span className="text-base">⏳</span>
                    <span className="text-xs font-bold text-amber-700">بانتظار موافقة السائق</span>
                  </div>
                )}
                <div className="p-3">
                  <Button
                    className="w-full h-12 rounded-xl font-black text-base bg-primary text-primary-foreground"
                    onClick={() => navigate(`/my-trips?trip=${id}`)}
                  >
                    إدارة رحلتي ←
                  </Button>
                </div>
              </div>
            </div>
          ) : isBookingClosed(trip) ? (
            <div className="fixed bottom-24 left-4 right-4 z-[999]">
              <div className="bg-muted border border-border rounded-2xl p-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                ⏰ انتهى وقت الحجز — مرت أكثر من ساعة على موعد الرحلة
              </div>
            </div>
          ) : (
            <div className="fixed bottom-24 left-4 right-4 z-[999]">
              <div className="bg-card rounded-2xl shadow-2xl shadow-black/20 border border-border/50 overflow-hidden">
                {isLastChance(trip) && (
                  <div className="bg-orange-500 text-white text-center text-xs font-bold py-1.5 px-3">
                    ⏰ آخر فرصة — {minutesUntilTrip(trip)} دقيقة للحجز!
                  </div>
                )}
                <div className="p-3 flex items-center gap-3">
                  <div className="shrink-0">
                    <p className="text-2xl font-black text-primary leading-none">₪{trip.price}</p>
                    <p className="text-[10px] text-muted-foreground">للمقعد</p>
                  </div>
                  <Button
                    className="flex-1 h-12 rounded-xl font-black text-base bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95 transition-transform"
                    onClick={() => setShowConfirm(true)}
                    disabled={bookingMutation.isPending}
                  >
                    احجز الآن
                  </Button>
                  {trip?.driver_email && user?.email !== trip.driver_email && (
                    <button
                      type="button"
                      aria-label="محادثة السائق"
                      onClick={() => {
                        const params = new URLSearchParams({
                          to: trip.driver_email,
                          name: trip.driver_name || trip.driver_email.split("@")[0],
                          trip: trip.id,
                        });
                        navigate(`/messages?${params.toString()}`);
                      }}
                      className="shrink-0 w-12 h-12 rounded-xl border-2 border-primary/30 bg-primary/5 text-primary flex items-center justify-center active:scale-95 transition-transform hover:bg-primary/10"
                    >
                      <MessageCircle className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      , document.body)}

      {/* ── Booking Confirmation Dialog ── */}
      {showConfirm && trip && !isOwnTrip && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowConfirm(false)} />
          <div className="relative bg-card rounded-2xl w-full max-w-md p-5 shadow-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-lg">تأكيد الحجز</h3>
              <button onClick={() => setShowConfirm(false)} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Trip summary */}
            <div className="bg-muted/50 rounded-xl p-3 mb-4">
              <div className="flex items-center gap-2 font-bold text-sm mb-1">
                <span>{trip.from_city}</span>
                <ArrowRight className="w-4 h-4 text-primary" />
                <span>{trip.to_city}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>📅 {trip.date}</span>
                <span>🕐 {trip.time}</span>
                <span>👤 {trip.driver_name}</span>
              </div>
            </div>

            {/* Payment method */}
            <p className="text-sm font-bold mb-2">طريقة الدفع</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { id: "cash",    label: "نقداً",       icon: "💵" },
                { id: "jawwal",  label: "جوال باي",     icon: "📱" },
                { id: "reflect", label: "ريفلكت",       icon: "💳" },
                { id: "bank",    label: "تحويل بنكي",   icon: "🏦" },
              ].filter(m => !trip.payment_methods?.length || trip.payment_methods.includes(m.id) || m.id === "cash")
               .map(m => (
                <button key={m.id}
                  onClick={() => setSelectedPayment(m.id)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    selectedPayment === m.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground"
                  }`}>
                  <span className="text-lg">{m.icon}</span>
                  {m.label}
                </button>
              ))}
            </div>

            {/* Price summary */}
            <div className="flex items-center justify-between py-3 border-t border-border mb-4">
              <span className="text-sm text-muted-foreground">المبلغ الإجمالي</span>
              <span className="text-2xl font-black text-primary">₪{trip.price}</span>
            </div>

            {/* Confirm button */}
            <Button
              className="w-full h-12 rounded-xl font-black text-base bg-primary text-primary-foreground"
              onClick={() => bookingMutation.mutate(trip)}
              disabled={bookingMutation.isPending || isTripExpired(trip) || isBookingClosed(trip)}
            >
              {bookingMutation.isPending ? "جاري الحجز..." : `تأكيد الحجز — ₪${trip.price}`}
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-2">
              بالضغط على تأكيد الحجز فأنت توافق على شروط الاستخدام
            </p>
          </div>
        </div>
      , document.body)}

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