import { useSEO } from "@/hooks/useSEO";
import React from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { CheckCircle, MapPin, Calendar, Clock, Users, Phone, MessageCircle, Download, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BookingConfirmation() {
  useSEO({ title: "تأكيد الحجز", description: "تم تأكيد حجزك بنجاح في مِشوار" });

  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const tripId = searchParams.get("trip");

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: () => base44.auth.me() });

  const { data: bookings = [] } = useQuery({
    queryKey: ["booking-confirm", id],
    queryFn: () => base44.entities.Booking.filter({ passenger_email: user?.email }, "-created_date", 5),
    enabled: !!user?.email,
  });

  const { data: trips = [] } = useQuery({
    queryKey: ["trip-confirm", tripId],
    queryFn: () => base44.entities.Trip.list("-created_date", 100),
    enabled: !!tripId,
  });

  const booking = bookings[0];
  const trip = trips.find(t => t.id === tripId) || trips[0];

  const refNum = booking?.id?.slice(-8).toUpperCase() || "--------";

  const whatsappMsg = trip
    ? `مرحباً، أنا ${user?.full_name || ""}. قمت بحجز ${booking?.seats_booked || 1} مقعد في رحلتك من ${trip.from_city} إلى ${trip.to_city} بتاريخ ${trip.date} الساعة ${trip.time}. رقم الحجز: #${refNum}`
    : "";

  return (
    <div className="max-w-lg mx-auto px-4 py-12" dir="rtl">
      {/* Success Icon */}
      <div className="text-center mb-8">
        <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4 animate-bounce">
          <CheckCircle className="w-10 h-10 text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">تم الحجز بنجاح! 🎉</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          سيتم إشعارك عند تأكيد السائق للحجز
        </p>
        <div className="inline-block mt-3 bg-muted px-4 py-1.5 rounded-full text-sm font-mono font-bold text-foreground">
          #{refNum}
        </div>
      </div>

      {/* Trip Details Card */}
      {trip && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden mb-4">
          <div className="bg-primary p-4 text-primary-foreground">
            <div className="flex items-center gap-2 text-lg font-bold">
              <MapPin className="w-5 h-5" />
              <span>{trip.from_city}</span>
              <ArrowLeft className="w-4 h-4" />
              <span>{trip.to_city}</span>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4 text-primary" />
                <span>{trip.date}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4 text-primary" />
                <span>{trip.time}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="w-4 h-4 text-primary" />
                <span>{booking?.seats_booked || 1} مقعد محجوز</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-primary">₪{booking?.total_price || trip.price}</span>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-xs text-muted-foreground mb-1">السائق</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                  {trip.driver_name?.[0] || "س"}
                </div>
                <div>
                  <p className="font-medium text-sm">{trip.driver_name}</p>
                  <p className="text-xs text-muted-foreground">{trip.car_model} • {trip.car_color}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-xs text-muted-foreground mb-2">💳 طريقة الدفع</p>
              <p className="text-sm font-medium">{booking?.payment_method || "نقداً"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {booking?.payment_method === "نقداً" || booking?.payment_method === "cash"
                  ? "⚠️ يرجى تجهيز المبلغ نقداً ودفعه للسائق عند الصعود"
                  : "سيتم التواصل معك لتفاصيل الدفع"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {trip?.driver_phone && (
          <a
            href={`https://wa.me/970${trip.driver_phone.replace(/\D/g, '')}?text=${encodeURIComponent(whatsappMsg)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button className="w-full bg-green-500 hover:bg-green-600 text-white rounded-xl gap-2 h-12">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
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

      {/* Important Note */}
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
