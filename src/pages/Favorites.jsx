import { useSEO } from "@/hooks/useSEO";
import React, { useState, useCallback } from "react";
import { api } from "@/api/apiClient";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Heart, Search, Bell, ArrowLeft, UserCheck, Star, Car, X as XIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import TripCard from "../components/shared/TripCard";
import { isTripExpired } from "@/lib/tripScheduling";
import { useFavoriteDrivers } from "@/lib/favoriteDrivers";

export default function Favorites() {
  useSEO({ title: "المفضلة", description: "الرحلات والسائقون المفضلون لديك" });
  const [, forceUpdate] = useState(0);
  // Sub-tabs: "trips" (existing localStorage-backed trip favorites)
  // and "drivers" (new server-side favorite_drivers from mig 076).
  // Default to trips since that's the historical Favorites surface;
  // a user landing here from old bookmarks expects to see their
  // saved trips first.
  const [tab, setTab] = useState("trips");

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.auth.me(),
  });

  // ── Trip favorites (localStorage, existing behavior) ────────────────
  const favKey = `mishwar-favs-${user?.email || "anon"}`;
  const getFavIds = useCallback(() => {
    try { return new Set(JSON.parse(localStorage.getItem(favKey) || "[]")); }
    catch { return new Set(); }
  }, [favKey]);

  const favIds = getFavIds();
  const favIdsArray = Array.from(favIds);

  // Query only the trips matching favorited IDs. Previously this was
  // `Trip.list('-created_date', 200)` which returned the platform's
  // 200 newest trips, then filtered client-side to favIds. The
  // moment the platform had 200+ trips newer than a favorited trip,
  // that favorite vanished from the page — user thinks the trip was
  // deleted, but it's just outside the fetch window. Identical bug
  // pattern to the MyTrips critical fix from batch 2. Now we fetch
  // by id, so the result set scales with the user's favorites
  // count (typically 1-20) instead of platform size.
  const { data: trips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ["fav-trips", favIdsArray.join(",")],
    queryFn: async () => {
      if (favIdsArray.length === 0) return [];
      const { data, error } = await supabase
        .from("trips")
        .select("*")
        .in("id", favIdsArray);
      if (error) throw error;
      return data || [];
    },
    enabled: favIdsArray.length > 0,
  });

  const removeFav = (tripId) => {
    const favs = getFavIds();
    favs.delete(tripId);
    localStorage.setItem(favKey, JSON.stringify([...favs]));
    forceUpdate(n => n + 1); // re-render without reload
  };

  // ── Driver favorites (server-side, mig 076) ─────────────────────────
  // useFavoriteDrivers shares the react-query cache with TripCard hearts
  // and the SearchTrips filter, so toggling here ripples everywhere.
  const { favoriteSet: favDriverSet, count: favDriverCount, toggleFavorite: toggleDriverFavorite, isLoading: favDriversLoading } = useFavoriteDrivers();
  const favDriverEmails = Array.from(favDriverSet);

  // Fetch each favorite driver's profile + their upcoming trips. Two
  // queries:
  //   1. profiles for name + avatar + rating (so we can render the
  //      driver row even when they have ZERO upcoming trips — "saved,
  //      but no upcoming trips" is the most useful empty state for
  //      a passenger waiting for their favorite driver to post)
  //   2. their upcoming trips (gte today, status='confirmed') so we
  //      can show "next trip" inline on each driver card
  //
  // The profiles fetch uses a SECURITY DEFINER RPC (mig 078) rather
  // than a direct .from('profiles').in('email', ...) query, because
  // the profiles_select RLS policy correctly hides driver profiles
  // from arbitrary email lookups (a privacy boundary that prevents
  // user enumeration). For favorited drivers, the relationship is
  // documented in favorite_drivers, so the RPC re-permits the read
  // — but only for drivers the caller has actually favorited (the
  // RPC joins to favorite_drivers internally via auth.email()).
  //
  // Without this RPC, every favorited driver showed as 'orphan' even
  // when their profile existed — see screenshots in the dev log.
  const { data: favDriverProfiles = [], isLoading: profilesLoading } = useQuery({
    queryKey: ["fav-driver-profiles", favDriverEmails.join(",")],
    queryFn: async () => {
      if (favDriverEmails.length === 0) return [];
      const { data, error } = await supabase.rpc("get_favorite_drivers_display");
      if (error) throw error;
      return data || [];
    },
    enabled: favDriverEmails.length > 0,
    staleTime: 5 * 60 * 1000, // 5 min — driver profile barely changes
  });

  const { data: favDriverTrips = [], isLoading: favTripsLoading } = useQuery({
    queryKey: ["fav-driver-trips", favDriverEmails.join(",")],
    queryFn: async () => {
      if (favDriverEmails.length === 0) return [];
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("trips")
        .select("id, from_city, to_city, date, time, price, available_seats, driver_email, driver_name, status, short_code")
        .in("driver_email", favDriverEmails)
        .in("status", ["confirmed", "in_progress"])
        .gte("date", today)
        .order("date", { ascending: true })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: favDriverEmails.length > 0,
    staleTime: 60_000,
  });

  // Group upcoming trips by driver_email for inline display. O(n)
  // single pass, then O(1) per driver lookup. Map → object since
  // we only need .filter()-style access (not Map.get()).
  const tripsByDriver = favDriverTrips.reduce((acc, t) => {
    if (!acc[t.driver_email]) acc[t.driver_email] = [];
    acc[t.driver_email].push(t);
    return acc;
  }, {});

  // Filter out expired trips — a passenger favorited a trip in March,
  // it's now May, the trip has already happened. Showing it as a
  // bookable favorite is misleading. Stale favorites are silently
  // hidden but stay in localStorage in case they want a record.
  const favTrips = trips.filter(t => !isTripExpired(t));

  // For each favorite-driver email, see if we have a profile. If not
  // (driver deleted their account, or email mismatch from typo), we
  // STILL surface a placeholder row labeled "سائق لم يعد متاحاً" so
  // the passenger can clean up their list rather than being confused
  // about a phantom favorite. Source of truth is favDriverEmails (the
  // set of emails the user actually favorited); profile data is enrichment.
  const orphanFavorites = favDriverEmails.filter(
    email => !favDriverProfiles.some(p => p.email === email)
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <Heart className="w-6 h-6 text-destructive fill-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-black text-foreground">المفضلة</h1>
          <p className="text-sm text-muted-foreground">
            {tab === "trips"
              ? `${favTrips.length} رحلة محفوظة`
              : `${favDriverCount} سائق مفضل`}
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 mb-5 border-b border-border">
        <button
          onClick={() => setTab("trips")}
          aria-pressed={tab === "trips"}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "trips"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Heart className="w-4 h-4" />
            رحلات
            {favTrips.length > 0 && (
              <span className="text-xs opacity-70">({favTrips.length})</span>
            )}
          </span>
        </button>
        <button
          onClick={() => setTab("drivers")}
          aria-pressed={tab === "drivers"}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "drivers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <UserCheck className="w-4 h-4" />
            سائقون
            {favDriverCount > 0 && (
              <span className="text-xs opacity-70">({favDriverCount})</span>
            )}
          </span>
        </button>
      </div>

      {/* ── Trips tab (existing behavior) ────────────────────────────── */}
      {tab === "trips" && (
        <>
          {tripsLoading ? (
            <div className="space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="bg-card rounded-2xl border border-border p-6 animate-pulse h-32" />
              ))}
            </div>
          ) : favTrips.length === 0 ? (
            <div className="text-center py-20">
              <Heart className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
              <h3 className="text-lg font-bold text-foreground mb-2">لا توجد رحلات مفضلة بعد</h3>
              <p className="text-muted-foreground text-sm mb-6">
                اضغط على ❤️ في أي رحلة لحفظها هنا
              </p>
              <Link to="/search">
                <Button className="rounded-xl gap-2 bg-primary text-primary-foreground">
                  <Search className="w-4 h-4" />
                  ابحث عن رحلات
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {favTrips.map(trip => (
                <div key={trip.id} className="space-y-1.5">
                  <TripCard trip={trip} />
                  {/* Remove-from-favorites action — rendered below the card
                      rather than overlaid on top of it. The previous overlay
                      at top-4 left-4 collided with the price chip in RTL. */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => removeFav(trip.id)}
                      className="inline-flex items-center gap-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-full px-3 py-1.5 transition-colors"
                      title="إزالة من المفضلة"
                    >
                      <Heart className="w-3.5 h-3.5 fill-destructive" />
                      إزالة من المفضلة
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Drivers tab (new — server-side favorite_drivers) ─────────── */}
      {tab === "drivers" && (
        <>
          {favDriversLoading || profilesLoading ? (
            <div className="space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="bg-card rounded-2xl border border-border p-4 animate-pulse h-28" />
              ))}
            </div>
          ) : favDriverCount === 0 ? (
            <div className="text-center py-20">
              <UserCheck className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
              <h3 className="text-lg font-bold text-foreground mb-2">لا يوجد سائقون مفضلون بعد</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto leading-relaxed">
                أضف سائقاً للمفضلة بالضغط على أيقونة 👤+ بجانب اسم السائق في أي رحلة، وستصلك إشعار عندما ينشر رحلة جديدة.
              </p>
              <Link to="/search">
                <Button className="rounded-xl gap-2 bg-primary text-primary-foreground">
                  <Search className="w-4 h-4" />
                  ابحث عن سائقين
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Active driver cards — one per favorited driver who still
                  has a profile. */}
              {favDriverProfiles.map(driver => {
                const upcomingTrips = tripsByDriver[driver.email] || [];
                return (
                  <div key={driver.email} className="bg-card rounded-2xl border border-border p-4">
                    {/* Driver header */}
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center shrink-0">
                        {driver.profile_image
                          ? <img src={driver.profile_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                          : <span className="text-base font-bold text-primary">{(driver.full_name || "س")[0]}</span>}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/profile/${driver.id}`}
                          className="font-bold text-sm text-foreground hover:text-primary transition-colors"
                        >
                          {driver.full_name || "سائق"}
                        </Link>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {driver.driver_rating > 0 ? (
                            <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                              {Number(driver.driver_rating).toFixed(1)}
                              {driver.driver_reviews_count > 0 && (
                                <span className="opacity-70">({driver.driver_reviews_count})</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded-full font-medium">جديد ✨</span>
                          )}
                          {driver.car_model && (
                            <span className="text-[11px] text-muted-foreground truncate">• {driver.car_model}</span>
                          )}
                        </div>
                      </div>
                      {/* Remove button */}
                      <button
                        onClick={() => toggleDriverFavorite(driver.email)}
                        className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label="إزالة من المفضلة"
                        title="إزالة من المفضلة"
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Upcoming trips for this driver — inline list of up
                        to 3. Each is a tappable row that navigates to the
                        trip detail. Shows "no upcoming trips" with a hint
                        copy when the driver hasn't posted anything yet —
                        the most common reason a user is checking this
                        page in the first place. */}
                    {favTripsLoading ? (
                      <div className="mt-3 h-8 bg-muted/20 rounded animate-pulse" />
                    ) : upcomingTrips.length === 0 ? (
                      <div className="mt-3 bg-muted/30 rounded-xl px-3 py-2.5 flex items-center gap-2">
                        <Car className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          لا توجد رحلات قادمة من هذا السائق — سيصلك إشعار عند نشر رحلة جديدة
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[11px] text-muted-foreground font-medium mb-1">
                          الرحلات القادمة ({upcomingTrips.length})
                        </p>
                        {upcomingTrips.slice(0, 3).map(trip => (
                          <Link
                            key={trip.id}
                            to={`/trip/${trip.id}`}
                            className="flex items-center justify-between bg-muted/30 hover:bg-muted/50 rounded-xl px-3 py-2 transition-colors gap-2"
                          >
                            <span className="text-xs font-bold text-primary shrink-0">₪{trip.price}</span>
                            <div className="flex-1 min-w-0 text-right">
                              <p className="text-xs font-medium text-foreground truncate">
                                {trip.from_city} ← {trip.to_city}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {trip.date} • {trip.time} • {trip.available_seats} مقعد متاح
                              </p>
                            </div>
                          </Link>
                        ))}
                        {upcomingTrips.length > 3 && (
                          <Link
                            to={`/search?favs=1`}
                            className="block text-center text-[11px] text-primary hover:underline mt-1"
                          >
                            عرض جميع الرحلات ({upcomingTrips.length}) ←
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Orphan favorites — favorited emails that no longer have a
                  profile (driver deleted account, or rare data drift). Give
                  the user a clear path to clean up their list rather than
                  hiding silently.

                  Privacy: never display the raw driver email in the UI.
                  Even though it's the favoriting user's own data, leaking
                  another user's email address into the page DOM is a
                  privacy regression (it appears in screenshots, browser
                  back/forward cache, etc.) and feels unprofessional.

                  We instead show a generic placeholder + a short opaque
                  reference derived from the email so the user can
                  distinguish multiple orphans visually. The reference
                  is just the first 4 chars of a hex hash of the email,
                  presented as 'سائق #XXXX' — opaque to anyone reading
                  the page, but stable across re-renders for the
                  favoriting user. */}
              {orphanFavorites.length > 0 && (
                <div className="mt-2 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl space-y-2">
                  <p className="text-xs font-medium text-yellow-700">
                    {orphanFavorites.length === 1
                      ? "سائق واحد لم يعد متاحاً"
                      : `${orphanFavorites.length} سائق لم يعد متاحاً`}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                    قد يكون السائق قد حذف حسابه. يمكنك إزالة هذه التفضيلات لتنظيف قائمتك.
                  </p>
                  {orphanFavorites.map((email, idx) => {
                    // Short opaque ref — 4 chars from a simple djb2-ish
                    // hash of the email. Deterministic per email so the
                    // same orphan always shows the same ref, but the
                    // email itself never reaches the DOM. Not cryptographic
                    // — just enough to distinguish orphans visually.
                    let h = 5381;
                    for (let i = 0; i < email.length; i++) {
                      h = ((h * 33) ^ email.charCodeAt(i)) >>> 0;
                    }
                    const ref = h.toString(16).slice(0, 4).toUpperCase();
                    return (
                      <div key={email} className="flex items-center justify-between gap-2 bg-card rounded-xl px-3 py-2.5">
                        <button
                          onClick={() => toggleDriverFavorite(email)}
                          className="text-xs text-destructive hover:underline shrink-0"
                        >
                          إزالة
                        </button>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-muted-foreground font-mono bg-muted/40 rounded px-1.5 py-0.5 shrink-0">
                            #{ref}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            سائق غير متاح
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Route alerts promo */}
      <div className="mt-8 bg-primary/5 border border-primary/20 rounded-2xl p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Bell className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm text-foreground">تنبيهات المسارات</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            هل تريد إشعاراً عند توفر رحلة بين مدينتين بشكل دوري؟
          </p>
          <Link to="/notifications" className="text-primary text-xs font-bold hover:underline mt-1 inline-flex items-center gap-1">
            إضافة مسار مفضل <ArrowLeft className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
