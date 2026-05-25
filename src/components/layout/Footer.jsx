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
                <svg viewBox="0 0 814 1000" className="w-6 h-6 fill-primary-foreground shrink-0" xmlns="http://www.w3.org/2000/svg">
                  <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.8 133.4-318.1 264.4-318.1 70.1 0 128.4 46.4 172.5 46.4 42.8 0 109.8-49 191.3-49 30.8 0 108.2 2.6 167.3 73.6zm-116.7-130.8c-28.2 33.3-74 58.9-115.4 58.9-3.9 0-7.7-.5-11.5-1.5 0-38.5 18.6-78.4 45.8-103.5 28.2-26.3 73.4-45.8 112.7-45.8 1.3 0 2.6 0 3.9.5.6 41.5-12.8 81.9-35.5 91.4z"/>
                </svg>
                <div>
                  <p className="text-[10px] text-primary-foreground/50">متوفر الآن على</p>
                  <p className="text-sm font-bold">App Store</p>
                </div>
              </a>
              {/* Google Play — coming soon */}
              <div className="flex items-center gap-3 bg-white/10 rounded-xl px-3 py-2 opacity-60">
                <svg viewBox="0 0 24 24" className="w-6 h-6 fill-primary-foreground shrink-0" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3.18 23.76c.3.17.64.24.99.2l12.49-12.5L13.1 8l-9.92 15.76zm16.48-10.7-3.22-1.85-3.62 3.63 3.62 3.61 3.24-1.87a1.83 1.83 0 0 0 0-3.52zM2.1.31A1.83 1.83 0 0 0 1.83 1v22c0 .24.05.47.14.68L13.1 12 2.1.31zm11 11.04L2.98.28C2.68.1 2.33.04 1.98.1l11.13 11.25z"/>
                </svg>
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
