import { useSEO } from "@/hooks/useSEO";
import React, { useState, useEffect } from "react";
import { useSearchParams, useParams, useNavigate, Link } from "react-router-dom";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import {
  Star, Car, MapPin, Calendar, Shield, Award,
  MessageCircle, ArrowLeft, Settings, CheckCircle2,
  TrendingUp, Clock, ThumbsUp, BadgeCheck, CreditCard
, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import RatingSummary from "../components/reviews/RatingSummary";
import ReviewsList from "../components/reviews/ReviewsList";
import PassengerPaymentSetup from "../components/user/PassengerPaymentSetup";
import EmptyState from "@/components/shared/EmptyState";
import UserActionsMenu from "@/components/shared/UserActionsMenu";

function formatJoinedDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long" });
}

export default function UserProfile() {
  useSEO({ title: "الملف الشخصي", description: "الملف الشخصي للمستخدم في مشوارو" });

  // ─── URL params ──────────────────────────────────────────────
  // Canonical form is /profile/:userId where userId is the UUID from
  // profiles.id. Email-keyed form (?email=...) is supported only for
  // back-compat with deep links sitting in old chat messages or
  // bookmarks — when we detect one, we look up the profile, then
  // navigate(..., { replace: true }) to the canonical UUID URL so the
  // email doesn't sit in browser history, referrer headers, or
  // analytics logs.
  //
  // Email is PII and never belonged in a URL. Migrating away because:
  //   - Browser history can be screenshot-shared
  //   - Referer headers leak it to any image CDN / analytics
  //   - Vercel + Sentry access logs persist URLs
  //   - App Store / Play Store reviewers flag PII in URLs
  // UUIDs aren't PII — they don't identify a real-world person by
  // themselves, only when joined against profiles.
  const { userId: paramUserId } = useParams();         // canonical
  const [searchParams] = useSearchParams();
  const legacyEmail = searchParams.get("email");       // back-compat only
  const navigate = useNavigate();

  const [tab, setTab] = useState("reviews");

  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.auth.me(),
  });

  // ─── Profile fetch ──────────────────────────────────────────
  // Three resolution modes, in order of preference:
  //   1. /profile/:userId  → fetch by id (canonical)
  //   2. /profile?email=X  → fetch by email (legacy, will redirect)
  //   3. /profile          → fetch the current signed-in user
  //
  // Note we always use supabase directly (not api.entities.User) so
  // that the id-keyed path can use eq.id. The base44 entity client
  // wraps queries with a created_by filter in some modes — for the
  // single-row profile lookup we just want the raw row.
  const { data: profile } = useQuery({
    queryKey: ["profile", paramUserId || legacyEmail || currentUser?.email || null],
    queryFn: async () => {
      if (paramUserId) {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", paramUserId)
          .maybeSingle();
        if (error) { console.warn("profile by id error:", error); return null; }
        return data || null;
      }
      if (legacyEmail) {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("email", legacyEmail)
          .maybeSingle();
        if (error) { console.warn("profile by email error:", error); return null; }
        return data || null;
      }
      if (currentUser?.email) {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("email", currentUser.email)
          .maybeSingle();
        if (error) { console.warn("profile self error:", error); return null; }
        return data || null;
      }
      return null;
    },
    enabled: !!paramUserId || !!legacyEmail || !!currentUser?.email,
  });

  // Resolved identifiers — these are what every downstream query keys off.
  // The profile row is the source of truth, NOT the URL. After a legacy
  // email lookup resolves, all subsequent queries use the email from the
  // profile row (same value, but conceptually unified). When the redirect
  // below fires, the URL changes to /profile/:id but our state continues
  // operating on the same email until the page re-renders with the new
  // route — react-query keeps both keys cached so no flicker.
  const targetEmail = profile?.email || currentUser?.email || null;
  const targetId = profile?.id || null;

  const isOwnProfile = !!currentUser && (
    (!paramUserId && !legacyEmail) ||
    currentUser.id === targetId ||
    currentUser.email === targetEmail
  );

  // ─── Legacy ?email= → canonical /profile/:id redirect ─────
  // Fires once profile is fetched. Uses { replace: true } so the
  // back button doesn't bounce between the email URL and the id URL.
  useEffect(() => {
    if (!legacyEmail) return;
    if (!profile?.id) return;
    navigate(`/profile/${profile.id}`, { replace: true });
  }, [legacyEmail, profile?.id, navigate]);

  const { data: trips = [] } = useQuery({
    queryKey: ["driver-trips", targetEmail],
    queryFn: () =>
      targetEmail
        ? api.entities.Trip.filter({ driver_email: targetEmail }, "-created_date", 50)
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
        ? api.entities.Review.filter(
            { driver_email: targetEmail, review_type: "passenger_rates_driver" },
            "-created_date",
            100
          )
        : api.entities.Review.filter(
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
        ? api.entities.Booking.filter({ passenger_email: targetEmail }, "-created_date", 50)
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
  // Note: when the profile has no full_name we fall back to a generic
  // label, NOT prettyNameFromEmail. Deriving a display name from the
  // email's local part (e.g. "engallam27@gmail.com" → "Engallam27") was
  // still an email leak in disguise — anyone visiting the profile page
  // could read it off. Profiles missing full_name are exceedingly rare
  // post-migration 034 (onboarding-gate-for-writes), but defensive
  // fallback matters for legacy rows and admin-soft-deleted users.
  const displayName =
    profile?.full_name ||
    trips[0]?.driver_name ||
    "مستخدم";
  const avatarUrl = profile?.avatar_url || trips[0]?.driver_avatar;
  // Phone number is intentionally NOT pulled from the profile row anywhere
  // on this page. Contact happens through in-app messaging only. Drivers
  // and passengers who need to call each other about a confirmed trip
  // see the phone in /trip/:id (post-booking) and /my-trips, where the
  // context makes the disclosure necessary. Surfacing a call button on
  // a public profile is too broad — any subscribed driver could harvest
  // passenger numbers by walking the request list.
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
  // Reliability rate — role-aware. The previous single 'acceptanceRate'
  // was misleading: it was always computed from `bookings` (where this
  // profile is the passenger), but displayed on a driver profile as
  // 'معدل القبول' implying driver-side acceptance behaviour. A driver
  // who never rode as a passenger got `null`; a passenger who booked
  // twice got a number. Inverted from what viewers expect.
  //
  // Now:
  //   - Driver profile: completion rate of their own trips.
  //     Numerator   = trips marked completed.
  //     Denominator = completed + cancelled (driver removed the trip).
  //     Honest measure of "do their published trips actually run?"
  //   - Passenger profile: completion rate of their own bookings.
  //     Numerator   = non-cancelled bookings.
  //     Denominator = total bookings.
  //     Honest measure of "do they show up to trips they book?"
  //
  // Both gates require >=5 data points so a sample of 1 doesn't show
  // a misleading 100%. Below the threshold, the card is hidden.
  // The previous default of 92% for brand-new profiles with zero
  // history was a fabricated marketing number — App Store / privacy
  // review flags these — and hiding the card is honest.
  const RELIABILITY_MIN_SAMPLE = 5;

  const reliability = (() => {
    if (isDriverProfile) {
      // For drivers: use the trips array (driver_email-filtered).
      // 'cancelled' on a trip row means the DRIVER removed it.
      // Both 'cancelled' and 'completed' are settled states; together
      // they form the denominator. Pending / confirmed / in_progress
      // trips are still ongoing and not yet "judged".
      const settled = trips.filter((t) =>
        t.status === "completed" || t.status === "cancelled"
      );
      const completed = trips.filter((t) => t.status === "completed").length;
      if (settled.length < RELIABILITY_MIN_SAMPLE) return null;
      return {
        pct: Math.round((completed / settled.length) * 100),
        label: "إتمام الرحلات",
        sublabel: `${settled.length} رحلة`,
      };
    }
    // For passengers: use the bookings array (passenger_email-filtered).
    const settled = bookings.filter((b) =>
      b.status === "completed" || b.status === "cancelled"
    );
    const completed = bookings.filter((b) => b.status === "completed").length;
    if (settled.length < RELIABILITY_MIN_SAMPLE) return null;
    return {
      pct: Math.round((completed / settled.length) * 100),
      label: "إتمام الحجوزات",
      sublabel: `${settled.length} حجز`,
    };
  })();

  // Note: previously this section computed `confirmedWithUser` (a flag
  // checking whether the viewing user and the profile owner have a
  // confirmed booking together) and used it to gate a profile-page call
  // button. That button is gone (see the phoneNumber comment above) and
  // the flag along with it. The bookings array is still fetched because
  // its length feeds the "Rides as passenger" stat card + reliability%.
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
                <img loading="lazy" decoding="async" src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
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
                    try { await api.auth.logout("/"); } catch {}
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
                  {/* "تواصل" — opens (or starts) a message thread with this
                      user. Was just <Link to="/messages"> with no params,
                      which dropped the viewer on the bare messages page
                      and offered no obvious next step to actually start
                      chatting with this profile owner. Same ?to/name
                      pattern used in MyTrips:341 and PassengerRequests's
                      card click. */}
                  <Link to={`/messages?to=${encodeURIComponent(targetEmail)}&name=${encodeURIComponent(displayName)}`}>
                    <Button variant="outline" size="sm" className="rounded-xl gap-1.5 h-9">
                      <MessageCircle className="w-4 h-4" />
                      تواصل
                    </Button>
                  </Link>
                  {/* Call button intentionally removed. Phone numbers belong
                      in /trip/:id (post-booking) and /my-trips — surfaces
                      where the disclosure is justified by the relationship.
                      A profile-page call button let any subscribed driver
                      harvest passenger numbers by walking the request list. */}
                  {/* Block / Report menu — same component used on TripDetails.
                      Without this, mobile users had no way to report or
                      block someone they reached via a profile link (no 3-dot
                      menu existed on the profile screen at all). The menu
                      hides itself when targetEmail equals current user, so
                      no extra guard needed. */}
                  <UserActionsMenu
                    targetEmail={targetEmail}
                    targetName={profile?.full_name || displayName}
                    contextType="profile"
                    contextId={targetEmail}
                  />
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
              {isVerified && (
                <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 rounded-full">
                  <BadgeCheck className="w-3 h-3 ml-1" />
                  {isDriverProfile ? "سائق موثّق" : "راكب موثّق"}
                </Badge>
              )}
              {!isVerified && profile && role !== "admin" && (
                <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 rounded-full text-xs">
                  غير موثّق
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
            {/* Reliability card — role-aware. Shows completion rate of
                trips (drivers) or bookings (passengers). Hidden when the
                sample is below RELIABILITY_MIN_SAMPLE so a 100% on a
                sample of 1 doesn't mislead. The previous version called
                this 'معدل القبول' (acceptance rate) but computed it from
                the wrong array — see lines 138-148 for context. */}
            {reliability && (
              <StatCard
                icon={Award}
                iconColor="text-accent"
                iconBg="bg-accent/10"
                label={reliability.label}
                value={`${reliability.pct}%`}
                sublabel={reliability.sublabel}
              />
            )}
          </div>

          {/* Car info (drivers only) — now shows the vehicle photo
              (profile.car_image) above the model + plate when available.
              Falls back to the icon-only layout when the driver hasn't
              uploaded a photo yet. */}
          {showCarInfo && (
            <div className="mt-4 bg-muted/40 rounded-xl overflow-hidden">
              {profile?.car_image && (
                <div className="aspect-[3/1] bg-muted overflow-hidden border-b border-border/40">
                  <img
                    loading="lazy"
                    decoding="async"
                    src={profile.car_image}
                    alt={`سيارة ${displayName}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
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
