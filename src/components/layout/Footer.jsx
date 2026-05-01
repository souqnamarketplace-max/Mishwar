import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Phone, Mail } from "lucide-react";

const quickLinks = [
  { label: "الرئيسية", path: "/" },
  { label: "البحث عن رحلة", path: "/search" },
  { label: "أنشر رحلة", path: "/create-trip" },
  { label: "كيف تعمل؟", path: "/how-it-works" },
  { label: "المجتمع", path: "/community" },
];

const aboutLinks = [
  { label: "من نحن", path: "/about" },
  { label: "مدونة مِشوار", path: "/blog" },
  { label: "الأسئلة الشائعة", path: "/help" },
  { label: "الأمان والخصوصية", path: "/safety" },
  { label: "شروط الاستخدام", path: "/terms" },
];

export default function Footer() {
  const [showStory, setShowStory] = useState(false);

      const EMERGENCY_PHONE = "tel:+970599000000";

  return (
    <footer className="bg-primary text-primary-foreground" dir="rtl">
      {/* Emergency / Safety Bar */}
      <div className="bg-red-700/80 px-4 py-2.5 text-center">
        <p className="text-sm flex items-center justify-center gap-2 flex-wrap">
          <span>🆘</span>
          <span>في حالات الطوارئ أو إساءة الاستخدام:</span>
          <a href={EMERGENCY_PHONE} className="font-bold underline hover:opacity-80">
            اتصل بنا مباشرة: 0599-000-000
          </a>
        </p>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        {/* Our Story Section */}
        <div className="mb-10 bg-white/5 rounded-2xl p-6 border border-white/10">
          <button
            onClick={() => setShowStory(!showStory)}
            className="w-full flex items-center justify-between hover:opacity-90 transition-opacity"
          >
            <h3 className="text-xl font-bold">📖 قصتنا</h3>
            <ChevronDown className={`w-5 h-5 transition-transform ${showStory ? "rotate-180" : ""}`} />
          </button>
          {showStory && (
            <div className="mt-4 space-y-3 text-sm text-white/80 leading-relaxed">
              <p>في فلسطين، التنقل بين المدن تحدٍّ يومي. مِشوار وُلد من فكرة بسيطة: لماذا لا نشارك الطريق ونوفر معاً؟</p>
              <p>منصة فلسطينية تربط السائقين بالركاب، تُقلل التكلفة، وتُعزز الترابط بين أبناء الشعب الواحد.</p>
            </div>
          )}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Logo + App */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <span className="text-2xl font-bold">م</span>
              </div>
              <div>
                <h2 className="text-xl font-bold">مِشوار</h2>
                <p className="text-xs text-white/60">🇵🇸 منصة فلسطينية</p>
              </div>
            </div>
            <p className="text-sm text-white/70 mb-4">شارك الطريق، وفر أكثر، وقوّي مجتمعك.</p>
            {/* App Store Badges */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2 text-xs cursor-pointer hover:bg-white/20 transition-colors">
                <span className="text-xl">🍎</span>
                <div>
                  <p className="text-white/60 text-[10px]">قريباً على</p>
                  <p className="font-bold">App Store</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2 text-xs cursor-pointer hover:bg-white/20 transition-colors">
                <span className="text-xl">🤖</span>
                <div>
                  <p className="text-white/60 text-[10px]">قريباً على</p>
                  <p className="font-bold">Google Play</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-bold text-lg mb-4">روابط سريعة</h3>
            <ul className="space-y-2">
              {quickLinks.map((l) => (
                <li key={l.path}>
                  <Link to={l.path} className="text-sm text-white/70 hover:text-white transition-colors hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* About */}
          <div>
            <h3 className="font-bold text-lg mb-4">عن مِشوار</h3>
            <ul className="space-y-2">
              {aboutLinks.map((l) => (
                <li key={l.label}>
                  <Link to={l.path} className="text-sm text-white/70 hover:text-white transition-colors hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact & Support */}
          <div>
            <h3 className="font-bold text-lg mb-4">تواصل معنا</h3>
            <div className="space-y-3">
              <p className="text-white/70 text-sm">تواصل معنا عبر البريد الإلكتروني أو من خلال التطبيق</p>
            </div>
          </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/20 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-white/50">
          <p>© {new Date().getFullYear()} مِشوار — جميع الحقوق محفوظة 🇵🇸</p>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-white transition-colors">سياسة الخصوصية</Link>
            <Link to="/terms" className="hover:text-white transition-colors">شروط الاستخدام</Link>
          </div>
        </div>
      </div>
    </div>
    </footer>
  );
}
