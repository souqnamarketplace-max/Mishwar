import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { CheckCircle, MapPin, Calendar, Clock, Users, MessageCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

function cleanPhone(p) { return (p || "").split("").filter(c => c >= "0" && c <= "9").join(""); }
function paymentLabel(m) {
  if (m === "bank_transfer") return "🏦 تحويل بنكي";
  if (m === "reflect")       return "💜 Reflect";
  if (m === "jawwal_pay")    return "📱 Jawwal Pay";
  if (m === "card")          return "💳 بطاقة";
  return "💵 نقداً";
}

export default function BookingConfirmation() {
  useSEO({ title: "تأكيد الحجز", description: "تم تأكيد حجزك بنجاح في مِشوار" });
  const [searchParams] = useSearchParams();
  const tripId = searchParams.get("trip");

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => base44.auth.me() });

  const { data: bookings = [] } = useQuery({
    queryKey: ["booking-confirm", tripId, user?.email],
    queryFn: () => base44.entities.Booking.filter({ passenger_email: user?.email }, "-created_date", 5),
    enabled: !!user?.email,
  });

  const { data: trips = [] } = useQuery({
    queryKey: ["trip-confirm", tripId],
    queryFn: () => base44.entities.Trip.list("-created_date", 100),
    enabled: !!tripId,
  });

  const booking = bookings[0];
  const trip    = trips.find(t => t.id === tripId) || trips[0];

  const { data: driverProfiles = [] } = useQuery({
    queryKey: ["driver-payment-info", trip?.driver_email],
    queryFn: () => base44.entities.Profile.filter({ email: trip.driver_email }, "-created_at", 1),
    enabled: !!trip?.driver_email,
  });
  const dp = driverProfiles[0]; // driver profile with payment info

  const refNum      = (booking?.id || "").slice(-8).toUpperCase() || "--------";
  const method      = booking?.payment_method || "cash";
  const amount      = booking?.total_price || trip?.price || 0;
  const waText      = encodeURIComponent(
    user && trip
      ? `مرحباً، أنا ${user.full_name || user.email}. حجزت ${booking?.seats_booked || 1} مقعد في رحلتك من ${trip.from_city} إلى ${trip.to_city} بتاريخ ${trip.date}. رقم الحجز: #${refNum}`
      : "مرحباً"
  );

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

        {/* Driver */}
        <div className="flex items-center gap-3 border-t border-border pt-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
            {(trip.driver_name || "س")[0]}
          </div>
          <div>
            <p className="font-medium text-sm">{trip.driver_name}</p>
            <p className="text-xs text-muted-foreground">{trip.car_model}{trip.car_color ? ` · ${trip.car_color}` : ""}</p>
          </div>
          <div className="mr-auto text-left">
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
            المبلغ يذهب مباشرة للسائق — مِشوار تأخذ عمولتها من السائق
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2">
        {trip.driver_phone && (
          <a href={"https://wa.me/970" + cleanPhone(trip.driver_phone) + "?text=" + waText}
            target="_blank" rel="noopener noreferrer">
            <Button className="w-full bg-green-500 hover:bg-green-600 text-white rounded-xl gap-2 h-11">
              <MessageCircle className="w-4 h-4" />
              تواصل مع السائق عبر واتساب
            </Button>
          </a>
        )}
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
