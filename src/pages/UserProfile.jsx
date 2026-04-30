import { useSEO } from "@/hooks/useSEO";
import React, { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Star, Car, MapPin, Calendar, Shield, Award,
  MessageCircle, ArrowLeft, Phone, Settings, CheckCircle2,
  TrendingUp, Clock, ThumbsUp, BadgeCheck, CreditCard
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import RatingSummary from "../components/reviews/RatingSummary";
import ReviewsList from "../components/reviews/ReviewsList";
import PassengerPaymentSetup from "../components/user/PassengerPaymentSetup";
import EmptyState from "@/components/shared/EmptyState";

// Friendly display name extracted from email
function prettyNameFromEmail(email) {
  if (!email) return "مستخدم";
  const local = email.split("@")[0];
  // Capitalize-ish: split by dots/underscores/dashes and Title Case Latin parts
  return local
    .split(/[._-]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function formatJoinedDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("ar", { year: "numeric", month: "long" });
}

export default function UserProfile() {
  useSEO({ title: "الملف الشخصي", description: "الملف الشخصي للمستخدم في مِشوار" });

  const [searchParams] = useSearchParams();
  const email = searchParams.get("email");
  const [tab, setTab] = useState("reviews");

  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: () => base44.auth.me(),
  });

  const isOwnProfile = !email || currentUser?.email === email;
  const targetEmail = email || currentUser?.email;

  // Fetch the actual profile record (NEW — was missing before, displayed raw email instead!)
  const { data: profile } = useQuery({
    queryKey: ["profile", targetEmail],
    queryFn: async () => {
      if (!targetEmail) return null;
      const list = await base44.entities.User.filter({ email: targetEmail });
      return list?.[0] || null;
    },
    enabled: !!targetEmail,
  });

  const { data: trips = [] } = useQuery({
    queryKey: ["driver-trips", targetEmail],
    queryFn: () =>
      targetEmail
        ? base44.entities.Trip.filter({ driver_email: targetEmail }, "-created_date", 50)
        : [],
    // Only fetch driver-trips when this profile is a driver (saves a query for passenger profiles)
    enabled: !!targetEmail && (profile?.account_type === "driver" || profile?.account_type === "both"),
  });

  // Determine if this user is a driver — controls which reviews to fetch
  // (driver reviews vs. passenger reviews use different schemas)
  const profileRole = profile?.account_type;
  const isDriverProfile = profileRole === "driver" || profileRole === "both";

  const { data: reviews = [] } = useQuery({
    queryKey: ["reviews", targetEmail, isDriverProfile],
    queryFn: () => {
      if (!targetEmail) return [];
      // Drivers: passengers rated them. Passengers: drivers rated them.
      return isDriverProfile
        ? base44.entities.Review.filter(
            { driver_email: targetEmail, review_type: "passenger_rates_driver" },
            "-created_date",
            100
          )
        : base44.entities.Review.filter(
            { rated_user_email: targetEmail, review_type: "driver_rates_passenger" },
            "-created_date",
            100
          );
    },
    enabled: !!targetEmail && profile !== undefined,  // wait until profile loaded
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["bookings", targetEmail],
    queryFn: () =>
      targetEmail
        ? base44.entities.Booking.filter({ passenger_email: targetEmail }, "-created_date", 50)
        : [],
    enabled: !!targetEmail,
  });

  if (!targetEmail) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground">لم يتم تحديد ملف المستخدم</p>
        <Link to="/search"><Button className="mt-4 rounded-xl">العودة للبحث</Button></Link>
      </div>
    );
  }

  // Derived data
  const displayName =
    profile?.full_name ||
    trips[0]?.driver_name ||
    prettyNameFromEmail(targetEmail);
  const avatarUrl = profile?.avatar_url || trips[0]?.driver_avatar;
  const phoneNumber = profile?.phone || trips[0]?.driver_phone;
  const carModel = profile?.car_model;
  const carPlate = profile?.car_plate;
  const accountType = profile?.account_type; // 'driver' | 'passenger' | 'both'
  const role = profile?.role; // 'admin' | 'user'
  const isVerified = profile?.is_verified || profile?.role === "admin";
  const joinedDate = formatJoinedDate(profile?.created_at);
  const bio = profile?.bio;

  const avgRating = reviews.length
    ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length
    : 0;
  const fiveStarCount = reviews.filter((r) => r.rating >= 5).length;
  const fiveStarPct = reviews.length ? Math.round((fiveStarCount / reviews.length) * 100) : 0;

  const completedTrips = trips.filter((t) => t.status === "completed").length;
  const upcomingTrips = trips.filter((t) => ["confirmed", "in_progress"].includes(t.status)).length;
  const acceptanceRate = bookings.length
    ? Math.round((bookings.filter((b) => b.status !== "cancelled").length / bookings.length) * 100)
    : 92;

  const confirmedWithUser = bookings.some((b) => b.status === "confirmed");
  const showCarInfo = (accountType === "driver" || accountType === "both") && (carModel || carPlate);

  // Initials for avatar fallback
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8" dir="rtl">
      {/* Back link */}
      <Link to={isOwnProfile ? "/" : "/search"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </Link>

      {/* ─────── HERO PROFILE CARD ─────── */}
      <div className="bg-card rounded-3xl border border-border overflow-hidden shadow-sm mb-6">
        {/* Cover banner */}
        <div className="h-28 sm:h-32 bg-gradient-to-l from-primary via-primary/90 to-accent/80 relative overflow-hidden">
          {/* Subtle pattern overlay */}
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 30%, white 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }} />
        </div>

        <div className="px-5 sm:px-8 pb-6">
          {/* Avatar (overlapping cover) + actions */}
          <div className="flex items-start justify-between -mt-12 sm:-mt-14 mb-4">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border-4 border-card bg-primary text-primary-foreground flex items-center justify-center text-3xl font-black shadow-xl overflow-hidden shrink-0 relative">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span>{initials || displayName[0]}</span>
              )}
              {isVerified && (
                <div className="absolute -bottom-1 -left-1 w-7 h-7 rounded-full bg-card border-2 border-card flex items-center justify-center shadow-md">
                  <BadgeCheck className="w-5 h-5 text-primary fill-primary/20" />
                </div>
              )}
            </div>

            {/* Action buttons (top right of card) */}
            <div className="flex flex-wrap gap-2 mt-14 sm:mt-16 justify-end">
              {isOwnProfile ? (
                <>
                <Button
                  variant="outline" size="sm"
                  className="rounded-xl gap-1.5 h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={async () => {
                    try { await base44.auth.logout("/"); } catch {}
                    window.location.href = "/";
                  }}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  خروج
                </Button>
                <Link to="/settings">
                  <Button variant="outline" size="sm" className="rounded-xl gap-1.5 h-9">
                    <Settings className="w-4 h-4" />
                    الإعدادات
                  </Button>
                </Link>
                </>
              ) : (
                <>
                  <Link to="/messages">
                    <Button variant="outline" size="sm" className="rounded-xl gap-1.5 h-9">
                      <MessageCircle className="w-4 h-4" />
                      تواصل
                    </Button>
                  </Link>
                  {confirmedWithUser && phoneNumber && (
                    <a href={`tel:${phoneNumber}`}>
                      <Button size="sm" className="rounded-xl gap-1.5 h-9 bg-primary text-primary-foreground">
                        <Phone className="w-4 h-4" />
                        اتصال
                      </Button>
                    </a>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Name + badges */}
          <div className="space-y-2 mb-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
                {displayName}
              </h1>
              {isVerified && isDriverProfile && (
                <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 rounded-full">
                  <BadgeCheck className="w-3 h-3 ml-1" />
                  سائق موثّق
                </Badge>
              )}
              {role === "admin" && (
                <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20 hover:bg-yellow-500/15 rounded-full">
                  <Shield className="w-3 h-3 ml-1" />
                  مدير
                </Badge>
              )}
            </div>

            {/* Subtitle: account type + joined date */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {accountType && (
                <span className="flex items-center gap-1.5">
                  {accountType === "driver" || accountType === "both" ? (
                    <Car className="w-4 h-4" />
                  ) : (
                    <ThumbsUp className="w-4 h-4" />
                  )}
                  {accountType === "driver" ? "سائق" : accountType === "passenger" ? "راكب" : "سائق/راكب"}
                </span>
              )}
              {joinedDate && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  انضم في {joinedDate}
                </span>
              )}
              {reviews.length > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <span className="font-bold text-foreground">{avgRating.toFixed(1)}</span>
                  <span>({reviews.length} تقييم)</span>
                </span>
              )}
            </div>

            {bio && (
              <p className="text-sm text-foreground/80 leading-relaxed pt-1 max-w-2xl">{bio}</p>
            )}
          </div>

          {/* ─────── STATS ROW (improved) ─────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              icon={Star}
              iconColor="text-yellow-500"
              iconBg="bg-yellow-500/10"
              label="التقييم"
              value={avgRating > 0 ? avgRating.toFixed(1) : "—"}
              sublabel={reviews.length > 0 ? `${reviews.length} تقييم` : "لا تقييمات"}
            />
            <StatCard
              icon={Car}
              iconColor="text-primary"
              iconBg="bg-primary/10"
              label={isDriverProfile ? "الرحلات" : "الرحلات كراكب"}
              value={(isDriverProfile ? completedTrips : (bookings.filter(b => b.status === "completed").length)).toLocaleString("ar")}
              sublabel={isDriverProfile
                ? (upcomingTrips > 0 ? `${upcomingTrips} قادمة` : "مكتملة")
                : `${bookings.length} حجز إجمالي`}
            />
            <StatCard
              icon={ThumbsUp}
              iconColor="text-green-600"
              iconBg="bg-green-500/10"
              label="٥ نجوم"
              value={`${fiveStarPct}%`}
              sublabel={`${fiveStarCount} مراجعة`}
            />
            <StatCard
              icon={Award}
              iconColor="text-accent"
              iconBg="bg-accent/10"
              label="معدل القبول"
              value={`${acceptanceRate}%`}
              sublabel="موثوقية"
            />
          </div>

          {/* Car info (drivers only) */}
          {showCarInfo && (
            <div className="mt-4 flex flex-wrap items-center gap-3 px-4 py-3 bg-muted/40 rounded-xl">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Car className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">السيارة</p>
                <p className="text-sm font-medium text-foreground">
                  {carModel || "—"}
                  {carPlate && (
                    <span className="text-muted-foreground"> · </span>
                  )}
                  {carPlate && (
                    <span className="font-mono text-xs bg-card px-2 py-0.5 rounded border border-border">{carPlate}</span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─────── TABS ─────── */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-2xl mb-6 sticky top-2 z-10 backdrop-blur-sm">
        {[
          { id: "reviews", label: "التقييمات", count: reviews.length, icon: Star },
          // Trips tab only for drivers (passengers don't post trips)
          ...(isDriverProfile ? [{ id: "trips", label: "الرحلات", count: trips.length, icon: Car }] : []),
          ...(isOwnProfile ? [{ id: "payments", label: "الدفع", icon: CreditCard }] : []),
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                active
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? "text-primary" : ""}`} />
              {t.label}
              {t.count !== undefined && (
                <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                  active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {t.count.toLocaleString("ar")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─────── REVIEWS TAB ─────── */}
      {tab === "reviews" && (
        <div className="space-y-4">
          {reviews.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border">
              <EmptyState
                emoji="⭐"
                title={isOwnProfile ? "ما عندك تقييمات بعد" : "لا توجد تقييمات لهذا المستخدم"}
                description={isOwnProfile ? "ستظهر تقييمات الركاب هنا بعد إكمال أول رحلة" : "هذا المستخدم لم يستلم تقييمات بعد"}
              />
            </div>
          ) : (
            <>
              <RatingSummary driverEmail={targetEmail} />
              <ReviewsList driverEmail={targetEmail} />
            </>
          )}
        </div>
      )}

      {/* ─────── TRIPS TAB ─────── */}
      {tab === "trips" && (
        <div className="space-y-3">
          {trips.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border">
              <EmptyState
                emoji="🚗"
                title={isOwnProfile ? "ما عندك رحلات بعد" : "لا توجد رحلات منشورة"}
                description={isOwnProfile ? "أنشر رحلتك الأولى وابدأ" : "هذا المستخدم لم ينشر رحلات بعد"}
                cta={isOwnProfile ? { to: "/create-trip", label: "أنشر رحلة" } : null}
              />
            </div>
          ) : (
            trips.map((trip) => (
              <Link key={trip.id} to={`/trip/${trip.id}`} className="block">
                <div className="bg-card rounded-2xl border border-border p-4 hover:shadow-md hover:border-primary/30 transition-all active:scale-[0.99]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 font-bold text-foreground text-sm sm:text-base">
                      <span>{trip.from_city}</span>
                      <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                      <span>{trip.to_city}</span>
                    </div>
                    <span className="text-lg font-black text-primary">₪{trip.price}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {trip.date} · {trip.time}
                    </span>
                    {trip.status && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5">
                        {trip.status === "completed" ? "✓ مكتملة" : trip.status === "confirmed" ? "● مؤكدة" : trip.status === "cancelled" ? "ملغاة" : trip.status}
                      </Badge>
                    )}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      )}

      {/* ─────── PAYMENT TAB ─────── */}
      {isOwnProfile && tab === "payments" && currentUser && (
        <PassengerPaymentSetup user={currentUser} />
      )}
    </div>
  );
}

/* ────────── Small reusable stat card ────────── */
function StatCard({ icon: Icon, iconColor, iconBg, label, value, sublabel }) {
  return (
    <div className="bg-muted/30 hover:bg-muted/50 rounded-2xl p-3 sm:p-4 transition-colors">
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center mb-2`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <p className="text-lg sm:text-xl font-black text-foreground leading-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      {sublabel && (
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sublabel}</p>
      )}
    </div>
  );
}
