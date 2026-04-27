import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function CTASection() {
  return (
    <section className="py-16 md:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="relative bg-primary rounded-3xl overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200')] bg-cover bg-center opacity-10" />
          <div className="relative px-6 py-16 md:py-20 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
              جاهز للانطلاق ؟
            </h2>
            <p className="text-primary-foreground/80 max-w-lg mx-auto mb-8">
              انضم إلى مجتمع سيرتنا الآن وابدأ بتوفير المال ومساعدة الآخرين
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <Link to="/search">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 rounded-xl px-8 gap-2">
                  سجل الآن مجاناً
                </Button>
              </Link>
              <Link to="/how-it-works">
                <Button size="lg" variant="outline" className="border-white/30 text-primary-foreground hover:bg-white/10 rounded-xl px-8 gap-2">
                  اعرف المزيد
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}