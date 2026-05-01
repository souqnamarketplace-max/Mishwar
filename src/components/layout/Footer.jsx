import React from "react";
import { Link } from "react-router-dom";
import { Mail, Phone, MapPin } from "lucide-react";

const quickLinks = [
  { label: "الرئيسية",       path: "/" },
  { label: "البحث عن رحلة", path: "/search" },
  { label: "أنشر رحلة",     path: "/create-trip" },
  { label: "كيف تعمل؟",    path: "/how-it-works" },
  { label: "المجتمع",       path: "/community" },
  { label: "المفضلة",       path: "/favorites" },
];

const supportLinks = [
  { label: "من نحن",           path: "/about" },
  { label: "المساعدة والدعم",  path: "/help" },
  { label: "الأمان والسلامة",  path: "/safety" },
  { label: "سياسة الخصوصية",  path: "/privacy" },
  { label: "شروط الاستخدام",  path: "/terms" },
  { label: "اقتراحات وشكاوى", path: "/feedback" },
];

export default function Footer() {
  return (
    <footer className="bg-primary text-primary-foreground" dir="rtl">

      {/* Emergency Bar */}
      <div className="bg-red-800/70 px-4 py-2.5 text-center text-sm">
        <span>🆘 طوارئ أو إساءة؟ </span>
        <a href="tel:+970599000000" className="font-bold underline hover:opacity-80 mr-1">
          اتصل: 0599-000-000
        </a>
      </div>

      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-10">

          {/* Col 1 — Brand */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <img src="/logo.png" alt="مشوارو" className="h-14 w-14 rounded-2xl object-cover shadow-lg shrink-0" />
              <div>
                <h2 className="text-xl font-black">مشوارو</h2>
                <p className="text-xs text-primary-foreground/60">🇵🇸 منصة فلسطينية</p>
              </div>
            </div>
            <p className="text-sm text-primary-foreground/70 mb-5 leading-relaxed">
              منصة فلسطينية تربط السائقين بالمسافرين — رحلتك أسهل، أوفر، وأسرع.
            </p>
            {/* App Badges */}
            <div className="space-y-2">
              <div className="flex items-center gap-3 bg-white/10 hover:bg-white/15 transition-colors rounded-xl px-3 py-2 cursor-pointer">
                <span className="text-2xl">🍎</span>
                <div>
                  <p className="text-[10px] text-primary-foreground/50">قريباً على</p>
                  <p className="text-sm font-bold">App Store</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-white/10 hover:bg-white/15 transition-colors rounded-xl px-3 py-2 cursor-pointer">
                <span className="text-2xl">🤖</span>
                <div>
                  <p className="text-[10px] text-primary-foreground/50">قريباً على</p>
                  <p className="text-sm font-bold">Google Play</p>
                </div>
              </div>
            </div>
          </div>

          {/* Col 2 — Quick Links */}
          <div>
            <h3 className="font-bold text-base mb-4 text-primary-foreground/90 border-b border-white/10 pb-2">
              روابط سريعة
            </h3>
            <ul className="space-y-2.5">
              {quickLinks.map((l) => (
                <li key={l.path}>
                  <Link to={l.path}
                    className="text-sm text-primary-foreground/65 hover:text-primary-foreground transition-colors flex items-center gap-1.5 group">
                    <span className="w-1 h-1 rounded-full bg-accent group-hover:w-2 transition-all" />
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3 — Support */}
          <div>
            <h3 className="font-bold text-base mb-4 text-primary-foreground/90 border-b border-white/10 pb-2">
              الدعم والمعلومات
            </h3>
            <ul className="space-y-2.5">
              {supportLinks.map((l) => (
                <li key={l.path}>
                  <Link to={l.path}
                    className="text-sm text-primary-foreground/65 hover:text-primary-foreground transition-colors flex items-center gap-1.5 group">
                    <span className="w-1 h-1 rounded-full bg-accent group-hover:w-2 transition-all" />
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 4 — Contact */}
          <div>
            <h3 className="font-bold text-base mb-4 text-primary-foreground/90 border-b border-white/10 pb-2">
              تواصل معنا
            </h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Mail className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <p className="text-xs text-primary-foreground/50 mb-0.5">البريد الإلكتروني</p>
                  <a href="mailto:support@mishwaro.com"
                    className="text-sm text-primary-foreground/75 hover:text-primary-foreground transition-colors">
                    support@mishwaro.com
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <p className="text-xs text-primary-foreground/50 mb-0.5">هاتف الدعم</p>
                  <a href="tel:+970599000000"
                    className="text-sm text-primary-foreground/75 hover:text-primary-foreground transition-colors">
                    0599-000-000
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <p className="text-xs text-primary-foreground/50 mb-0.5">المقر</p>
                  <p className="text-sm text-primary-foreground/75">رام الله، فلسطين 🇵🇸</p>
                </div>
              </div>
              <div className="mt-4 p-3 bg-white/5 rounded-xl border border-white/10">
                <p className="text-xs text-primary-foreground/60 leading-relaxed">
                  📖 <strong>قصتنا:</strong> وُلدنا من فكرة بسيطة — لماذا لا نشارك الطريق ونوفر معاً؟ منصة تربط أبناء الشعب الواحد.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/15 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-primary-foreground/40">
          <p>© {new Date().getFullYear()} مشوارو — جميع الحقوق محفوظة 🇵🇸</p>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-primary-foreground/80 transition-colors">سياسة الخصوصية</Link>
            <Link to="/terms"   className="hover:text-primary-foreground/80 transition-colors">شروط الاستخدام</Link>
            <Link to="/about"   className="hover:text-primary-foreground/80 transition-colors">عن مشوارو</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
