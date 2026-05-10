import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import { Inbox, ArrowLeft, Sparkles } from "lucide-react";

/**
 * RequestsTeaser — homepage band that surfaces the trip-requests
 * feature with a role-aware CTA:
 *   - Passenger / not-yet-logged-in → "اطلب رحلتك"        → /request-trip
 *   - Driver (subscribed)           → "تصفّح طلبات الركاب" → /passenger-requests
 *   - Driver (not subscribed)       → "تصفّح طلبات الركاب" → /passenger-requests
 *     (gate page persuades them to subscribe)
 *
 * The live "X طلب نشط" count uses public_open_requests_count which is
 * SECURITY DEFINER, so it works for everyone (no subscription needed
 * for the aggregate badge — only for accessing individual rows).
 *
 * Always rendered. Empty-state copy is role-specific so a brand-new
 * deployment (zero requests) still shows the teaser to drivers as a
 * discovery surface for /passenger-requests.
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

  // Visibility rules:
  //   - Passenger / not-yet-logged-in: ALWAYS show. They need a discovery
  //     path to /request-trip even when no other passenger has posted yet.
  //     Empty state encourages them to "be the first" by posting.
  //   - Driver: ALSO always show. The previous rule hid the teaser when
  //     openCount === 0 because an empty feed felt deflating, but in
  //     practice this meant brand-new deployments (or any moment between
  //     requests being claimed and new ones being posted) silently lost
  //     the only home-page surface to /passenger-requests for drivers —
  //     audit kept reporting the driver variant "didn't exist". A
  //     dedicated empty-state copy ("be the first to respond") preserves
  //     discoverability without lying about activity.

  const ctaHref  = isDriver ? "/passenger-requests" : "/request-trip";
  const ctaLabel = isDriver ? "تصفّح طلبات الركاب" : "اطلب رحلتك";
  const tagline  = isDriver
    ? (openCount > 0
        ? "ركاب يبحثون عن سائق لمسارك — ميزة حصرية للمشتركين."
        : "كن أول من يردّ على طلبات الركاب على مسارك.")
    : "هل لا تجد رحلة تناسب موعدك؟ انشر طلبك وسيتواصل السائقون معك.";

  // Top-of-card badge text — varies by role and request count
  const badgeText = isDriver
    ? (openCount > 0
        ? `${openCount.toLocaleString("ar-EG")} طلب نشط الآن`
        : "لا توجد طلبات حالياً")
    : openCount > 0
      ? `${openCount.toLocaleString("ar-EG")} طلب نشط الآن`
      : "خدمة جديدة، مجانية للراكب";

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
                {badgeText}
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
