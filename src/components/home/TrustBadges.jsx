import React from "react";
import { Shield, Users, X, Headphones } from "lucide-react";

const badges = [
  { icon: Shield, title: "دفع آمن", desc: "جميع عمليات الدفع وبياناتك المالية محمية بالكامل" },
  { icon: Users, title: "سائقون موثوقون", desc: "نتحقق من هوياتهم ووثائقهم وتقييماتهم قبل الانضمام" },
  { icon: X, title: "إلغاء مرن", desc: "يمكنك إلغاء حجزك سهولة وفق سياسة الإلغاء المحددة" },
  { icon: Headphones, title: "دعم 24/24", desc: "فريق خدمة العملاء متوفر في أي وقت لمساعدتك" },
];

export default function TrustBadges() {
  return (
    <section className="py-10 bg-background border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {badges.map((b) => (
            <div key={b.title} className="flex items-start gap-3 p-4 rounded-2xl hover:bg-muted/50 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <b.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">{b.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}