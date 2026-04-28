import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { motion } from "framer-motion";

export default function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden" style={{ minHeight: "420px" }}>
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="https://media.base44.com/images/public/69eff402dbb517e4d7d3c1cf/5dc1160bb_generated_image.png"
          alt=""
          className="w-full h-full object-cover object-center"
        />
        {/* subtle dark gradient left-to-right so text is readable on the right */}
        <div className="absolute inset-0 bg-gradient-to-l from-black/65 via-black/30 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative w-full max-w-7xl mx-auto px-6 sm:px-10 flex items-center" style={{ minHeight: "420px" }}>
        {/* Right-aligned text block */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55 }}
          className="mr-auto ml-0 max-w-md text-right py-16"
        >
          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-black text-white leading-tight mb-3">
            سيرتنا..<br />
            <span className="text-white">شارك الطريق، وفر أكثر</span>
          </h1>

          {/* Sub-text */}
          <p className="text-white/80 text-base mb-8 leading-relaxed">
            منصة مشاركة للرحلات تربط بين السائقين
            <br />
            والركاب المتجهين لنفس الوجهة في جميع
            <br />
            أنحاء فلسطين.
          </p>

          {/* Buttons */}
          <div className="flex flex-wrap items-center gap-3 justify-end">
            <Button
              onClick={() => navigate("/search")}
              className="h-12 px-7 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-bold gap-2 text-base"
            >
              <Search className="w-4 h-4" />
              ابحث عن رحلة
            </Button>
            <Button
              onClick={() => navigate("/search")}
              variant="outline"
              className="h-12 px-7 bg-white/10 hover:bg-white/20 border-white text-white rounded-xl font-bold text-base backdrop-blur-sm"
            >
              عرض الرحلات
            </Button>
          </div>

          {/* Social proof */}
          <div className="flex items-center gap-3 mt-8 justify-end">
            <span className="text-white/80 text-sm font-medium">+10K مستخدم يثقون بنا</span>
            <div className="flex -space-x-2 rtl:space-x-reverse">
              {[
                "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=40&h=40&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=40&h=40&fit=crop&crop=face",
                "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=40&h=40&fit=crop&crop=face",
              ].map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="w-8 h-8 rounded-full border-2 border-white object-cover"
                />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}