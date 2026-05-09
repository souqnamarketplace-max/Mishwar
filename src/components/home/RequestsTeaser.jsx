import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { Inbox, ArrowLeft, Sparkles } from "lucide-react";

/**
 * RequestsTeaser — homepage band that surfaces the new trip-requests
 * feature with a role-aware CTA:
 *   - Passenger / not-yet-logged-in → "اطلب رحلتك"  → /request-trip
 *   - Driver (subscribed)           → "تصفّح الطلبات" → /passenger-requests
 *   - Driver (not subscribed)       → "تصفّح الطلبات" → /passenger-requests
 *     (gate page persuades them to subscribe)
 *
 * The live "X طلب نشط" count uses public_open_requests_count which is
 * SECURITY DEFINER, so it works for everyone (no subscription needed
 * for the aggregate badge — only for accessing individual rows).
 *
 * Hidden when there are zero open requests — no point showing an
 * empty-state teaser on a marketing band.
 */
export default function RequestsTeaser() {
  const { user } = useAuth();
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";

  const { data: openCount = 0 } = useQuery({
    queryKey: ["public-open-requests-count"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_open_requests_count");
      if (error) throw error;
      return Number(data || 0);
    },
    staleTime: 60_000,
  });

  if (openCount === 0) return null;

  const ctaHref  = isDriver ? "/passenger-requests" : "/request-trip";
  const ctaLabel = isDriver ? "تصفّح الطلبات" : "اطلب رحلتك";
  const tagline  = isDriver
    ? "ركاب يبحثون عن سائق على مساراتك — ميزة حصرية للمشتركين."
    : "هل لا تجد رحلة تناسب موعدك؟ انشر طلبك وسيتواصل السائقون معك.";

  return (
    <section className="py-8 bg-muted/40" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <Link
          to={ctaHref}
          className="block group bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-2xl p-5 sm:p-6 hover:shadow-xl transition-shadow"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              {isDriver ? (
                <Sparkles className="w-7 h-7" />
              ) : (
                <Inbox className="w-7 h-7" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs opacity-80 mb-1">
                {openCount.toLocaleString("ar-EG")} طلب نشط الآن
              </p>
              <h3 className="text-lg sm:text-xl font-bold mb-1 leading-tight">
                {ctaLabel}
              </h3>
              <p className="text-xs sm:text-sm opacity-90 leading-relaxed">
                {tagline}
              </p>
            </div>
            <ArrowLeft className="w-5 h-5 opacity-70 shrink-0 group-hover:-translate-x-1 transition-transform" />
          </div>
        </Link>
      </div>
    </section>
  );
}
