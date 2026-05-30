import { useSEO } from "@/hooks/useSEO";
import React, { useState, useRef, useEffect } from "react";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Car, Users, DollarSign, Star, ChevronDown, Plus, X,
  TrendingUp, CreditCard, CheckCircle, Wallet
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import DriverStats from "../components/driver/DriverStats";
import DriverTripsList from "../components/driver/DriverTripsList";
import DriverPassengers from "../components/driver/DriverPassengers";
import DriverVehicleEditor from "../components/driver/DriverVehicleEditor";
import DriverRatePassengers from "../components/driver/DriverRatePassengers";
import DriverRatingsDashboard from "../components/driver/DriverRatingsDashboard";
import DriverReviewWizard from "../components/reviews/DriverReviewWizard";
import { useGPSTripCompletion } from "../lib/gpsTracking";
import { createPortal } from "react-dom";
import { MapPin, Navigation, Clock } from "lucide-react";
import DriverPaymentSetup from "../components/driver/DriverPaymentSetup";
import DriverSubscriptionSection from "../components/driver/DriverSubscriptionSection";

// ─── Tab definitions ────────────────────────────────────────────────────────
// Two rating tabs:
//   - "my-ratings" — how PASSENGERS rated ME (the driver's reputation,
//     average + histogram + recent reviews). This was the missing piece.
//   - "rate-passengers" — pending driver→passenger reviews to leave.
//     Was previously labeled just "التقييمات" which was confusing because
//     drivers expected to find their own ratings there.
const TABS = [
  { id: "trips",          label: "رحلاتي",         icon: Car,        color: "text-primary"   },
  { id: "passengers",     label: "الركاب",          icon: Users,      color: "text-blue-600"  },
  { id: "earnings",       label: "الأرباح",         icon: DollarSign, color: "text-green-600" },
  { id: "my-ratings",     label: "تقييماتي",        icon: Star,       color: "text-yellow-600" },
  { id: "rate-passengers", label: "تقييم الركاب",    icon: Star,       color: "text-orange-500" },
  { id: "vehicle",        label: "مركبتي",          icon: Car,        color: "text-accent"    },
  { id: "payments",       label: "الدفع",           icon: CreditCard, color: "text-purple-600"},
  { id: "subscription",   label: "اشتراك المنصة",   icon: Wallet,     color: "text-orange-600"},
];

