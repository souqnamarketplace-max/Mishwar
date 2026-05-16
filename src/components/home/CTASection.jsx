import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Search, Car, Plus } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export default function CTASection() {
  const { user } = useAuth();
  // Drivers and "both" accounts post trips; everyone else (passengers and
  // anonymous visitors) requests them. The previous version hard-coded
  // "أنشر رحلتك" for everyone — passengers and visitors clicking the
  // bottom-CTA landed on /create-trip, which is a driver-only page.
  // Pattern matches the role detection used in RequestsTeaser.jsx and
  // the navbar primary CTA.
  const isDriver = user?.account_type === "driver" || user?.account_type === "both";

  return (
    <section className="py-14 md:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="relative rounded-3xl overflow-hidden bg-primary">
          {/* BG pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-white -translate-y-1/2 translate-x-1/4" />
            <div className="absolute bottom-0 left-0 w-60 h-60 rounded-full bg-white translate-y-1/2 -translate-x-1/4" />
          </div>

          <div className="relative px-6 py-14 md:py-16 text-center">
            <div className="text-5xl mb-4">🇵🇸</div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">
              رحلتك القادمة تنتظرك!
            </h2>
            <p className="text-white/80 max-w-md mx-auto mb-3 text-base">
              شارك الطريق مع جيرانك — وفّر المال، وفّر البيئة، وصِل بأمان.
            </p>
            <p className="text-white/60 text-sm mb-8">
              حجز في أقل من دقيقة — بدون رسوم مخفية
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <Link to="/search">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 rounded-xl px-8 gap-2 font-bold text-base h-12">
                  <Search className="w-4 h-4" />
                  احجز رحلة الآن
                </Button>
              </Link>
              {isDriver ? (
                <Link to="/create-trip">
                  <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10 rounded-xl px-8 gap-2 font-bold text-base h-12 bg-white/5">
                    <Car className="w-4 h-4" />
                    أنشر رحلتك
                  </Button>
                </Link>
              ) : (
                <Link to="/request-trip">
                  <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10 rounded-xl px-8 gap-2 font-bold text-base h-12 bg-white/5">
                    <Plus className="w-4 h-4" />
                    اطلب رحلتك
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
