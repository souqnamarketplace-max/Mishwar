import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import RouteMap from "@/components/shared/RouteMap";
import { isBookingClosed, isLastChance, minutesUntilTrip, isTripExpired } from "@/lib/tripScheduling";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "@/api/apiClient";
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
import { absoluteUrl, SITE_URL } from "@/lib/seo/config";
import { buildTripSlug, parseTripIdFromSlug } from "@/lib/slug";
import { friendlyError } from "@/lib/errors";
import { useBlockedEmails } from "@/lib/blockUtils";
import { useOnboardingGate } from "@/hooks/useOnboardingGate";
import { logAudit } from "@/lib/adminAudit";

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
  // The :id param can be either:
  //   1. A canonical UUID  /trip/e30e8388-4207-...
  //   2. A slug ending in 6-char short_code  /trip/qasra-kafr-al-laymun-may13-aB3xK9
  //   3. A garbled paste — share platforms sometimes concatenate share
  //      text into the URL: /trip/<uuid>%20<arabic-text>. parseTripIdFromSlug
  //      handles the clean cases; for garbled pastes we fall back to the
  //      "extract first UUID-shaped substring" rescue further down.
  const { id: rawId } = useParams();
  const parsed = parseTripIdFromSlug(rawId);
  // Rescue: if parseTripIdFromSlug couldn't decide, look for a
  // UUID-shaped substring anywhere in rawId (handles share-text
  // concat pollution).
  const uuidRescue = parsed.kind === "invalid"
    ? rawId?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
    : null;
  const lookupKind = parsed.kind === "uuid" ? "uuid"
                   : parsed.kind === "slug" ? "code"
                   : uuidRescue              ? "uuid"
                   :                           "invalid";
  const lookupValue = parsed.kind === "uuid" ? parsed.uuid
                    : parsed.kind === "slug" ? parsed.code
                    : uuidRescue;
  // Pre-fetch `id` is the UUID we have RIGHT NOW (URL says UUID), or null
  // (URL says slug — id will be filled in after the trip fetch resolves
  // to the row matching the short_code). The downstream code that uses
  // `id` for booking queries handles `null` gracefully (queries are
  // gated by `enabled: !!id`).
  const preFetchId = lookupKind === "uuid" ? lookupValue : null;
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── 1. States (no deps) ──────────────────────────────────────
  const [justBooked, setJustBooked] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState("cash");

  // Scroll to top when trip page opens. Depends on lookupValue (the URL
  // param's resolved id) so it fires immediately on navigation, not
  // after the trip fetch resolves.
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [lookupValue]);

  // ── 2. User query (must come before anything that uses user) ──
  // For anonymous share-link visitors, api.auth.me() throws
  // "Not authenticated" — set retry: false so we fail fast instead
  // of triggering 3 retries before settling.
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.auth.me(),
    retry: false,
  });

  // ── 3. Trip fetch — by UUID or short_code depending on what's in the URL.
  // Direct supabase (not api) to avoid the SDK's auto-injected
  // created_by filter that would hide the trip from non-driver viewers
  // (passengers, anonymous share-link visitors).
  // RLS already permits public read for status='confirmed' trips.
  const { data: tripData, isLoading: tripLoading, isError: tripError } = useQuery({
    queryKey: ["trip", lookupKind, lookupValue],
    queryFn: async () => {
      if (!lookupValue) return null;
      const col = lookupKind === "code" ? "short_code" : "id";
      const { data, error } = await supabase
        .from("trips")
        .select("*")
        .eq(col, lookupValue)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    enabled: !!lookupValue,
    staleTime: 30000,
    retry: 1,
  });

  // After we have the trip, compute its canonical slug. If the URL
  // is the legacy UUID form but the trip has a short_code (most do
  // post-migration 022), redirect to the canonical slug URL via
  // navigate(..., { replace: true }) so:
  //   1. Browser back-button doesn't bounce between UUID and slug
  //   2. Google de-dupes to the slug version (canonical also points there)
  //   3. Existing shared UUID links still work — silent client-side redirect
  //
  // Canonical-emitting useSEO call below uses the same slug, so the
  // <link rel="canonical"> always points to the slug form whether
  // the visitor arrived via UUID or slug.
  const canonicalSlug = buildTripSlug(tripData);
  useEffect(() => {
    if (!canonicalSlug) return;
    if (lookupKind === "uuid" && rawId !== canonicalSlug) {
      navigate(`/trip/${canonicalSlug}`, { replace: true });
    }
  }, [canonicalSlug, lookupKind, rawId, navigate]);

  // Resolved trip id — UUID-form for downstream queries.
  // Pre-fetch: from URL when URL is UUID. Post-fetch: from tripData.id.
  const id = preFetchId || tripData?.id || null;

  // ── 4. Existing booking check (depends on user + resolved trip) ──
  // Fetch ALL bookings this user has made for this trip — newest first.
  // Filter to active (non-cancelled) on the client so a stale cancelled
  // booking doesn't shadow a fresh re-booking. Limit 5 is plenty.
  //
  // Note: this query is gated on BOTH user.email AND `id` being known.
  // For slug URLs, `id` is null until the trip fetch resolves; once it
  // does, react-query detects the queryKey change and runs this query.
  const { data: existingBookings = [] } = useQuery({
    queryKey: ["my-booking", id, user?.email],
    queryFn: () => user?.email
      ? api.entities.Booking.filter({ trip_id: id, passenger_email: user.email }, "-created_date", 5)
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
  // useState init runs ONCE. For slug URLs, `id` is null at first render
  // (the trip hasn't resolved yet) — getFavs().has(null) is always false,
  // so the heart icon would stay un-favorited even on a trip the user
  // had previously favorited. The useEffect below re-syncs once the
  // real id is known. Same applies if the user/login changes mid-page.
  const [favorited, setFavorited] = useState(false);
  useEffect(() => {
    if (!id) return;
    setFavorited(getFavs().has(id));
    // favKey changes when user logs in/out — re-read the right list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, favKey]);

  const toggleFavorite = () => {
    const favs = getFavs();
    if (favorited) { favs.delete(id); toast("تمت الإزالة من المفضلة"); }
    else { favs.add(id); toast.success("تمت الإضافة للمفضلة ❤️"); }
    localStorage.setItem(favKey, JSON.stringify([...favs]));
    setFavorited(!favorited);
  };

  const { data: driverProfile } = useQuery({
    queryKey: ["driver-profile", tripData?.driver_id],
    queryFn: () => api.entities.Profile.filter({ created_by: tripData.driver_id }, "-created_at", 1),
    enabled: !!tripData?.driver_id,
    select: (data) => data?.[0] || null,
  });

  // ─── Block check ─────────────────────────────────────────────────────
  // True if the current user has blocked the trip's driver, OR the
  // driver has blocked the current user. Used both:
  //   1. To short-circuit the booking mutation with a clear Arabic toast
  //      before the round-trip (saves the user from a confusing
  //      40X-then-translate-server-error round-trip).
  //   2. To swap the bottom CTA out for an "unblock to book" notice so
  //      the button can't be clicked when blocked. Defense-in-depth:
  //      migration 017 also adds a check inside book_seat() so direct
  //      RPC calls fail with 42501 even if the UI is bypassed.
  const blockedSet = useBlockedEmails();
  const isDriverBlocked = !!(tripData?.driver_email && blockedSet.has(tripData.driver_email));

  const bookingMutation = useMutation({
    mutationFn: async (tripData) => {
      // Fast-path block check — if the passenger blocked the driver
      // (or vice versa) refuse here without contacting the server. The
      // server-side check in book_seat() (migration 017) is the
      // authoritative one; this is a UX nicety to avoid the round trip.
      if (tripData?.driver_email && blockedSet.has(tripData.driver_email)) {
        throw new Error("cannot book — block exists between passenger and driver");
      }
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
    onSuccess: (data) => {
      setShowConfirm(false);
      setJustBooked(true);
      toast.success("تم إرسال طلب الحجز! بانتظار موافقة السائق 🎉");
      qc.invalidateQueries({ queryKey: ["my-booking", id, user?.email] });
      qc.invalidateQueries({ queryKey: ["my-passenger-bookings"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["trip", id] });

      // Audit log — booking creation was unaudited. This entry is
      // what makes "this passenger booked Trip X" appear in the
      // activity feed. Server-side, the book_seat RPC has the
      // canonical record (bookings.id, created_at), but for the
      // audit trail we need an explicit row that admins can query
      // by passenger_email or trip_id without joining bookings.
      logAudit("booking_created", "booking", data?.id || null, {
        trip_id: tripData?.id,
        route: tripData ? `${tripData.from_city} → ${tripData.to_city}` : null,
        date: tripData?.date,
        passenger_email: user?.email,
        driver_email: tripData?.driver_email,
        payment_method: selectedPayment,
        seats: 1,
      });
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

  // Onboarding gate — fires AFTER the auth check below, BEFORE the
  // confirm modal opens. A non-onboarded user (typically a fresh
  // Google sign-in whose profile row was auto-created by
  // handle_new_user but has no phone / account_type yet) gets toasted
  // and redirected to /onboarding with a returnTo back to this trip,
  // so they finish their profile and land back here ready to book.
  // The server-side equivalent lives in book_seat (migration 034):
  // even if a malicious caller skips this client check, the RPC
  // rejects with 'profile incomplete — finish onboarding before
  // booking'. Defense in depth.
  const requireOnboarding = useOnboardingGate();

  // Book-button click handler — used by both the desktop sidebar book
  // button and the mobile sticky-bottom book button. Previously both
  // sites called setShowConfirm(true) unconditionally, so an anonymous
  // visitor would tap "احجز الآن", see the confirm modal, tap "تأكيد",
  // and get a generic "فشل الحجز، حاول مجدداً" toast when the
  // book_seat RPC rejected them with 42501 (auth required). Useless
  // guidance — they had no idea they needed to log in. Tightening
  // here surfaces the real next step (sign in or sign up) instead of
  // a dead-end error after two taps.
  // returnTo brings them straight back to this trip after auth, so
  // they can resume the booking with one more tap on the same button.
  const handleBookClick = () => {
    if (!user?.email) {
      navigate(`/login?returnTo=${encodeURIComponent(`/trip/${id}`)}`);
      return;
    }
    if (!requireOnboarding(`/trip/${id}`)) return;
    setShowConfirm(true);
  };

  // Per-trip SEO. Each trip page becomes an indexable landing page for the
  // route — drives organic traffic for queries like "رام الله إلى نابلس
  // مشاركة سيارة". The OG meta is also set server-side by /api/trip when
  // a bot crawls; this hook covers in-app navigations.
  const seoTitle = trip
    ? `رحلة من ${trip.from_city} إلى ${trip.to_city} — ₪${trip.price}`
    : "تفاصيل الرحلة";
  const seoDescription = trip
    ? `احجز مقعدك في رحلة ${trip.from_city} ← ${trip.to_city} بسعر ${trip.price} شيكل. ${trip.available_seats || 0} مقاعد متاحة.`
    : "تفاصيل الرحلة في مشوارو";
  // Canonical URL prefers the slug form (for SEO consolidation) and
  // falls back to the UUID form for trips not yet backfilled with
  // short_code (shouldn't happen post-migration 022 but defensive).
  const seoCanonical = trip
    ? absoluteUrl(`/trip/${canonicalSlug || trip.id}`)
    : undefined;

  // ── Per-trip JSON-LD structured data ─────────────────────────────
  // Schema.org doesn't have a perfect "rideshare trip" type, so we use
  // TouristTrip (general "trip" schema) plus an embedded Offer for the
  // seat price. This lets Google surface the route + price as a rich
  // result for queries like "رام الله إلى نابلس". The PostalAddress
  // bits are city-level only (we don't have street precision and
  // shouldn't pretend to). priceCurrency is ILS — Israeli Shekel,
  // the actual currency drivers and passengers transact in inside
  // the West Bank and Gaza.
  const tripJsonLd = trip ? {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    "name": `رحلة من ${trip.from_city} إلى ${trip.to_city}`,
    "description": seoDescription,
    "url": seoCanonical,
    "itinerary": {
      "@type": "ItemList",
      "itemListElement": [
        { "@type": "Place", "name": trip.from_city, "address": { "@type": "PostalAddress", "addressLocality": trip.from_city, "addressCountry": "PS" } },
        { "@type": "Place", "name": trip.to_city,   "address": { "@type": "PostalAddress", "addressLocality": trip.to_city,   "addressCountry": "PS" } },
      ],
    },
    "offers": {
      "@type": "Offer",
      "price": String(trip.price ?? ""),
      "priceCurrency": "ILS",
      "availability": (trip.available_seats > 0 && trip.status === "confirmed")
        ? "https://schema.org/InStock"
        : "https://schema.org/SoldOut",
      "url": seoCanonical,
    },
    // Trip start time. ar-EG-locale free-form fallback if date/time
    // are split: Schema.org accepts ISO-8601 here.
    ...(trip.date ? { "departureTime": `${trip.date}T${trip.time || "00:00"}:00` } : {}),
    "provider": {
      "@type": "Organization",
      "name": "مشوارو",
      "url": SITE_URL,
    },
  } : null;

  useSEO({ title: seoTitle, description: seoDescription, canonical: seoCanonical, jsonLd: tripJsonLd });

  // ── Render states ──────────────────────────────────────────
  // The previous code had a single `if (!trip) return <loading>` —
  // but Trip.get() returns null (not throws) for a non-existent ID,
  // so the query succeeds with null and the page would show "loading…"
  // forever for shared links to deleted/missing trips. Now we
  // distinguish: loading vs error vs not-found, and show a useful
  // empty state with a path forward (search instead of dead-end).
  if (tripLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="inline-block w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-muted-foreground text-sm">جاري التحميل...</p>
      </div>
    );
  }

  if (tripError) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">تعذّر تحميل الرحلة</h2>
        <p className="text-sm text-muted-foreground mb-6">حدث خطأ في الاتصال. تحقق من شبكتك وحاول مجدداً.</p>
        <div className="flex gap-2 justify-center">
          <button onClick={() => window.location.reload()} className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold">
            إعادة المحاولة
          </button>
          <Link to="/search" className="px-5 py-2.5 bg-muted text-foreground rounded-xl text-sm font-bold">
            البحث عن رحلات
          </Link>
        </div>
      </div>
    );
  }

  if (!trip) {
    // Trip not found — most common reasons: trip was deleted by the
    // driver, the share link was mistyped, or trip data was purged.
    // Give the user a path forward (search) rather than a dead end.
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4 text-3xl">
          🚗
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">هذه الرحلة لم تعد متاحة</h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          ربما تم حذف الرحلة من قِبل السائق، أو أن الرابط غير صحيح. يمكنك البحث عن رحلات أخرى متاحة.
        </p>
        <Link to="/search" className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm">
          ابحث عن رحلة
        </Link>
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
              {/* Seat count. The hardcoded amenity bullets that used to
                  live here (تكييف، موسيقى، مسموح بالتدخين، حقيبة) were
                  fake — they showed the SAME four items on every trip
                  regardless of what the driver actually offers. A
                  driver who explicitly disabled smoking would still
                  see their trip page advertising "مسموح بالتدخين" to
                  passengers. The real amenity chips, driven by
                  trip.amenities + pref_smoking / pref_pets /
                  pref_chattiness, render further down inside the main
                  trip-details panel. */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <Users className="w-4 h-4 text-primary shrink-0" />
                  <span>{trip.available_seats || 0} {trip.available_seats === 1 ? "مقعد متاح" : "مقاعد متاحة"}</span>
                </div>
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
                  {/* Block-aware CTA — when a block exists between the
                      current user and this trip's driver, swap the
                      "Book now" button for a notice. The user can still
                      see trip details for context (matches WhatsApp's
                      "you blocked this contact" pattern) but can't
                      attempt to book. Migration 017 enforces the same
                      check server-side. */}
                  {isDriverBlocked ? (
                    <div className="mt-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-center">
                      <p className="text-sm font-bold text-destructive">
                        🚫 لا يمكنك حجز هذه الرحلة
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        أحدكما حظر الآخر. يمكنك إدارة قائمة الحظر من{" "}
                        <Link to="/settings?section=blocked" className="text-primary underline">الإعدادات</Link>.
                      </p>
                    </div>
                  ) : (
                    <Button
                      className="w-full h-11 rounded-xl font-bold gap-2 mt-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={handleBookClick}
                      disabled={bookingMutation.isPending}
                    >
                      احجز الآن
                    </Button>
                  )}
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
                  <h4 className="font-bold">{trip.driver_name || "السائق"}</h4>
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

            {/* Payment Methods. Must show ALL methods the driver
                enabled. Previously the display only listed cash,
                bank_transfer, and 'card' — missing jawwal_pay and
                reflect entirely (drivers enabling them wouldn't see
                them advertised here), and using 'card' as the id
                while CreateTrip emits 'credit_card' (so even cards
                wouldn't appear). Aligned with the canonical set
                used in PassengerPaymentSetup. */}
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">طرق الدفع المقبولة</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "cash",          label: "نقداً",       icon: "💵" },
                  { id: "bank_transfer", label: "تحويل بنكي",  icon: "🏦" },
                  { id: "jawwal_pay",    label: "جوال باي",     icon: "📱" },
                  { id: "reflect",       label: "Reflect",      icon: "💳" },
                  { id: "credit_card",   label: "بطاقة ائتمان", icon: "💳" },
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
                      // url-only share to avoid text+url fusion when
                      // forwarded — preview comes from /api/trip OG meta
                      await navigator.share({
                        title: `رحلة من ${trip.from_city} إلى ${trip.to_city}`,
                        url: window.location.href,
                      });
                    } catch (err) {
                      if (err.name !== "AbortError") toast.error(friendlyError(err, "تعذر المشاركة"));
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
                  {isDriverBlocked ? (
                    <div className="flex-1 h-12 rounded-xl border-2 border-destructive/30 bg-destructive/5 flex items-center justify-center px-3">
                      <p className="text-xs font-bold text-destructive text-center leading-tight">
                        🚫 لا يمكنك حجز هذه الرحلة — أحدكما حظر الآخر
                      </p>
                    </div>
                  ) : (
                    <Button
                      className="flex-1 h-12 rounded-xl font-black text-base bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95 transition-transform"
                      onClick={handleBookClick}
                      disabled={bookingMutation.isPending}
                    >
                      احجز الآن
                    </Button>
                  )}
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

            {/* Payment method. IDs MUST match the canonical set used
                by CreateTrip and PassengerPaymentSetup. The previous
                IDs ('bank' / 'jawwal') didn't match any other surface
                in the app — drivers enabled bank_transfer at trip
                creation, the trip row stored 'bank_transfer', and
                this filter looked for 'bank' (no match), so the
                bank option silently disappeared from the booking
                modal. Same for jawwal_pay. */}
            <p className="text-sm font-bold mb-2">طريقة الدفع</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { id: "cash",          label: "نقداً",       icon: "💵" },
                { id: "jawwal_pay",    label: "جوال باي",     icon: "📱" },
                { id: "reflect",       label: "ريفلكت",       icon: "💳" },
                { id: "bank_transfer", label: "تحويل بنكي",   icon: "🏦" },
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

      {/* Bottom trust badges — every claim here must be TRUTHFUL.
          The previous set claimed (a) 24/7 support — there's no
          support team, (b) 'complete protection for your payments' —
          payments are settled externally via Jawwal/Reflect/bank, not
          in-app, (c) 'thousands of users trust us' — same fake claim
          being scrubbed elsewhere. App Store reviewers flag this
          kind of misleading marketing. Replaced with features we
          actually ship. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border">
        {[
          { icon: MessageCircle, title: "رسائل داخل التطبيق", desc: "تواصل مع السائق قبل الرحلة عبر الدردشة الآمنة" },
          { icon: Star, title: "نظام تقييم متبادل", desc: "اطّلع على تقييمات السائقين السابقة قبل الحجز" },
          { icon: X, title: "إلغاء قبل الرحلة", desc: "ألغِ حجزك قبل موعد الانطلاق دون رسوم" },
          { icon: Shield, title: "بلاغات على المستخدمين", desc: "أبلغ عن أي سلوك غير لائق وستراجعه الإدارة" },
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