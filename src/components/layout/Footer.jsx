import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";

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
  const [showStory, setShowStory] = useState(false);

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        {/* Our Story Section */}
        <div className="mb-12 bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <button
            onClick={() => setShowStory(!showStory)}
            className="w-full flex items-center justify-between hover:opacity-90 transition-opacity"
          >
            <h3 className="text-xl font-bold">📖 قصتنا</h3>
            <ChevronDown className={`w-5 h-5 transition-transform ${showStory ? 'rotate-180' : ''}`} />
          </button>
          
          {showStory && (
            <div className="mt-4 space-y-4 text-sm text-white/80 leading-relaxed max-h-96 overflow-y-auto">
              <p>
                في أوائل عام 2026، لم يكن أحمد خليل يفكر في إطلاق شركة أو بناء منصة—بل كان يحاول فقط التعامل مع تفاصيل الحياة اليومية في فلسطين. بين العمل والتنقل، كان يقضي ساعات طويلة في الانتظار على الحواجز أو في البحث عن وسيلة نقل توصله من مدينة إلى أخرى.
              </p>
              
              <p>
                في كل مرة كان يسافر من رام الله إلى نابلس أو بيت لحم، كان يلاحظ نفس المشهد: سيارات تمر بمقاعد فارغة، وفي المقابل أشخاص ينتظرون لساعات على جانب الطريق. كانت المشكلة واضحة، لكنها بدت وكأنها جزء طبيعي من الواقع.
              </p>
              
              <p>
                في أحد الأيام، تعطلت وسيلة النقل التي كان يعتمد عليها. بعد انتظار طويل، قرر أن يطلب من أحد السائقين المارين توصيلة. وافق السائق، وخلال الطريق بدأ الحديث بينهما. اكتشف أحمد أن السائق يقوم بنفس الرحلة يوميًا تقريبًا، وغالبًا ما تكون سيارته نصف فارغة. في تلك اللحظة، بدأت الفكرة تتشكل.
              </p>
              
              <p className="text-white/60 italic">
                "كم عدد الأشخاص الذين يقومون بنفس الرحلات يوميًا؟ وكم عدد المقاعد الفارغة التي يمكن أن تُستغل؟ ولماذا لا توجد طريقة منظمة لربط هؤلاء ببعضهم؟"
              </p>
              
              <p>
                شارك أحمد هذه الملاحظات مع صديقه يوسف حداد، مهندس البرمجيات. بدأ الاثنان يتخيلان حلًا بسيطًا: منصة تجمع بين السائقين والركاب، مبنية على الثقة، وسهلة الاستخدام، وتناسب طبيعة الحياة في فلسطين.
              </p>
              
              <p>
                في البداية، كانت هناك شكوك. لكن رغم ذلك، قررا البدء. بدأوا بشكل بسيط جدًا—مجموعة صغيرة على وسائل التواصل، تنسيق يدوي للرحلات، وتجربة الفكرة مع الأصدقاء والمعارف. ومع كل رحلة ناجحة، كان الإيمان يكبر.
              </p>
              
              <p>
                ما بدأ كتجربة بسيطة، تحول إلى شيء أكبر بكثير مما توقعوه. لم تعد الفكرة مجرد حل لمشكلة تنقل—بل أصبحت بداية رحلة لبناء مجتمع جديد، حيث يساعد الناس بعضهم البعض، ويعيدون تعريف معنى السفر والتنقل في فلسطين.
              </p>
              
              <p className="text-white font-semibold">
                هذه كانت الشرارة الأولى… والقصة ما زالت تُكتب. 🇵🇸
              </p>
            </div>
          )}
        </div>

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