// ─── Mobile dropdown tab selector ──────────────────────────────────────────
function MobileTabSelector({ tabs, active, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activeTab = tabs.find(t => t.id === active) || tabs[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative md:hidden mb-4" dir="rtl">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 bg-card border border-border rounded-2xl px-4 py-3.5 text-right shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl bg-muted flex items-center justify-center`}>
            <activeTab.icon className={`w-4 h-4 ${activeTab.color}`} />
          </div>
          <span className="font-semibold text-foreground">{activeTab.label}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="absolute top-full right-0 left-0 mt-1.5 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-50">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              onClick={() => { onChange(tab.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-right transition-colors ${
                i < tabs.length - 1 ? "border-b border-border/50" : ""
              } ${tab.id === active ? "bg-primary/5" : "hover:bg-muted/50"}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                tab.id === active ? "bg-primary/10" : "bg-muted"
              }`}>
                <tab.icon className={`w-4 h-4 ${tab.id === active ? tab.color : "text-muted-foreground"}`} />
              </div>
              <span className={`font-medium text-sm ${tab.id === active ? "text-foreground" : "text-muted-foreground"}`}>
                {tab.label}
              </span>
              {tab.id === active && (
                <CheckCircle className="w-4 h-4 text-primary mr-auto" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Desktop tab bar ────────────────────────────────────────────────────────
function DesktopTabBar({ tabs, active, onChange }) {
  return (
    <div className="hidden md:flex gap-1 bg-muted/50 p-1 rounded-xl mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
            active === tab.id
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <tab.icon className="w-4 h-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Earnings tab (inline) ──────────────────────────────────────────────────
//
// Enhanced for scale (scale audit P1 #4): adds time-period summary tiles
// (this week / this month / last 30 days), top-routes ranking, and avg
// per trip. The original tab showed only lifetime totals + per-payment-
// method + last 10 trips — fine for a driver with 5 trips, but a daily
// commuter wants to know "did this week earn more than last week?".
//
// All computations are client-side from already-fetched `bookings` and
// `trips`. No new server query needed — earnings data is local to the
// driver's existing dataset.
//
// Date matching strategy:
// - "This week" = bookings on trips with date >= Monday of current
//   Asia/Jerusalem week (Palestinian work week starts Monday locally;
//   no fiqh-week-start ambiguity for earnings reporting)
// - "This month" = bookings on trips with date >= 1st of current month
// - "Last 30 days" = bookings on trips with date >= today - 30 days
//   (rolling window, useful when month is fresh)
//
// We bucket by trip.date (when the trip actually happened) rather than
// booking.created_at (when the seat was reserved). A passenger who books
// today for a trip next month should count against next month's earnings,
// not this month's — matching how the driver thinks about cash flow.
function EarningsTab({ bookings, trips, totalEarnings, pendingEarnings = 0 }) {
  // Show paid earnings vs pending receivable separately so driver knows
  // the difference between money already in hand vs money still owed.
  // Filter for confirmed/completed PAID bookings only — pending bookings
  // belong in a separate "to-receive" stat below.
  const confirmed = bookings.filter(b => (b.status === "confirmed" || b.status === "completed") && b.payment_status === "paid");
  const byMethod = confirmed.reduce((acc, b) => {
    const m = b.payment_method || "cash";
    acc[m] = (acc[m] || 0) + (b.total_price || 0);
    return acc;
  }, {});
  const methodLabel = {
    cash:          "نقداً 💵",
    bank_transfer: "تحويل 🏦",
    reflect:       "Reflect 💜",
    jawwal_pay:    "Jawwal 📱",
    // Was 'card'; CreateTrip emits 'credit_card'. Drivers taking
    // credit-card payments were seeing the raw 'credit_card' string
    // here as fallback (via `methodLabel[method] || method`) instead
    // of a friendly Arabic label.
    credit_card:   "بطاقة 💳",
  };

  // ── Time-bucket math ─────────────────────────────────────────────────
  // Compute Palestinian-local "now" so the week/month boundaries match
  // what the driver experiences on the calendar. Without TZ awareness,
  // a driver in Ramallah looking at the dashboard at 11pm Sunday would
  // see UTC's Monday already started, which would split Monday's
  // earnings across two weeks visually.
  const now = new Date();
  const tzNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const todayISO = tzNow.toISOString().split("T")[0]; // YYYY-MM-DD, matches trips.date

  // Monday of current week (Palestine convention). getDay() returns
  // 0=Sun, 1=Mon, ..., 6=Sat. To get Monday-as-start-of-week, shift by
  // ((day + 6) % 7) days back — handles Sunday correctly (0 → 6 back).
  const dayOfWeek = tzNow.getDay();
  const daysToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(tzNow);
  monday.setDate(tzNow.getDate() - daysToMonday);
  monday.setHours(0, 0, 0, 0);
  const mondayISO = monday.toISOString().split("T")[0];

  // 1st of current month
  const firstOfMonth = new Date(tzNow.getFullYear(), tzNow.getMonth(), 1);
  const monthStartISO = firstOfMonth.toISOString().split("T")[0];

  // 30 days ago (rolling)
  const thirtyDaysAgo = new Date(tzNow);
  thirtyDaysAgo.setDate(tzNow.getDate() - 30);
  const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().split("T")[0];

  // Map trip_id → trip object so we can join booking.total_price back to
  // its trip.date in O(1). Precomputed once outside the reduce loops.
  const tripById = new Map(trips.map(t => [t.id, t]));

  // Sum earnings for a date predicate. Walks confirmed bookings, looks
  // up parent trip's date (string compare on YYYY-MM-DD works since
  // ISO dates sort lexicographically). Earnings-less bookings (cash
  // not yet tallied) still count if status is confirmed/completed —
  // matches the overall totalEarnings calc above.
  const sumWhere = (predicate) => {
    let total = 0;
    let count = 0;
    for (const b of confirmed) {
      const trip = tripById.get(b.trip_id);
      if (!trip || !trip.date) continue;
      if (predicate(trip.date)) {
        total += (b.total_price || 0);
        count += 1;
      }
    }
    return { total, count };
  };

  const thisWeek    = sumWhere(d => d >= mondayISO       && d <= todayISO);
  const thisMonth   = sumWhere(d => d >= monthStartISO   && d <= todayISO);
  const last30Days  = sumWhere(d => d >= thirtyDaysAgoISO && d <= todayISO);

  // Average per booking (more meaningful than per-trip since a trip can
  // have multiple passengers). Guard division by zero — newly-onboarded
  // drivers with no bookings yet would otherwise see NaN.
  const avgPerBooking = confirmed.length > 0
    ? Math.round(totalEarnings / confirmed.length)
    : 0;

  // ── Top routes by earnings ────────────────────────────────────────────
  // Group confirmed bookings by their trip's "from → to" route, sum,
  // sort descending, take top 5. Useful for a daily commuter: "you've
  // made most of your money on the Ramallah → Hebron route — keep
  // listing that one." Falls back to "—" placeholder when route info
  // is missing (shouldn't happen, but defensive).
  const routeEarnings = confirmed.reduce((acc, b) => {
    const trip = tripById.get(b.trip_id);
    if (!trip) return acc;
    const route = `${trip.from_city || "؟"} ← ${trip.to_city || "؟"}`;
    if (!acc[route]) acc[route] = { earnings: 0, count: 0 };
    acc[route].earnings += (b.total_price || 0);
    acc[route].count += 1;
    return acc;
  }, {});
  const topRoutes = Object.entries(routeEarnings)
    .map(([route, data]) => ({ route, ...data }))
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, 5);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Summary card — all-time, hero treatment */}
      <div className="bg-gradient-to-br from-primary to-accent rounded-2xl p-5 text-primary-foreground">
        <p className="text-sm opacity-80 mb-1">الأرباح المحصّلة</p>
        <p className="text-4xl font-black">₪{totalEarnings.toLocaleString()}</p>
        <p className="text-xs opacity-70 mt-2">{confirmed.length} حجز مدفوع · متوسط ₪{avgPerBooking}/حجز</p>
      </div>

      {/* Pending receivable — money expected but not yet collected */}
      {pendingEarnings > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-yellow-700 font-medium mb-0.5">بانتظار التحصيل</p>
            <p className="text-2xl font-bold text-yellow-800">₪{pendingEarnings.toLocaleString()}</p>
          </div>
          <p className="text-[11px] text-yellow-700 leading-tight text-left max-w-[140px]">
            حجوزات مؤكدة لم تُسجّل كمدفوعة بعد. اضغط "تم الدفع" في صفحة الركاب عند استلام المبلغ.
          </p>
        </div>
      )}

      {/* Time-period quick stats grid. Four tiles: this week, this month,
          last 30 days rolling, all-time count. Mobile: 2 cols. Desktop: 4 cols.
          Each tile shows: label, amount, booking count below. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <EarningsTile
          label="هذا الأسبوع"
          sublabel="من الإثنين"
          amount={thisWeek.total}
          count={thisWeek.count}
          accent="text-blue-600 bg-blue-500/10"
        />
        <EarningsTile
          label="هذا الشهر"
          sublabel="منذ بداية الشهر"
          amount={thisMonth.total}
          count={thisMonth.count}
          accent="text-green-600 bg-green-500/10"
        />
        <EarningsTile
          label="آخر 30 يوماً"
          sublabel="نافذة متحركة"
          amount={last30Days.total}
          count={last30Days.count}
          accent="text-amber-600 bg-amber-500/10"
        />
        <EarningsTile
          label="إجمالي الرحلات"
          sublabel="منذ التسجيل"
          amount={null}
          count={trips.length}
          countLabel="رحلة"
          accent="text-purple-600 bg-purple-500/10"
        />
      </div>

      {/* Top routes — only show when the driver has earnings on multiple
          routes. A driver who only drives one route would see a trivial
          single-entry list which adds no value. */}
      {topRoutes.length > 1 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="font-bold text-sm mb-3">أكثر المسارات ربحاً</p>
          <div className="space-y-2">
            {topRoutes.map((r, idx) => (
              <div key={r.route} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx === 0 ? "bg-yellow-500/20 text-yellow-700" :
                    idx === 1 ? "bg-gray-300/30 text-gray-700"     :
                    idx === 2 ? "bg-orange-500/20 text-orange-700" :
                                "bg-muted text-muted-foreground"
                  }`}>
                    {idx + 1}
                  </span>
                  <span className="text-sm font-bold text-primary">₪{r.earnings.toLocaleString()}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{r.route}</p>
                  <p className="text-xs text-muted-foreground">{r.count} حجز</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By payment method */}
      {Object.keys(byMethod).length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-4">
          <p className="font-bold text-sm mb-3">حسب طريقة الدفع</p>
          <div className="space-y-2">
            {Object.entries(byMethod).map(([method, amount]) => (
              <div key={method} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-sm font-medium">₪{amount.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground">{methodLabel[method] || method}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-trip breakdown */}
      <div className="bg-card rounded-2xl border border-border p-4">
        <p className="font-bold text-sm mb-3">تفصيل الرحلات</p>
        {trips.length === 0
          ? <p className="text-sm text-muted-foreground text-center py-4">لا توجد رحلات بعد</p>
          : trips.slice(0, 10).map(trip => {
              const tripBookings = confirmed.filter(b => b.trip_id === trip.id);
              const earned = tripBookings.reduce((s, b) => s + (b.total_price || 0), 0);
              if (earned === 0) return null;
              return (
                <div key={trip.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                  <span className="text-sm font-bold text-primary">₪{earned}</span>
                  <div className="text-right">
                    <p className="text-sm font-medium">{trip.from_city} ← {trip.to_city}</p>
                    <p className="text-xs text-muted-foreground">{trip.date} · {tripBookings.length} راكب</p>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ─── Earnings tile (small reusable card for the quick-stats grid) ──────
//
// Keeps the JSX in EarningsTab readable. Variants:
//   - amount=null + count + countLabel: shows just the count (used for
//     "total trips" tile which is a count, not an amount)
//   - amount + count: shows ₪amount on top, "{count} حجز" below
//
// `accent` is a Tailwind classname pair (text-X bg-X/10) so the tile's
// number color matches its corner badge color, giving each tile a
// distinct visual identity at a glance.
function EarningsTile({ label, sublabel, amount, count, countLabel = "حجز", accent }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-3">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mb-2 ${accent}`}>
        <DollarSign className="w-4 h-4" aria-hidden="true" />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-[10px] text-muted-foreground/70 mb-1.5">{sublabel}</p>
      {amount !== null ? (
        <>
          <p className={`text-xl font-bold ${accent.split(" ")[0]}`}>₪{amount.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{count} {countLabel}</p>
        </>
      ) : (
        <p className={`text-xl font-bold ${accent.split(" ")[0]}`}>{count} {countLabel}</p>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function DriverDashboard() {
  const [reviewWizard, setReviewWizard] = useState(null); // { trip, passengers }
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  useSEO({ title: "لوحة السائق", description: "لوحة قيادة السائق في مشوارو" });

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "trips");
  const [selectedTripId, setSelectedTripId] = useState(null);
  const qc = useQueryClient();

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => api.auth.me() });

  const { data: trips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ["driver-trips", user?.email],
    queryFn: () => user?.email
      ? api.entities.Trip.filter({ driver_email: user.email }, "-created_date", 50)
      : [],
    enabled: !!user?.email,
  });

  const tripIds = trips.map(t => t.id);
  // Query bookings for THIS driver's trips, not the platform's newest 500.
  // The previous `Booking.list('-created_date', 500)` returned the
  // platform's most-recently-created bookings and filtered client-side
  // to tripIds — meaning a driver with bookings on trips older than
  // the 500 newest platform bookings would silently lose them from
  // this view. Critically, `totalEarnings` is derived from this set —
  // so the driver's REPORTED EARNINGS would be UNDERSTATED, and their
  // earnings tab would show ₪0 for older trips that still had paid
  // bookings on them. Same anti-pattern as the MyTrips critical fix.
  //
  // Empty tripIds (driver hasn't published anything yet) → skip the
  // query entirely; bookings stays as the default [] from useQuery.
  const { data: bookings = [] } = useQuery({
    queryKey: ["driver-bookings", user?.email, tripIds.join(",")],
    queryFn: async () => {
      if (tripIds.length === 0) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .in("trip_id", tripIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email && tripIds.length > 0,
  });

  // Earnings: only PAID bookings count toward "received earnings".
  // Confirmed/completed but not-yet-paid are shown as pending receivable.
  // Previously this included unpaid bookings, overstating actual revenue.
  const paidBookings     = bookings.filter(b => (b.status === "confirmed" || b.status === "completed") && b.payment_status === "paid");
  const pendingBookings  = bookings.filter(b => (b.status === "confirmed" || b.status === "completed") && b.payment_status !== "paid");
  const totalEarnings    = paidBookings.reduce((s, b) => s + (b.total_price || 0), 0);
  const pendingEarnings  = pendingBookings.reduce((s, b) => s + (b.total_price || 0), 0);
  const totalPassengers  = bookings.filter(b => b.status !== "cancelled").length;
  const activeTrips      = trips.filter(t => t.status === "confirmed" || t.status === "in_progress").length;
  const completedTrips   = trips.filter(t => t.status === "completed").length;

  // Realtime
  React.useEffect(() => {
    if (!user?.email) return;
    const u = api.entities.Booking.subscribe(() => {
      qc.invalidateQueries({ queryKey: ["driver-bookings", user.email] });
      qc.invalidateQueries({ queryKey: ["driver-trips", user.email] });
    });
    return () => u();
  }, [user?.email, qc]);

  const handleTabChange = (tab) => setActiveTab(tab);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8" dir="rtl">

      {/* ── Mobile header: compact ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">لوحة السائق</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">أدِر رحلاتك وتابع أرباحك</p>
        </div>
        <Link to="/create-trip">
          <Button className="bg-primary text-primary-foreground rounded-xl gap-1.5 h-9 px-3 sm:h-10 sm:px-4 text-sm">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">رحلة جديدة</span>
            <span className="sm:hidden">أضف</span>
          </Button>
        </Link>
      </div>

      {/* Quick cross-role link to /my-trips. Without this, drivers
          on mobile had no in-page path to /my-trips (the bottom tab
          is swapped to "لوحتي" → /driver for them). 'both' users use
          this often (passenger bookings are routine); pure drivers
          use it rarely (occasional booking) but still need access.
          Copy differs:
            both        → "عرض حجوزاتي كراكب" (passenger view by default)
            pure driver → "عرض حجوزاتي السابقة" (whatever they have)
          Pure passengers don't see this chip — they don't visit /driver. */}
      {(user?.account_type === "both" || user?.account_type === "driver") && (
        <Link
          to={user?.account_type === "both" ? "/my-trips?role=passenger" : "/my-trips"}
          className="mb-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 active:bg-amber-200 transition-colors text-xs font-bold text-amber-900 min-h-[44px]"
        >
          <span aria-hidden="true">🧳</span>
          <span>
            {user?.account_type === "both" ? "عرض حجوزاتي كراكب ←" : "عرض رحلاتي السابقة ←"}
          </span>
        </Link>
      )}

      {/* ── Stats grid: 2×2 on mobile, 4 columns on lg ── */}
      <DriverStats
        totalEarnings={totalEarnings}
        totalPassengers={totalPassengers}
        activeTrips={activeTrips}
        completedTrips={completedTrips}
      />

      {/* ── Mobile: dropdown selector ── */}
      <MobileTabSelector tabs={TABS} active={activeTab} onChange={handleTabChange} />

      {/* ── Desktop: horizontal tab bar ── */}
      <DesktopTabBar tabs={TABS} active={activeTab} onChange={handleTabChange} />

      {/* ── Content ── */}
      <div>
        {activeTab === "trips" && (
          <DriverTripsList
            trips={trips}
            bookings={bookings}
            loading={tripsLoading}
            driverUser={user}
            onSelectTrip={(id) => { setSelectedTripId(id); setActiveTab("passengers"); }}
          />
        )}

        {activeTab === "passengers" && (
          <DriverPassengers
            trips={trips}
            bookings={bookings}
            selectedTripId={selectedTripId}
            onSelectTrip={setSelectedTripId}
          />
        )}

        {activeTab === "earnings" && (
          <EarningsTab bookings={bookings} trips={trips} totalEarnings={totalEarnings} pendingEarnings={pendingEarnings} />
        )}

        {activeTab === "my-ratings" && (
          <DriverRatingsDashboard user={user} />
        )}

        {activeTab === "rate-passengers" && (
          <DriverRatePassengers trips={trips} bookings={bookings} />
        )}

        {activeTab === "vehicle" && (
          <DriverVehicleEditor user={user} />
        )}

        {activeTab === "payments" && (
          <div className="bg-card rounded-2xl border border-border p-5">
            <h3 className="font-bold text-foreground mb-1">طرق استلام المدفوعات</h3>
            <p className="text-sm text-muted-foreground mb-4">أضف بياناتك لاستلام مدفوعات الرحلات من الركاب</p>
            <DriverPaymentSetup user={user} />
          </div>
        )}

        {activeTab === "subscription" && (
          <DriverSubscriptionSection user={user} />
        )}
      </div>
    </div>
  );
}
