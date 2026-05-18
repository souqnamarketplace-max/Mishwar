import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Star, Clock, Users, AlertCircle, Share2, Zap, Timer, Heart, UserPlus, UserCheck } from "lucide-react";
import { isLastChance, isBookingClosed, minutesUntilTrip } from "@/lib/tripScheduling";
import { api } from "@/api/apiClient";
import { useFavorite } from "@/lib/favorites";
import { useIsFavoriteDriver } from "@/lib/favoriteDrivers";
import { formatRelativeDate as fmt } from "@/lib/relativeDate";

// ── Palestinian date formatter ────────────────────────────────────────────────
// Implementation moved to @/lib/relativeDate (formatRelativeDate) so the
// same logic can be reused by MyTrips, RecurringTrips, and any future
// surface that needs the "today / tomorrow / weekday" rendering. The
// `fmt` alias above keeps the in-file references unchanged — zero risk
// of regression in TripCard's call-sites.

// ── Share ─────────────────────────────────────────────────────────────────────
// We pass ONLY { title, url } to navigator.share — no `text` field.
// Reason: when shares are forwarded multiple times (chat → chat → browser),
// some platforms concatenate text+url into a single blob and the user
// ends up pasting "https://.../trip/<uuid> رحلة من ..." into the address
// bar, which makes the trip ID unparseable. With url-only, WhatsApp /
// Telegram / Twitter generate the rich preview card from OG meta tags
// (served by /api/trip), which is actually a better-looking preview
// than a hand-written text line anyway.
function share(e, id) {
  e.preventDefault(); e.stopPropagation();
  const url = `${window.location.origin}/trip/${id}`;
  if (navigator.share) {
    navigator.share({ title: "مشوارو", url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(() => import("sonner").then(m => m.toast.success("تم نسخ رابط الرحلة! 📋")))
      .catch(() => {});
  }
}

// ── Modern card — used for both male and female trips ─────────────────────────
function Card({ t, noSeats, urgentSeats }) {
  const isFemale = t.driver_gender === "female";
  const stops    = Array.isArray(t.stops) ? t.stops.filter(s => s.city) : [];
  // Heart-toggle on each card. Same localStorage list TripDetails uses,
  // namespaced per user — see src/lib/favorites.js. Lets passengers
  // save a trip directly from search results / home / any list, without
  // having to open the detail page first. The hook handles e.preventDefault
  // + e.stopPropagation so a heart-tap doesn't bubble up to the wrapping
  // Link and navigate away from the list.
  const [favorited, toggleFavorite] = useFavorite(t.id);
  // Separately: favorite-DRIVER (not trip). Stored server-side because
  // SearchTrips uses the list to do an .in('driver_email', favs) filter
  // for the "only my favorite drivers" toggle. The icon (UserCheck vs
  // UserPlus) visually distinguishes this from the trip-heart so users
  // don't confuse the two affordances.
  const [driverFavorited, toggleDriverFavorite] = useIsFavoriteDriver(t.driver_email);

  // Theme colours
  const theme = isFemale
    ? { bar: "bg-gradient-to-b from-rose-400 to-fuchsia-400", border: "border-rose-200",
        priceText: "text-rose-600", priceBg: "bg-rose-50",
        seatBg: "bg-rose-50 text-rose-600", line: "bg-rose-200",
        dot: "bg-rose-400", dotEmpty: "border-rose-400",
        badge: "bg-rose-100 text-rose-700" }
    : noSeats
    ? { bar: "bg-destructive/50", border: "border-border",
        priceText: "text-destructive", priceBg: "bg-destructive/5",
        seatBg: "bg-destructive/8 text-destructive", line: "bg-border",
        dot: "bg-muted-foreground/30", dotEmpty: "border-muted-foreground/30",
        badge: "" }
    : urgentSeats
    ? { bar: "bg-gradient-to-b from-amber-400 to-orange-400", border: "border-amber-200/60",
        priceText: "text-amber-700", priceBg: "bg-amber-50",
        seatBg: "bg-amber-50 text-amber-700", line: "bg-amber-200",
        dot: "bg-amber-500", dotEmpty: "border-amber-500",
        badge: "bg-amber-100 text-amber-700" }
    : { bar: "bg-gradient-to-b from-primary to-accent", border: "border-border",
        priceText: "text-primary", priceBg: "bg-primary/8",
        seatBg: "bg-primary/8 text-primary", line: "bg-primary/15",
        dot: "bg-primary", dotEmpty: "border-primary",
        badge: "bg-primary/8 text-primary" };

  return (
    <div className={`relative bg-card rounded-2xl border ${theme.border} overflow-hidden shadow-sm active:scale-[0.985] transition-transform duration-150`}>

      {/* Left accent bar */}
      <div className={`absolute right-0 top-0 bottom-0 w-1.5 rounded-r-2xl ${theme.bar}`} />

      <div className="pr-4 pl-3 pt-3 pb-3">

        {/* ── Badge row — inline, never overlapping ── */}
        {(urgentSeats || isFemale || isLastChance(t) || isBookingClosed(t)) && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {isFemale && (
              <span className="text-[10px] font-bold bg-rose-500 text-white px-2 py-0.5 rounded-full">
                سائقة 🌸
              </span>
            )}
            {urgentSeats && !noSeats && (
              <span className="flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                <Zap className="w-2.5 h-2.5" />{t.available_seats} مقعد فقط!
              </span>
            )}
            {isBookingClosed(t) ? (
              <span className="flex items-center gap-1 bg-destructive text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                🔒 أُغلق الحجز
              </span>
            ) : isLastChance(t) && (() => {
              const mins = minutesUntilTrip(t);
              const label = mins >= 60
                ? `آخر ${Math.floor(mins / 60)} ساعة للحجز ⏰`
                : `آخر ${mins} دقيقة للحجز ⏰`;
              return (
                <span className="flex items-center gap-1 bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                  <Timer className="w-2.5 h-2.5" />{label}
                </span>
              );
            })()}
          </div>
        )}

        {/* ── Route + Price row ── */}
        <div className="flex items-start justify-between gap-2 mb-2.5">

          {/* Route */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              {/* FROM dot */}
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${theme.dot}`} />

              {/* Line + middle stops */}
              <div className={`flex-1 h-px ${theme.line} relative`}>
                {stops.length > 0 && (
                  <div className="absolute inset-y-0 top-1/2 -translate-y-1/2 left-0 right-0 flex justify-evenly">
                    {stops.slice(0, 3).map((_, i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-yellow-500 border border-white ring-1 ring-yellow-300" />
                    ))}
                  </div>
                )}
              </div>

              {/* TO dot */}
              <div className={`w-2.5 h-2.5 rounded-full border-2 bg-card shrink-0 ${theme.dotEmpty}`} />
            </div>

            {/* City names */}
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-black text-foreground leading-tight truncate">{t.from_city}</span>
              <span className="text-muted-foreground text-xs shrink-0">←</span>
              <span className="text-base font-black text-foreground leading-tight truncate">{t.to_city}</span>
            </div>

            {/* Stops hint */}
            {stops.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                عبر: {stops.map(s => s.city).join(" • ")}
              </p>
            )}
          </div>

          {/* Price chip */}
          <div className={`shrink-0 text-center rounded-xl px-2.5 py-1.5 ${theme.priceBg}`}>
            <p className={`text-xl font-black leading-none ${theme.priceText}`}>₪{t.price}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">للمقعد</p>
          </div>
        </div>

        {/* ── Info chips: date · time · distance ── */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <span className="flex items-center gap-1 bg-muted/60 rounded-full px-2.5 py-1 text-[11px] font-medium text-foreground">
            📅 {fmt(t.date)}
          </span>
          <span className="flex items-center gap-1 bg-muted/60 rounded-full px-2.5 py-1 text-[11px] font-medium text-foreground">
            <Clock className="w-3 h-3" /> {t.time}
          </span>
          {t.distance && (
            <span className="bg-muted/60 rounded-full px-2.5 py-1 text-[11px] text-muted-foreground">
              {t.distance}
            </span>
          )}
          {t.has_checkpoint && (
            <span className="bg-orange-100 text-orange-700 rounded-full px-2.5 py-1 text-[10px] font-medium">
              ⚠️ حاجز
            </span>
          )}
        </div>

        {/* ── Divider ── */}
        <div className="border-t border-border/50 mb-2.5" />

        {/* ── Driver row ── */}
        <div className="flex items-center gap-2">

          {/* Avatar */}
          <div className={`w-9 h-9 rounded-full overflow-hidden shrink-0 ${isFemale ? "ring-2 ring-rose-300" : "ring-1 ring-border"}`}>
            {t.driver_avatar
              ? <img loading="lazy" src={t.driver_avatar} alt="" className="w-full h-full object-cover" />
              : <div className={`w-full h-full flex items-center justify-center text-sm font-bold ${isFemale ? "bg-rose-100 text-rose-600" : "bg-primary/10 text-primary"}`}>
                  {(t.driver_name || "س")[0]}
                </div>
            }
          </div>

          {/* Driver info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground leading-tight truncate">
                {t.driver_name || "سائق"}
              </p>
              {/* Driver-favorite chip — small icon next to the name so
                  it's visually anchored to "this driver" rather than
                  "this trip" (which is the role the trip-heart on the
                  right plays). Tap toggles via Supabase. Hidden when
                  driver_email is missing (anonymous legacy rows).
                  Hidden also when this is a female-driver card the user
                  shouldn't be free to "save" if they're male; the
                  gender preference matching is handled higher up by
                  the existing block list / gender filter, so we don't
                  duplicate it here. */}
              {t.driver_email && (
                <button
                  onClick={toggleDriverFavorite}
                  aria-label={driverFavorited ? "إلغاء تفضيل السائق" : "إضافة السائق للمفضلة"}
                  title={driverFavorited ? "سائق مفضل — اضغط للإلغاء" : "أضف السائق للمفضلة"}
                  // Visual circle stays small to fit the driver name row,
                  // but the BUTTON itself is 44px square (Apple HIG / WCAG
                  // 2.5.5 'Target Size' minimum) with the visible icon
                  // centered. -my-2.5 negates the extra padding so the
                  // row height doesn't grow — the touch surface extends
                  // INTO the gap above and below the visible chip without
                  // shifting layout. Same pattern as iOS native nav
                  // buttons where the visible glyph is small but the
                  // hit area is generous.
                  className={`shrink-0 inline-flex items-center justify-center w-11 h-11 -my-2.5 rounded-full transition-colors ${
                    driverFavorited
                      ? "text-rose-500 hover:bg-rose-500/10 active:bg-rose-500/20"
                      : "text-muted-foreground/60 hover:text-rose-500 hover:bg-rose-500/8 active:bg-rose-500/15"
                  }`}
                >
                  {/* Visible chip — explicit background ring so the user
                      perceives it as a clear affordance even though the
                      actual hit area is much larger. */}
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${
                    driverFavorited ? "bg-rose-500/10" : "bg-muted/40"
                  }`}>
                    {driverFavorited
                      ? <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      : <UserPlus  className="w-3.5 h-3.5" aria-hidden="true" />}
                  </span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {t.driver_rating > 0 ? (
                <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  {Number(t.driver_rating).toFixed(1)}
                </span>
              ) : (
                <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded-full font-medium">جديد ✨</span>
              )}
              {t.car_model && (
                <span className="text-[11px] text-muted-foreground truncate">• {t.car_model}</span>
              )}
            </div>
          </div>

          {/* Seats badge */}
          <div className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${theme.seatBg}`}>
            {noSeats
              ? <><AlertCircle className="w-3 h-3" /> مكتملة</>
              : <><Users className="w-3 h-3" /> {t.available_seats}</>
            }
          </div>

          {/* Favorite — heart icon, persisted to localStorage via useFavorite */}
          <button
            onClick={toggleFavorite}
            aria-label={favorited ? "إزالة من المفضلة" : "إضافة للمفضلة"}
            className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-xl transition-colors ${
              favorited
                ? "text-rose-500 hover:bg-rose-500/10 active:bg-rose-500/20"
                : "text-muted-foreground hover:text-rose-500 hover:bg-rose-500/8 active:bg-rose-500/15"
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorited ? "fill-rose-500" : ""}`} />
          </button>

          {/* Share */}
          <button
            onClick={(e) => share(e, t.id)}
            aria-label="مشاركة الرحلة"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/8 active:bg-primary/15 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Car image strip (if available) */}
        {t.car_image && (
          <div className="mt-2.5 -mx-3 -mb-3 h-16 relative overflow-hidden rounded-b-2xl">
            <img loading="lazy" decoding="async" src={t.car_image} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            <div className="absolute bottom-1.5 right-3 text-white text-[10px] font-medium opacity-90">
              {t.car_model}{t.car_color ? ` • ${t.car_color}` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function TripCard({ trip }) {
  const [liveTrip, setLiveTrip] = useState(trip);

  useEffect(() => {
    if (!trip?.id) return;
    const unsub = api.entities.Trip.subscribe((payload) => {
      if (payload?.new?.id === trip.id) setLiveTrip(payload.new);
    });
    return unsub;
  }, [trip?.id]);

  const t         = liveTrip || trip;
  const seatsLeft = t.available_seats || 0;

  return (
    <Link to={`/trip/${t.id}`} className="block">
      <Card t={t} noSeats={seatsLeft === 0} urgentSeats={seatsLeft > 0 && seatsLeft <= 2} />
    </Link>
  );
}
