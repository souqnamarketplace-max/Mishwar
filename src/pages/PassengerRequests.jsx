import React, { useState, useMemo, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { useSEO } from "@/hooks/useSEO";
import { supabase } from "@/lib/supabase";
import { api } from "@/api/apiClient";
import { CITY_COORDS } from "@/lib/mapUtils";
import { useBlockedEmails } from "@/lib/blockUtils";
import { ArrowLeft, Filter, Search, Sparkles, Wallet, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RequestCard from "@/components/requests/RequestCard";
import CityAutocomplete from "@/components/shared/CityAutocomplete";

/**
 * PassengerRequests — driver-facing browse view.
 *
 * Subscription gate: drivers without an active subscription see an
 * upgrade prompt with a teaser count (public_open_requests_count RPC
 * returns the global open-request total without requiring subscription).
 *
 * Filters (client-side, since the dataset is bounded by RLS to ~100s):
 *   - From / To cities (text match)
 *   - Date range (today, this week, custom)
 *   - Max suggested price slider
 *   - Seats needed
 *   - "Near my city" — radius slider 5–30km, default 10km, uses
 *     from_lat/from_lng on the request and CITY_COORDS for the driver's
 *     home city (Haversine distance)
 *
 * Block-aware via useBlockedEmails (server-side RESTRICTIVE policy is
 * the authoritative gate; client filter is just for snappy UX).
 *
 * Tapping a card → /messages?to=<passenger>&request=<id>. The contact
 * RPC fires from there to increment contact_count atomically (with
 * dedup per driver).
 */

// Haversine: km between two lat/lng pairs
function distKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2
          + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180)
          * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default function PassengerRequests() {
  useSEO({
    title: "طلبات الركاب",
    description: "تصفح طلبات الرحلات من الركاب وتواصل معهم مباشرة",
  });

  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const navigate = useNavigate();
  const blocked  = useBlockedEmails();

  // ─── Subscription check ───────────────────────────────────────
  const { data: subActive, isLoading: subLoading } = useQuery({
    queryKey: ["is-driver-subscribed", user?.email],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_driver_subscribed", { p_email: user.email });
      if (error) throw error;
      return !!data;
    },
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  // Public count for the teaser shown to non-subscribers
  const { data: openCount = 0 } = useQuery({
    queryKey: ["public-open-requests-count"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_open_requests_count");
      if (error) throw error;
      return Number(data || 0);
    },
    staleTime: 30_000,
  });

  // ─── Filters ──────────────────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false);
  const [fromCity, setFromCity]       = useState("");
  const [toCity, setToCity]           = useState("");
  const [maxPrice, setMaxPrice]       = useState(1000);
  const [minSeats, setMinSeats]       = useState(1);
  const [datePreset, setDatePreset]   = useState("any");  // any | today | week
  const [nearMe, setNearMe]           = useState(false);
  const [radiusKm, setRadiusKm]       = useState(10);

  // The driver's home city coords for "near me" filtering
  const driverCoord = user?.city ? CITY_COORDS[user.city] : null;

  // ─── Fetch requests ───────────────────────────────────────────
  // Note: queryKey scoped to user.email even though the FEED is
  // global. Otherwise user A's feed leaks via react-query cache to
  // user B after a sign-out/sign-in cycle. Same data ultimately but
  // a stale-across-sessions footgun otherwise.
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["passenger-requests-feed", user?.email],
    queryFn: () => api.entities.TripRequest.filter(
      { status: "open" }, "-created_at", 200
    ),
    enabled: !!user?.email && subActive === true,
    staleTime: 30_000,
  });

  // ─── Apply client-side filters ───────────────────────────────
  const filtered = useMemo(() => {
    if (!requests.length) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);

    return requests.filter(r => {
      // Self-filter: don't show driver their own (if they also have passenger account)
      if (r.passenger_email === user?.email) return false;
      // Block filter (client-side; server is authoritative via RESTRICTIVE RLS)
      if (blocked.has(r.passenger_email)) return false;
      // Route filters (substring match on city names)
      if (fromCity && !(r.from_city || "").includes(fromCity)) return false;
      if (toCity   && !(r.to_city   || "").includes(toCity))   return false;
      // Price ceiling
      if (Number(r.suggested_price || 0) > maxPrice) return false;
      // Seats
      if (Number(r.seats_needed || 0) < minSeats) return false;
      // Date preset
      if (datePreset !== "any") {
        const reqDate = new Date(r.requested_date + "T12:00:00");
        if (datePreset === "today" && reqDate.toDateString() !== today.toDateString()) return false;
        if (datePreset === "week" && (reqDate < today || reqDate > weekEnd)) return false;
      }
      // Near me (radius from driver's home city to request's from_lat/lng)
      if (nearMe && driverCoord && r.from_lat != null && r.from_lng != null) {
        const d = distKm(driverCoord[0], driverCoord[1], Number(r.from_lat), Number(r.from_lng));
        if (d == null || d > radiusKm) return false;
      } else if (nearMe && (!driverCoord || r.from_lat == null)) {
        // Hide rows we can't compute distance for if "near me" is enabled
        return false;
      }
      return true;
    });
  }, [requests, blocked, user?.email, fromCity, toCity, maxPrice, minSeats, datePreset, nearMe, radiusKm, driverCoord]);

  // ─── Auth gate ────────────────────────────────────────────────
  // navigate-during-render is a React anti-pattern (strict mode warns).
  // Use a useEffect side-effect instead, then return a splash while the
  // route change happens.
  useEffect(() => {
    if (!isLoadingAuth && !isAuthenticated) {
      navigate("/login?returnTo=/passenger-requests", { replace: true });
    }
  }, [isLoadingAuth, isAuthenticated, navigate]);

  if (!isLoadingAuth && !isAuthenticated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Subscription gate UI ─────────────────────────────────────
  if (!subLoading && subActive === false) {
    // CTA varies by account type:
    //   - Driver / both → "اشترك" → /driver?tab=subscription (existing flow)
    //   - Passenger     → "كن سائقاً" → /become-driver (must upgrade first)
    //                     because /driver dashboard doesn't exist for them
    //                     and /driver?tab=subscription would 404 or redirect
    const isPassengerOnly = user?.account_type === "passenger";
    const ctaHref  = isPassengerOnly ? "/become-driver" : "/driver?tab=subscription";
    const ctaLabel = isPassengerOnly ? "كن سائقاً للوصول للطلبات" : "اشترك الآن لتصفح الطلبات";
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 rotate-180" />
          رجوع
        </Link>

        <div className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground rounded-2xl p-6 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <Sparkles className="w-7 h-7" />
            <h1 className="text-2xl font-bold">طلبات الركاب</h1>
          </div>
          <p className="text-sm leading-relaxed opacity-95">
            تصفح طلبات الرحلات من الركاب الذين يبحثون عن سائق لمسارك.
            ميزة حصرية للسائقين المشتركين في المنصة.
          </p>
          {isPassengerOnly && (
            <p className="text-xs leading-relaxed opacity-85 mt-2 bg-black/15 rounded-lg px-3 py-2">
              💡 حسابك حالياً كراكب فقط. لتصفح طلبات الركاب يجب أن تصبح سائقاً
              في مشوارو أولاً.
            </p>
          )}
        </div>

        {openCount > 0 && (
          <div className="bg-card border border-border rounded-2xl p-5 mb-4 text-center">
            <p className="text-3xl font-black text-primary">{openCount.toLocaleString("ar-EG")}</p>
            <p className="text-sm text-muted-foreground mt-1">طلب نشط الآن في المنصة</p>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-foreground">ما الذي ستحصل عليه؟</h3>
          <ul className="space-y-2 text-sm text-foreground/80">
            <li className="flex items-start gap-2">
              <span className="text-primary shrink-0">✓</span>
              تصفح جميع طلبات الركاب على مساراتك المفضلة
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary shrink-0">✓</span>
              فلتر "بالقرب مني" — أرَ فقط طلبات مدينتك
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary shrink-0">✓</span>
              تواصل مباشر مع الراكب عبر الرسائل (لا واتساب، لا أرقام)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary shrink-0">✓</span>
              مجاني للراكب، اشتراك السائق فقط ₪30/شهر
            </li>
          </ul>
          <Link to={ctaHref}>
            <Button className="w-full h-12 rounded-xl text-base font-bold gap-2 mt-2">
              <Wallet className="w-5 h-5" />
              {ctaLabel}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ─── Main feed ────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28" dir="rtl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4 rotate-180" />
        رجوع
      </Link>

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">طلبات الركاب</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} طلب {requests.length > filtered.length && `(من ${requests.length})`}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowFilters(s => !s)}
          className="rounded-xl gap-1"
        >
          <Filter className="w-4 h-4" />
          فلاتر
        </Button>
      </div>

      {/* Filters drawer */}
      {showFilters && (
        <div className="bg-card border border-border rounded-2xl p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">من مدينة</label>
              <CityAutocomplete value={fromCity} onChange={setFromCity} placeholder="أي مدينة" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">إلى مدينة</label>
              <CityAutocomplete value={toCity} onChange={setToCity} placeholder="أي مدينة" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">التاريخ</label>
            <div className="flex gap-2">
              {[
                { id: "any",   label: "الكل" },
                { id: "today", label: "اليوم" },
                { id: "week",  label: "هذا الأسبوع" },
              ].map(p => (
                <button key={p.id} type="button"
                  onClick={() => setDatePreset(p.id)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    datePreset === p.id ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground hover:bg-muted"
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
              <span>الحد الأقصى للسعر المقترح</span>
              <span className="text-foreground font-bold">₪{maxPrice}</span>
            </label>
            <input type="range" min={50} max={1000} step={10}
              value={maxPrice}
              onChange={e => setMaxPrice(parseInt(e.target.value))}
              className="w-full accent-primary" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
              <span>الحد الأدنى للمقاعد</span>
              <span className="text-foreground font-bold">{minSeats}</span>
            </label>
            <input type="range" min={1} max={6} step={1}
              value={minSeats}
              onChange={e => setMinSeats(parseInt(e.target.value))}
              className="w-full accent-primary" />
          </div>

          {/* Near me */}
          <div className="pt-2 border-t border-border/60">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={nearMe} onChange={e => setNearMe(e.target.checked)} />
              <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-primary" />
                بالقرب مني
                {!driverCoord && <span className="text-[10px] text-amber-600">(حدّد مدينتك في الإعدادات)</span>}
              </span>
            </label>
            {nearMe && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between">
                  <span>المسافة من {user?.city || "مدينتي"}</span>
                  <span className="text-foreground font-bold">{radiusKm} كم</span>
                </label>
                <input type="range" min={5} max={30} step={1}
                  value={radiusKm}
                  onChange={e => setRadiusKm(parseInt(e.target.value))}
                  className="w-full accent-primary" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading || subLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        // The previous copy ("لا توجد طلبات تطابق فلاترك / جرّب توسيع
        // الفلاتر") implied filters were the cause even when the
        // platform itself had zero open requests — confusing for
        // drivers visiting a fresh deployment or after all requests
        // got claimed. Distinguish by `requests.length`: if the raw
        // feed is empty there's nothing to filter, so show a
        // non-blaming message that frames the empty state as a
        // "check back" moment instead.
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <Search className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-50" />
          {requests.length === 0 ? (
            <>
              <p className="text-sm font-bold text-foreground mb-1">لا توجد طلبات حالياً</p>
              <p className="text-xs text-muted-foreground">تابع الموقع — ركاب جدد ينشرون طلباتهم يومياً.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-foreground mb-1">لا توجد طلبات تطابق فلاترك</p>
              <p className="text-xs text-muted-foreground">جرّب توسيع الفلاتر أو إزالة بعضها</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <RequestCard
              key={r.id}
              request={r}
              mode="driver"
              onClick={() => {
                // Open the request-details page. The driver should review
                // the trip + passenger profile BEFORE deciding to message.
                // RequestDetails owns the chat-launch button + view_count
                // tracking; the contact_count RPC fires once the driver
                // sends their first message in /messages.
                navigate(`/passenger-requests/${r.id}`);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
