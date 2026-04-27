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
  { label: "من نحن", path: "#" },
  { label: "مدونة سيرتنا", path: "#" },
  { label: "الأسئلة الشائعة", path: "/help" },
  { label: "الأمان", path: "#" },
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
            <p className="text-sm text-white/70 leading-relaxed">
              منصة مشاركة رحلات تربط بين السائقين والمسافرين في جميع أنحاء فلسطين بطريقة آمنة، مريحة، واقتصادية.
            </p>
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

          {/* Contact */}
          <div>
            <h4 className="font-bold mb-4">تواصل معنا</h4>
            <ul className="space-y-2 text-sm text-white/70">
              <li>📞 +970 59 123 4567</li>
              <li>✉️ info@sayartna.ps</li>
              <li>📍 رام الله - فلسطين</li>
            </ul>
            <div className="flex gap-3 mt-4">
              {["f", "𝕏", "📷", "▶"].map((icon, i) => (
                <button key={i} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs transition-colors">
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/50">© 2024 سيرتنا. جميع الحقوق محفوظة 🇵🇸</p>
          <div className="flex gap-3">
            <div className="h-8 px-3 rounded bg-white/10 flex items-center text-xs">Google Play</div>
            <div className="h-8 px-3 rounded bg-white/10 flex items-center text-xs">App Store</div>
          </div>
        </div>
      </div>
    </footer>
  );
}