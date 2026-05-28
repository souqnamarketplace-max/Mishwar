import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { Mail, Phone, MapPin } from "lucide-react";

const quickLinks = [
  { label: "الرئيسية",       path: "/" },
  { label: "البحث عن رحلة", path: "/search" },
  { label: "أنشر رحلة",     path: "/create-trip" },
  { label: "كيف تعمل؟",    path: "/how-it-works" },
  { label: "المجتمع",       path: "/community" },
  { label: "المدونة",       path: "/blog" },
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
  // Pull support contact + brand info from app_settings (same pattern as
  // src/pages/Help.jsx) so an admin can edit these without a deploy.
  // Falls back to neutral generic strings so the section never looks
  // broken on a fresh DB.
  const { data: settingsArr = [] } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => api.entities.AppSettings.list(),
    staleTime: 5 * 60 * 1000, // 5 min — settings change rarely
  });
  const settings = settingsArr[0] || {};
  const supportEmail = settings.support_email || "";
  const supportPhone = settings.support_phone || "";

  return (
    <footer className="bg-primary text-primary-foreground" dir="rtl">

      {/* Emergency Bar — shown only when an admin has actually set a
          support phone in app_settings. Previously this was hardcoded
          to +970599000000 / "0599-000-000" — a placeholder number that
          would either ring nobody or ring whoever happened to own that
          line. Showing fake emergency contact info is worse than not
          showing one. */}
      {supportPhone && (
        <div className="bg-red-800/70 px-4 py-2.5 text-center text-sm">
          <span>🆘 طوارئ أو إساءة؟ </span>
          <a href={`tel:${supportPhone.replace(/\s/g, "")}`} className="font-bold underline hover:opacity-80 mr-1">
            اتصل: {supportPhone}
          </a>
        </div>
      )}

      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-10">

          {/* Col 1 — Brand */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <img src="/logo.png" alt="مشوارو" className="h-14 w-14 rounded-2xl object-cover shadow-lg shrink-0" />
              <div>
                <h2 className="text-xl font-black">مشوارو</h2>
                <p className="text-xs text-primary-foreground/60 flex items-center gap-1">
                  <svg viewBox="0 0 1200 600" className="w-5 h-2.5 rounded-sm inline-block" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="200" fill="#000"/><rect y="200" width="1200" height="200" fill="#fff"/><rect y="400" width="1200" height="200" fill="#007a3d"/><polygon points="0,0 600,300 0,600" fill="#ce1126"/></svg>
                  منصة فلسطينية
                </p>
              </div>
            </div>
            <p className="text-sm text-primary-foreground/70 mb-5 leading-relaxed">
              منصة فلسطينية تربط السائقين بالمسافرين — رحلتك أسهل، أوفر، وأسرع.
            </p>
            {/* App Badges */}
            <div className="space-y-2">
              {/* App Store — live */}
              <a
                href="https://apps.apple.com/dz/app/mishwaro-%D9%85%D8%B4%D9%88%D8%A7%D8%B1%D9%88/id6768105898"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 bg-white/10 hover:bg-white/20 active:bg-white/25 transition-colors rounded-xl px-3 py-2"
              >
                {/* Official Apple logo — single-color (will inherit currentColor) */}
                <svg viewBox="0 0 24 24" className="w-6 h-6 fill-primary-foreground shrink-0" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                <div>
                  <p className="text-[10px] text-primary-foreground/50">متوفر الآن على</p>
                  <p className="text-sm font-bold">App Store</p>
                </div>
              </a>
              {/* Google Play — submitted, waiting on Google review.
                  Marked as "coming soon" but the link works the moment
                  the app is approved (URL is deterministic from package id). */}
              <a
                href="https://play.google.com/store/apps/details?id=com.mishwaro.app"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 bg-white/10 hover:bg-white/20 active:bg-white/25 transition-colors rounded-xl px-3 py-2"
              >
                {/* Official Google Play 4-color triangle. Hardcoded brand
                    colors (not currentColor) so the icon reads correctly
                    on the dark green footer just like the real Google badge. */}
                <svg viewBox="0 0 512 512" className="w-6 h-6 shrink-0" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path fill="#00d2ff"  d="M89 28.4C82.2 35.6 78.2 46.7 78.2 61.2v389.6c0 14.5 4 25.6 10.8 32.8l1.3 1.2 218-217.9v-2.6L90.3 27.2 89 28.4z"/>
                  <path fill="#fcc934" d="M380.5 339.1l-72.4-72.5v-2.6l72.5-72.5 1.6 1 86 48.8c24.5 13.9 24.5 36.7 0 50.6l-86 48.8-1.7 0.4z"/>
                  <path fill="#ff3d00" d="M382.1 338.1l-74-74.1L89 482.7c8.1 8.6 21.4 9.6 36.5 1.1L382.1 338.1"/>
                  <path fill="#00e676" d="M382.1 174 125.5 28.2C110.4 19.7 97.1 20.8 89 29.4L308.1 248.4 382.1 174z"/>
                </svg>
                <div>
                  <p className="text-[10px] text-primary-foreground/50">قريباً على</p>
                  <p className="text-sm font-bold">Google Play</p>
                </div>
              </a>
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
              {supportEmail && (
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                  <div>
                    <p className="text-xs text-primary-foreground/50 mb-0.5">البريد الإلكتروني</p>
                    <a href={`mailto:${supportEmail}`}
                      className="text-sm text-primary-foreground/75 hover:text-primary-foreground transition-colors">
                      {supportEmail}
                    </a>
                  </div>
                </div>
              )}
              {supportPhone && (
                <div className="flex items-start gap-3">
                  <Phone className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                  <div>
                    <p className="text-xs text-primary-foreground/50 mb-0.5">هاتف الدعم</p>
                    <a href={`tel:${supportPhone.replace(/[^0-9+]/g, "")}`}
                      className="text-sm text-primary-foreground/75 hover:text-primary-foreground transition-colors">
                      {supportPhone}
                    </a>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <p className="text-xs text-primary-foreground/50 mb-0.5">المقر</p>
                  <p className="text-sm text-primary-foreground/75 flex items-center gap-1">
                    رام الله، فلسطين
                    <svg viewBox="0 0 1200 600" className="w-5 h-2.5 rounded-sm inline-block" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="200" fill="#000"/><rect y="200" width="1200" height="200" fill="#fff"/><rect y="400" width="1200" height="200" fill="#007a3d"/><polygon points="0,0 600,300 0,600" fill="#ce1126"/></svg>
                  </p>
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
          <p className="flex items-center gap-1.5">© {new Date().getFullYear()} مشوارو — جميع الحقوق محفوظة <svg viewBox="0 0 1200 600" className="w-5 h-2.5 rounded-sm inline-block" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="200" fill="#000"/><rect y="200" width="1200" height="200" fill="#fff"/><rect y="400" width="1200" height="200" fill="#007a3d"/><polygon points="0,0 600,300 0,600" fill="#ce1126"/></svg></p>
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
