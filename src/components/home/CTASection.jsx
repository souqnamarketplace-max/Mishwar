import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function CTASection() {
  return (
    <section className="py-16 md:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="relative rounded-3xl overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=1600&fit=crop"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-primary/75" />
          <div className="relative px-6 py-16 md:py-20 text-center">
            <div className="text-5xl mb-4">🇵🇸</div>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              جاهز لحجز رحلتك القادمة ؟
            </h2>
            <p className="text-white/85 max-w-lg mx-auto mb-8">
              انضم إلى آلاف الركاب الذين يثقون بسيرتنا كل يوم
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <Link to="/search">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 rounded-xl px-8 gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  ابحث عن رحلة الآن
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}