import React from "react";
import { Link } from "react-router-dom";

const quickLinks = [
  { label: "الرئيسية", path: "/" },
  { label: "الرحلات", path: "/search" },
  { label: "كيف تعمل؟", path: "/how-it-works" },
  { label: "الشروط والأحكام", path: "#" },
  { label: "سياسة الخصوصية", path: "#" },
];

const aboutLinks = [
  { label: "من نحن", path: "/about" },
  { label: "مدونة سيرتنا", path: "/blog" },
  { label: "الأسئلة الشائعة", path: "/help" },
  { label: "الأمان", path: "/safety" },
];

const socialLinks = [
  { label: "f", title: "فيسبوك" },
  { label: "in", title: "إنستغرام" },
  { label: "𝕏", title: "تويتر" },
  { label: "▶", title: "يوتيوب" },
];

export default function Footer() {
  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-xl">س</span>
              </div>
              <div>
                <h3 className="text-lg font-bold">سيرتنا</h3>
                <p className="text-xs text-white/60">شارك الطريق، وفر أكثر</p>
              </div>
            </div>
            <p className="text-sm text-white/70 leading-relaxed mb-4">
              منصة مشاركة رحلات تربط بين السائقين والمسافرين في جميع أنحاء فلسطين بطريقة آمنة، مريحة، واقتصادية.
            </p>
            {/* Social */}
            <div className="flex gap-2">
              {socialLinks.map((s) => (
                <button
                  key={s.title}
                  title={s.title}
                  className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-xs transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-bold mb-4">روابط سريعة</h4>
            <ul className="space-y-2">
              {quickLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.path} className="text-sm text-white/70 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* About */}
          <div>
            <h4 className="font-bold mb-4">عن سيرتنا</h4>
            <ul className="space-y-2">
              {aboutLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.path} className="text-sm text-white/70 hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact + App */}
          <div>
            <h4 className="font-bold mb-4">تواصل معنا</h4>
            <ul className="space-y-2 text-sm text-white/70 mb-5">
              <li className="flex items-center gap-2">📍 رام الله - فلسطين</li>
              <li className="flex items-center gap-2">📞 +970 59 123 4567</li>
              <li className="flex items-center gap-2">✉️ info@siyartna.ps</li>
            </ul>

            {/* App Store Badges */}
            <h4 className="font-bold mb-3 text-sm">حمّل التطبيق</h4>
            <div className="space-y-2">
              <a
                href="#"
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 transition-colors"
              >
                <span className="text-lg">▶</span>
                <div>
                  <p className="text-[10px] text-white/60">احصل عليه من</p>
                  <p className="text-xs font-bold">Google Play</p>
                </div>
              </a>
              <a
                href="#"
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 transition-colors"
              >
                <span className="text-lg">🍎</span>
                <div>
                  <p className="text-[10px] text-white/60">متوفر على</p>
                  <p className="text-xs font-bold">App Store</p>
                </div>
              </a>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/50">© سيرتنا 2024 جميع الحقوق محفوظة 🇵🇸</p>
          <p className="text-xs text-white/40">فلسطين • جميع الحقوق محفوظة</p>
        </div>
      </div>
    </footer>
  );
}