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

  const WHATSAPP_SUPPORT = "https://wa.me/970599000000?text=مرحباً، أحتاج مساعدة في تطبيق مِشوار";
  const FACEBOOK_URL = "https://www.facebook.com/mishwarapp";
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
              {/* WhatsApp Support */}
              <a
                href={WHATSAPP_SUPPORT}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 bg-green-600/80 hover:bg-green-600 rounded-xl px-4 py-3 transition-colors"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <div>
                  <p className="text-xs text-white/70">دعم فوري</p>
                  <p className="font-bold text-sm">واتساب</p>
                </div>
              </a>

              {/* Facebook */}
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 bg-blue-600/80 hover:bg-blue-600 rounded-xl px-4 py-3 transition-colors"
              >
                <span className="text-xl font-bold">f</span>
                <div>
                  <p className="text-xs text-white/70">تابعنا على</p>
                  <p className="font-bold text-sm">فيسبوك</p>
                </div>
              </a>

              {/* Email */}
              <a
                href="mailto:support@mishwar.ps"
                className="flex items-center gap-3 text-sm text-white/70 hover:text-white transition-colors"
              >
                <Mail className="w-4 h-4" />
                support@mishwar.ps
              </a>
            </div>
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
    </footer>
  );
}
