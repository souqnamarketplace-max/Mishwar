import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { supabase } from "@/lib/supabase";
import { CheckCircle, MapPin, Calendar, Clock, Users, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

function paymentLabel(m) {
  if (m === "bank_transfer") return "🏦 تحويل بنكي";
  if (m === "reflect")       return "💜 Reflect";
  if (m === "jawwal_pay")    return "📱 Jawwal Pay";
  if (m === "card")          return "💳 بطاقة";
  return "💵 نقداً";
}

export default function BookingConfirmation() {
  useSEO({ title: "تأكيد الحجز", description: "تم تأكيد حجزك بنجاح في مشوارو" });
  const [searchParams] = useSearchParams();
  const tripId = searchParams.get("trip");

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => api.auth.me() });

  const { data: bookings = [] } = useQuery({
    queryKey: ["booking-confirm", tripId, user?.email],
    queryFn: () => user?.email && tripId
      // Filter by trip_id so the page shows the booking on THIS trip
      // rather than whichever booking happened to be most recent
      // for this user. Previously a passenger who booked Trip A
      // then opened /booking-confirmation?trip=B (e.g. by clicking
      // an old notification link) would see Trip A's booking ref
      // number and seat count rendered against Trip B's route.
      // Filter to {trip_id, passenger_email} for an exact match.
      ? api.entities.Booking.filter({ trip_id: tripId, passenger_email: user.email }, "-created_date", 1)
      : [],
    enabled: !!user?.email && !!tripId,
  });

  const { data: trip } = useQuery({
    queryKey: ["trip-confirm", tripId],
    // Direct lookup. The previous code did Trip.list("-created_date",
    // 100) then array.find(t => t.id === tripId) || trips[0]. Two real
    // problems with that:
    //   (a) Fetched up to 100 trips to find one — wasteful and slow.
    //   (b) The `|| trips[0]` fallback was actively dangerous. If the
    //       requested trip wasn't in the latest 100 (older trip a
    //       passenger booked weeks ago, then revisited the
    //       confirmation page), the page silently rendered an
    //       UNRELATED trip's route, driver, car, and payment
    //       details against this passenger's booking. They could
    //       end up reading payment instructions for the wrong
    //       driver — including a wrong bank account number to
    //       transfer to.
    // .get() returns the single trip or null. Null falls through to
    // the existing \"جاري تحميل تفاصيل الحجز...\" empty state, which
    // is the correct behaviour: better to show \"loading\" than the
    // wrong trip.
    queryFn: () => tripId ? api.entities.Trip.get(tripId) : null,
    enabled: !!tripId,
  });

  const booking = bookings[0];

  // Fetch the driver's payment info via the get_driver_payment_info RPC
  // (migration 006). The RPC enforces authorization server-side: only
  // returns rows if the caller is the driver themselves, the passenger
  // has a confirmed booking on this trip, or the caller is admin.
  // Otherwise returns empty — the UI falls through to the "contact
  // driver for details" fallback message that was already there.
  const { data: dpRows = [] } = useQuery({
    queryKey: ["driver-payment-info", trip?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_driver_payment_info", {
        p_trip_id: trip.id,
      });
      if (error) {
        // RPC not deployed yet (migration 006 not applied) → empty rows,
        // existing fallback "تواصل مع السائق" UI handles this.
        return [];
      }
      return Array.isArray(data) ? data : [];
    },
    enabled: !!trip?.id,
  });
  const dp = dpRows[0]; // driver payment info — null if not authorized

  const refNum      = (booking?.id || "").slice(-8).toUpperCase() || "--------";
  const method      = booking?.payment_method || "cash";
  const amount      = booking?.total_price || trip?.price || 0;

  if (!trip || !booking) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">جاري تحميل تفاصيل الحجز...</p>
        <Link to="/my-trips" className="mt-4 block">
          <Button variant="outline" className="rounded-xl gap-2">
            <MapPin className="w-4 h-4" />
            عرض رحلاتي
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8" dir="rtl">
      {/* Success header */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-9 h-9 text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">تم الحجز بنجاح! 🎉</h1>
        <p className="text-sm text-muted-foreground mt-1">رقم الحجز: <span className="font-mono font-bold text-foreground">#{refNum}</span></p>
      </div>

      {/* Trip summary card */}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-4 mb-4">
        {/* Route */}
        <div className="flex items-center justify-between">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">من</p>
            <p className="font-bold text-foreground">{trip.from_city}</p>
          </div>
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">إلى</p>
            <p className="font-bold text-foreground">{trip.to_city}</p>
          </div>
        </div>

        {/* Details row */}
        <div className="flex items-center justify-between text-sm border-t border-border pt-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />{trip.date}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />{trip.time}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="w-3.5 h-3.5" />{booking.seats_booked} مقاعد
          </span>
        </div>

        {/* Driver + Car */}
        <div className="flex items-center gap-3 border-t border-border pt-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0">
            {(trip.driver_name || "س")[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{trip.driver_name}</p>
            <p className="text-xs text-muted-foreground">{trip.car_model}{trip.car_color ? ` · ${trip.car_color}` : ""}</p>
          </div>
          {/* Car photo (right side) — shows passengers what vehicle to
              look for at pickup. Renders only when set. */}
          {trip.car_image && (
            <div className="w-14 h-10 rounded-lg overflow-hidden bg-muted shrink-0 ring-1 ring-border/40">
              <img
                loading="lazy"
                decoding="async"
                src={trip.car_image}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="text-left shrink-0">
            <p className="text-xl font-black text-primary">₪{amount}</p>
            <p className="text-xs text-muted-foreground">المجموع</p>
          </div>
        </div>
      </div>

      {/* Payment instructions */}
      <div className="bg-card rounded-2xl border border-border p-5 mb-4 space-y-3">
        <p className="text-sm font-bold text-foreground">💳 تعليمات الدفع</p>
        <p className="text-sm text-muted-foreground">{paymentLabel(method)}</p>

        {(method === "cash" || method === "card") && (
          <div className="p-3 bg-green-500/10 rounded-xl border border-green-500/20">
            <p className="text-xs text-green-800">
              {method === "cash"
                ? "ادفع للسائق نقداً عند نهاية الرحلة. المبلغ: ₪" + amount
                : "ادفع للسائق ببطاقتك بالاتفاق معه. المبلغ: ₪" + amount}
            </p>
          </div>
        )}

        {method === "bank_transfer" && dp?.bank_account_number && (
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 space-y-1">
            <p className="text-xs font-bold text-blue-800">تفاصيل التحويل البنكي (₪{amount})</p>
            {dp.bank_name && <p className="text-xs text-blue-800">البنك: {dp.bank_name}</p>}
            <p className="text-xs text-blue-800">الحساب: {dp.bank_account_number}</p>
            {dp.bank_iban && <p className="text-xs text-blue-800">IBAN: {dp.bank_iban}</p>}
            {dp.bank_account_name && <p className="text-xs text-blue-800">الاسم: {dp.bank_account_name}</p>}
          </div>
        )}

        {method === "bank_transfer" && !dp?.bank_account_number && (
          <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
            <p className="text-xs text-amber-800">تواصل مع السائق للحصول على بيانات التحويل البنكي (₪{amount})</p>
          </div>
        )}

        {method === "reflect" && (
          <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
            <p className="text-xs font-bold text-purple-800">Reflect — أرسل ₪{amount}</p>
            {dp?.reflect_number
              ? <p className="text-xs text-purple-800 font-mono mt-1">{dp.reflect_number}</p>
              : <p className="text-xs text-purple-800 mt-1">تواصل مع السائق للحصول على رقم Reflect</p>}
          </div>
        )}

        {method === "jawwal_pay" && (
          <div className="p-3 bg-green-600/10 rounded-xl border border-green-600/20">
            <p className="text-xs font-bold text-green-800">Jawwal Pay — أرسل ₪{amount}</p>
            {dp?.jawwal_pay_number
              ? <p className="text-xs text-green-800 font-mono mt-1">{dp.jawwal_pay_number}</p>
              : <p className="text-xs text-green-800 mt-1">تواصل مع السائق للحصول على رقم Jawwal Pay</p>}
          </div>
        )}

        <div className="p-2.5 bg-muted/50 rounded-lg">
          <p className="text-[11px] text-muted-foreground text-center">
            المبلغ يذهب مباشرة للسائق — مشوارو تأخذ عمولتها من السائق
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2">
        
        <Link to="/my-trips">
          <Button variant="outline" className="w-full rounded-xl gap-2 h-11">
            <MapPin className="w-4 h-4" />
            عرض رحلاتي
          </Button>
        </Link>
        <Link to="/search">
          <Button variant="ghost" className="w-full rounded-xl text-muted-foreground h-11">
            البحث عن رحلات أخرى
          </Button>
        </Link>
      </div>

      {/* Reminder */}
      <div className="mt-6 p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
        <p className="text-sm text-yellow-800 font-medium mb-1">⚠️ تذكير مهم</p>
        <ul className="text-xs text-yellow-700 space-y-1 list-disc list-inside">
          <li>كن في نقطة الانطلاق قبل موعد الرحلة بـ 5 دقائق على الأقل</li>
          <li>يمكن إلغاء الحجز النقدي قبل الرحلة بساعتين</li>
          <li>في حال مرور المسار بحاجز، تابع الأخبار قبل الانطلاق</li>
        </ul>
      </div>
    </div>
  );
}
