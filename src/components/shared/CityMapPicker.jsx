import React, { useEffect, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";

// ── Complete Palestinian localities with GPS coordinates ──────────────────────
// Source: OpenStreetMap / PCBS locality data — West Bank governorates
const PALESTINE_CITIES = [
  // ── رام الله والبيرة ────────────────────────────────────────────
  { name: "رام الله",              lat: 31.9038, lng: 35.2034 },
  { name: "البيرة",                lat: 31.9122, lng: 35.2154 },
  { name: "الرام",                 lat: 31.8488, lng: 35.2239 },
  { name: "بيتونيا",               lat: 31.8998, lng: 35.1657 },
  { name: "بيتين",                 lat: 31.9455, lng: 35.2244 },
  { name: "العيزرية",              lat: 31.7700, lng: 35.2650 },
  { name: "أبو ديس",               lat: 31.7589, lng: 35.2747 },
  { name: "الجيب",                 lat: 31.8627, lng: 35.1735 },
  { name: "الطيبة",                lat: 32.0010, lng: 35.2240 },
  { name: "نعلين",                 lat: 31.9603, lng: 35.0384 },
  { name: "كفر نعمة",              lat: 31.9706, lng: 35.0655 },
  { name: "مخماس",                 lat: 31.9771, lng: 35.2618 },
  { name: "قطنة",                  lat: 31.8622, lng: 35.1468 },
  { name: "دير قديس",              lat: 31.9537, lng: 35.0199 },
  { name: "عين قينيا",             lat: 31.9333, lng: 35.1833 },
  { name: "عبود",                  lat: 31.9817, lng: 35.0522 },
  { name: "برهام",                 lat: 31.9694, lng: 35.1003 },
  { name: "كوبر",                  lat: 31.9836, lng: 35.1983 },
  { name: "دير عمار",              lat: 31.9500, lng: 35.0833 },
  { name: "رأس كركر",              lat: 31.9667, lng: 35.1333 },
  { name: "خربثا بني حارث",        lat: 31.9833, lng: 35.0333 },
  { name: "بلعين",                 lat: 31.9778, lng: 35.0292 },
  { name: "النبي صالح",            lat: 31.9981, lng: 35.1019 },
  { name: "الجانية",               lat: 31.9333, lng: 35.1167 },
  { name: "أبو قش",                lat: 31.8833, lng: 35.1667 },
  { name: "رافات",                 lat: 32.0167, lng: 35.1833 },
  { name: "صفا",                   lat: 31.9944, lng: 35.0681 },
  { name: "عين السينية",           lat: 31.9650, lng: 35.2333 },
  { name: "جلجليا",                lat: 32.0333, lng: 35.2000 },
  { name: "عطارة",                 lat: 32.0167, lng: 35.2167 },
  { name: "بدرس",                  lat: 31.8694, lng: 35.1181 },
  { name: "عين يبرود",             lat: 31.9667, lng: 35.2667 },
  { name: "دير السودان",           lat: 31.9833, lng: 35.1500 },
  { name: "المزرعة الشرقية",       lat: 32.0000, lng: 35.2667 },
  { name: "المزرعة الغربية",       lat: 32.0000, lng: 35.2500 },
  { name: "دير غسانة",             lat: 31.9833, lng: 35.0833 },
  { name: "جبع",                   lat: 31.8833, lng: 35.2167 },
  { name: "شقبا",                  lat: 31.9500, lng: 35.0000 },
  { name: "كفر مالك",              lat: 31.9789, lng: 35.2994 },
  { name: "ترمسعيا",               lat: 31.9844, lng: 35.2736 },
  { name: "سلواد",                 lat: 31.9636, lng: 35.2942 },
  { name: "عبوين",                 lat: 31.9911, lng: 35.2444 },
  { name: "دير جرير",              lat: 31.9878, lng: 35.3000 },
  { name: "دير نظام",              lat: 31.9944, lng: 35.1817 },
  { name: "الجفنة",                lat: 31.9264, lng: 35.2094 },
  { name: "صردا",                  lat: 32.0306, lng: 35.2317 },
  { name: "رمون",                  lat: 31.9686, lng: 35.3183 },
  { name: "عين عريك",              lat: 31.9083, lng: 35.1917 },
  { name: "كوكب أبو الهيجا",       lat: 32.0500, lng: 35.1833 },
  { name: "ترقوميا",               lat: 31.6108, lng: 34.9819 },
  { name: "دير أبو مشعل",          lat: 32.0217, lng: 35.0653 },
  { name: "عابود",                 lat: 31.9833, lng: 35.0333 },
  { name: "كفر عين",               lat: 31.9972, lng: 35.0628 },

  // ── جنين ───────────────────────────────────────────────────────
  { name: "جنين",                  lat: 32.4601, lng: 35.2969 },
  { name: "اليامون",               lat: 32.4628, lng: 35.2372 },
  { name: "برقين",                 lat: 32.4489, lng: 35.2747 },
  { name: "سيلة الظهر",            lat: 32.4222, lng: 35.2108 },
  { name: "يعبد",                  lat: 32.4152, lng: 35.1749 },
  { name: "الزبابدة",              lat: 32.3714, lng: 35.3183 },
  { name: "قبّاطية",               lat: 32.3631, lng: 35.2817 },
  { name: "عرابة",                 lat: 32.3967, lng: 35.3361 },
  { name: "كفر راعي",              lat: 32.4369, lng: 35.2022 },
  { name: "عرّانة",                lat: 32.4244, lng: 35.2383 },
  { name: "المقيبلة",              lat: 32.4389, lng: 35.3067 },
  { name: "بيت قاد",               lat: 32.4833, lng: 35.3333 },
  { name: "سيلة الحارثية",         lat: 32.4583, lng: 35.2000 },
  { name: "صانور",                 lat: 32.3669, lng: 35.2231 },
  { name: "برطعة",                 lat: 32.4833, lng: 35.1667 },
  { name: "عنين",                  lat: 32.4444, lng: 35.2569 },
  { name: "فقوعة",                 lat: 32.3944, lng: 35.2933 },
  { name: "رمانة",                 lat: 32.4667, lng: 35.1833 },
  { name: "دير أبو ضعيف",          lat: 32.3833, lng: 35.2167 },
  { name: "صيدا",                  lat: 32.4500, lng: 35.3000 },
  { name: "ميثلون",                lat: 32.4667, lng: 35.3167 },
  { name: "دير غزالة",             lat: 32.4833, lng: 35.2833 },
  { name: "عصيرة الشمالية",        lat: 32.2833, lng: 35.2500 },
  { name: "كفر دان",               lat: 32.4500, lng: 35.2167 },
  { name: "تعنك",                  lat: 32.5000, lng: 35.2167 },
  { name: "فاقوعة",                lat: 32.3833, lng: 35.3167 },
  { name: "إم الريحان",            lat: 32.4667, lng: 35.1333 },
  { name: "زبدة",                  lat: 32.3667, lng: 35.1667 },
  { name: "طوباس",                 lat: 32.3231, lng: 35.3706 },
  { name: "طمون",                  lat: 32.3533, lng: 35.3417 },

  // ── نابلس ──────────────────────────────────────────────────────
  { name: "نابلس",                 lat: 32.2211, lng: 35.2544 },
  { name: "بيتا",                  lat: 32.1685, lng: 35.3102 },
  { name: "جمّاعين",               lat: 32.1206, lng: 35.1756 },
  { name: "حوّارة",                lat: 32.1754, lng: 35.2702 },
  { name: "سالم",                  lat: 32.2767, lng: 35.3194 },
  { name: "كفر قدوم",              lat: 32.2706, lng: 35.1178 },
  { name: "لوبان الشرقية",         lat: 32.0919, lng: 35.2244 },
  { name: "قريوط",                 lat: 32.1133, lng: 35.2508 },
  { name: "بيت فوريك",             lat: 32.2283, lng: 35.3350 },
  { name: "بيت دجن",               lat: 32.2283, lng: 35.3583 },
  { name: "روجيب",                 lat: 32.2086, lng: 35.2903 },
  { name: "دير شرف",               lat: 32.2506, lng: 35.1431 },
  { name: "سبسطية",                lat: 32.2769, lng: 35.1906 },
  { name: "بيت إيبا",              lat: 32.2583, lng: 35.2000 },
  { name: "جوريش",                 lat: 32.2133, lng: 35.1900 },
  { name: "باذان",                 lat: 32.1833, lng: 35.1667 },
  { name: "كفر حارس",              lat: 32.1633, lng: 35.1317 },
  { name: "دوما",                  lat: 32.1183, lng: 35.3083 },
  { name: "بيت وزن",               lat: 32.2583, lng: 35.1583 },
  { name: "يتما",                  lat: 32.1167, lng: 35.2833 },
  { name: "عصيرة القبلية",         lat: 32.2167, lng: 35.2833 },
  { name: "طلوزة",                 lat: 32.3000, lng: 35.2500 },
  { name: "بيت ليد",               lat: 32.2667, lng: 35.0833 },
  { name: "قبلان",                 lat: 32.1717, lng: 35.2067 },
  { name: "العوجا",                lat: 32.0956, lng: 35.4400 },

  // ── طولكرم ─────────────────────────────────────────────────────
  { name: "طولكرم",                lat: 32.3107, lng: 35.0289 },
  { name: "عنبتا",                 lat: 32.3267, lng: 35.0728 },
  { name: "علّار",                 lat: 32.3301, lng: 35.0612 },
  { name: "الطيرة",                lat: 32.3556, lng: 35.0311 },
  { name: "شويكة",                 lat: 32.2917, lng: 35.0250 },
  { name: "دنابة",                 lat: 32.3333, lng: 35.0833 },
  { name: "سفارين",                lat: 32.3667, lng: 35.0167 },
  { name: "عتيل",                  lat: 32.3167, lng: 35.0500 },
  { name: "كفر الليمون",           lat: 32.2500, lng: 35.0167 },
  { name: "رامين",                 lat: 32.3500, lng: 35.0833 },
  { name: "فرعتا",                 lat: 32.2333, lng: 35.0000 },
  { name: "نزلة عيسى",             lat: 32.3667, lng: 35.0833 },
  { name: "إسكاكا",                lat: 32.2000, lng: 35.0500 },

  // ── قلقيلية ────────────────────────────────────────────────────
  { name: "قلقيلية",               lat: 32.1887, lng: 34.9701 },
  { name: "عزون",                  lat: 32.2025, lng: 35.0305 },
  { name: "هبلة",                  lat: 32.1667, lng: 35.0000 },
  { name: "كفر ثلث",               lat: 32.1667, lng: 34.9667 },
  { name: "سنيريا",                lat: 32.1833, lng: 34.9833 },
  { name: "كفر لاقف",              lat: 32.2167, lng: 34.9833 },
  { name: "جيوس",                  lat: 32.2333, lng: 35.0167 },
  { name: "فلامية",                lat: 32.2000, lng: 34.9667 },
  { name: "إماتين",                lat: 32.1500, lng: 34.9667 },
  { name: "نبي إلياس",             lat: 32.2167, lng: 35.0500 },
  { name: "بيت أمين",              lat: 32.2667, lng: 35.0167 },
  { name: "حبلة",                  lat: 32.1500, lng: 35.0167 },
  { name: "بدية",                  lat: 32.1333, lng: 34.9667 },

  // ── سلفيت ──────────────────────────────────────────────────────
  { name: "سلفيت",                 lat: 32.0864, lng: 35.1781 },
  { name: "بروقين",                lat: 32.1167, lng: 35.0833 },
  { name: "برقة",                  lat: 32.1333, lng: 35.1500 },
  { name: "كفر الديك",             lat: 32.0333, lng: 35.0833 },
  { name: "رفعة",                  lat: 32.0500, lng: 35.1167 },
  { name: "ياسوف",                 lat: 32.0667, lng: 35.1833 },
  { name: "مرده",                  lat: 32.0833, lng: 35.1333 },
  { name: "استيا",                 lat: 32.0667, lng: 35.0500 },
  { name: "ديرستيا",               lat: 32.1000, lng: 35.1167 },
  { name: "حارس",                  lat: 32.1000, lng: 35.1500 },
  { name: "فركة",                  lat: 32.0500, lng: 35.0667 },
  { name: "دير بلوط",              lat: 32.0667, lng: 35.0167 },
  { name: "مجدل بني فاضل",         lat: 32.0333, lng: 35.1667 },
  { name: "قراوة بني حسان",        lat: 32.0667, lng: 35.0333 },
  { name: "وادي القين",            lat: 32.0333, lng: 35.0500 },

  // ── الخليل ─────────────────────────────────────────────────────
  { name: "الخليل",                lat: 31.5320, lng: 35.0998 },
  { name: "دورا",                  lat: 31.5023, lng: 35.0256 },
  { name: "الظاهرية",              lat: 31.4106, lng: 34.9698 },
  { name: "سعير",                  lat: 31.5815, lng: 35.1672 },
  { name: "تفوح",                  lat: 31.5500, lng: 35.0000 },
  { name: "يطا",                   lat: 31.4261, lng: 35.1012 },
  { name: "إذنا",                  lat: 31.5583, lng: 34.9819 },
  { name: "بني نعيم",              lat: 31.5269, lng: 35.1547 },
  { name: "حلحول",                 lat: 31.5833, lng: 35.0981 },
  { name: "نوبا",                  lat: 31.5500, lng: 35.0333 },
  { name: "الشيوخ",                lat: 31.5667, lng: 35.1333 },
  { name: "دير سامت",              lat: 31.5167, lng: 35.0167 },
  { name: "خرسا",                  lat: 31.5500, lng: 34.9667 },
  { name: "طرقومية",               lat: 31.5833, lng: 34.9667 },
  { name: "بيت كاحل",              lat: 31.5667, lng: 35.0500 },
  { name: "بيت أمرا",              lat: 31.5667, lng: 35.0167 },
  { name: "بيت عوا",               lat: 31.5333, lng: 34.9833 },
  { name: "كرمة",                  lat: 31.5000, lng: 35.0000 },
  { name: "السموع",                lat: 31.4167, lng: 35.0667 },
  { name: "بيت مرسم",              lat: 31.5583, lng: 35.0500 },
  { name: "المجد",                 lat: 31.5167, lng: 35.0500 },
  { name: "منيزل",                 lat: 31.4667, lng: 35.0000 },
  { name: "بيت عنون",              lat: 31.5667, lng: 35.1167 },
  { name: "رفاعية",                lat: 31.4500, lng: 35.0167 },
  { name: "ديرات",                 lat: 31.5167, lng: 35.1000 },
  { name: "زعترة",                 lat: 31.5500, lng: 35.1167 },
  { name: "زيف",                   lat: 31.5000, lng: 35.1333 },
  { name: "حوسان",                 lat: 31.6833, lng: 35.1667 },
  { name: "دير العسل",             lat: 31.4333, lng: 35.0000 },
  { name: "بيت الروش الفوقا",      lat: 31.5000, lng: 35.0333 },
  { name: "خرصا",                  lat: 31.4833, lng: 35.0333 },
  { name: "صيف",                   lat: 31.4667, lng: 35.0833 },
  { name: "العقابة",               lat: 31.5167, lng: 35.0000 },

  // ── بيت لحم ────────────────────────────────────────────────────
  { name: "بيت لحم",               lat: 31.7054, lng: 35.2024 },
  { name: "بيت ساحور",             lat: 31.6974, lng: 35.2224 },
  { name: "بيت جالا",              lat: 31.7180, lng: 35.1880 },
  { name: "بتّير",                 lat: 31.7236, lng: 35.1442 },
  { name: "الخضر",                 lat: 31.6808, lng: 35.1648 },
  { name: "بيت فجار",              lat: 31.6444, lng: 35.1467 },
  { name: "نحالين",                lat: 31.7167, lng: 35.1000 },
  { name: "الدوحة",                lat: 31.6994, lng: 35.1639 },
  { name: "العبيدية",              lat: 31.7222, lng: 35.2667 },
  { name: "تقوع",                  lat: 31.6583, lng: 35.2583 },
  { name: "أرطاس",                 lat: 31.6819, lng: 35.1742 },
  { name: "كيسان",                 lat: 31.6667, lng: 35.2500 },
  { name: "الولجة",                lat: 31.7333, lng: 35.1500 },
  { name: "المنيا",                lat: 31.7333, lng: 35.1333 },
  { name: "المعصرة",               lat: 31.6333, lng: 35.1333 },
  { name: "شرفات",                 lat: 31.7167, lng: 35.1167 },

  // ── أريحا والأغوار ─────────────────────────────────────────────
  { name: "أريحا",                 lat: 31.8571, lng: 35.4617 },
  { name: "نويعمة",                lat: 31.8917, lng: 35.4333 },
  { name: "الجفتليك",              lat: 32.0290, lng: 35.4747 },
  { name: "الخان الأحمر",          lat: 31.8200, lng: 35.3700 },
  { name: "فصايل",                 lat: 32.0000, lng: 35.4500 },
  { name: "الزبيدات",              lat: 32.0667, lng: 35.4833 },
  { name: "ديوك التحتا",           lat: 31.8833, lng: 35.4500 },
  { name: "ديوك الفوقا",           lat: 31.8667, lng: 35.4333 },
  { name: "عين الديوك",            lat: 31.8758, lng: 35.4231 },
  { name: "مرج نعجة",              lat: 31.8500, lng: 35.4833 },

  // ── طوباس والأغوار الشمالية ────────────────────────────────────
  { name: "تياسير",                lat: 32.3500, lng: 35.4167 },
  { name: "بردلة",                 lat: 32.4167, lng: 35.4333 },
  { name: "عقابة",                 lat: 32.3667, lng: 35.3333 },
  { name: "البقيعة",               lat: 32.4500, lng: 35.4000 },
  { name: "وادي المالح",           lat: 32.2500, lng: 35.4667 },
  { name: "الحديدية",              lat: 32.2833, lng: 35.4833 },
  { name: "ردة",                   lat: 32.3167, lng: 35.3667 },
  { name: "كردلة",                 lat: 32.3833, lng: 35.4500 },

  // ── القدس ──────────────────────────────────────────────────────
  { name: "القدس",                 lat: 31.7683, lng: 35.2137 },
  { name: "القدس القديمة",         lat: 31.7762, lng: 35.2354 },
  { name: "شعفاط",                 lat: 31.8223, lng: 35.2298 },
  { name: "سلوان",                 lat: 31.7706, lng: 35.2281 },
  { name: "الطور",                 lat: 31.7800, lng: 35.2450 },
  { name: "جبل المكبر",            lat: 31.7569, lng: 35.2433 },
  { name: "بيت حنينا",             lat: 31.8317, lng: 35.2133 },
  { name: "كفر عقب",               lat: 31.8617, lng: 35.2000 },
  { name: "العيسوية",              lat: 31.7994, lng: 35.2469 },
  { name: "صور باهر",              lat: 31.7492, lng: 35.2489 },
  { name: "السواحرة الشرقية",      lat: 31.7333, lng: 35.2833 },
  { name: "السواحرة الغربية",      lat: 31.7500, lng: 35.2500 },
  { name: "ضواحي القدس",           lat: 31.7980, lng: 35.2179 },
  { name: "أبو ديس",               lat: 31.7589, lng: 35.2747 },
  { name: "العزرية",               lat: 31.7700, lng: 35.2650 },
  { name: "قلنديا",                lat: 31.8578, lng: 35.2161 },
  { name: "بيرنبالا",              lat: 31.8783, lng: 35.1781 },
  { name: "عين كارم",              lat: 31.7683, lng: 35.1400 },
];

export default function CityMapPicker({ value, onChange, placeholder = "اختر مدينتك", forceOpen = false, onClose }) {
  const mapRef      = useRef(null);
  const mapInstance = useRef(null);
  const markersRef  = useRef([]);
  const listRef     = useRef(null);  // ref for city list scrolling
  const searchRef   = useRef(null);  // ref to focus search after selection
  const [search,   setSearch]   = useState("");
  const [isOpen,   setIsOpen]   = useState(false);

  // Lock the scrollable container (MobileLayout scroll div) when map is open
  // MobileLayout is fixed inset-0, so we lock its scroll child, not the body
  useEffect(() => {
    if (!isOpen) return;

    // Find the nearest scrollable ancestor
    const findScrollParent = (el) => {
      if (!el) return null;
      const style = window.getComputedStyle(el);
      if (style.overflowY === "scroll" || style.overflowY === "auto") return el;
      return findScrollParent(el.parentElement);
    };

    // We need a DOM ref — use the trigger button's parent
    const trigger = document.activeElement;
    const scrollParent = findScrollParent(trigger) || document.documentElement;
    const savedScrollTop = scrollParent.scrollTop;

    // Lock the scroll container
    scrollParent.style.overflow = "hidden";

    return () => {
      // Restore scroll container to where it was (at the input field)
      scrollParent.style.overflow = "";
      // Scroll back to where the user was — top of form
      scrollParent.scrollTop = savedScrollTop;
    };
  }, [isOpen]);
  const [selected, setSelected] = useState(value || "");

  // Allow parent to force-open the map
  useEffect(() => {
    if (forceOpen) setIsOpen(true);
  }, [forceOpen]);

  const filtered = PALESTINE_CITIES.filter(c =>
    search === "" || c.name.includes(search)
  );

  // Initialize Leaflet when modal opens
  useEffect(() => {
    if (!isOpen || mapInstance.current) return;
    const timer = setTimeout(async () => {
      if (!mapRef.current) return;
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");

      delete L.default.Icon.Default.prototype._getIconUrl;
      L.default.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.default.map(mapRef.current, {
        center: [32.0, 35.2], zoom: 9,
        zoomControl: true, scrollWheelZoom: false,
      });

      L.default.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap", maxZoom: 18,
      }).addTo(map);

      // Add all city markers
      PALESTINE_CITIES.forEach(city => {
        const isSelected = city.name === selected;
        const icon = L.default.divIcon({
          html: `<div style="
            background:${isSelected ? "#2d6a4f" : "#fff"};
            border:2.5px solid #2d6a4f;
            border-radius:50%;
            width:12px;height:12px;
            box-shadow:0 1px 4px rgba(0,0,0,0.3);
            cursor:pointer;
          "></div>`,
          className: "", iconSize: [12, 12], iconAnchor: [6, 6],
        });

        const marker = L.default.marker([city.lat, city.lng], { icon })
          .addTo(map)
          .bindTooltip(city.name, { permanent: false, direction: "top" });

        marker.on("click", () => {
          // Map marker click: highlight city in list, scroll to it, but don't close yet
          setSelected(city.name);
          setSearch("");
          // Scroll list to show the selected city
          setTimeout(() => {
            if (listRef.current) {
              const idx = PALESTINE_CITIES.findIndex(c => c.name === city.name);
              const itemHeight = 44; // approx row height in px
              listRef.current.scrollTop = Math.max(0, idx * itemHeight - 60);
            }
          }, 50);
        });
        markersRef.current.push(marker);
      });

      mapInstance.current = map;
      if (selected) {
        const c = PALESTINE_CITIES.find(c => c.name === selected);
        if (c) map.setView([c.lat, c.lng], 12);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Cleanup map on close
  useEffect(() => {
    if (!isOpen && mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
      markersRef.current  = [];
    }
  }, [isOpen]);

  const handleClose = () => { setIsOpen(false); onClose?.(); };

  const handleSelect = (cityName) => {
    if (!cityName) {
      // Clear selection
      setSelected("");
      onChange("");
      setSearch("");
      if (listRef.current) listRef.current.scrollTop = 0;
      return;
    }
    setSelected(cityName);
    onChange(cityName);
    setIsOpen(false);
    setSearch("");
    onClose?.();
  };

  const flyToCity = (city) => {
    if (mapInstance.current) {
      mapInstance.current.flyTo([city.lat, city.lng], 12, { duration: 0.6 });
    }
  };

  return (
    <div className="relative" dir="rtl">
      {/* Trigger button */}
      <button type="button" onClick={() => setIsOpen(true)}
        className="w-full h-11 flex items-center gap-2 px-3 rounded-xl bg-muted/50 border border-border text-sm hover:border-primary/40 transition-colors">
        <MapPin className="w-4 h-4 text-primary shrink-0" />
        <span className={selected ? "text-foreground font-medium" : "text-muted-foreground"}>
          {selected || placeholder}
        </span>
        {selected && (
          <button type="button" onClick={(e) => { e.stopPropagation(); handleSelect(""); }}
            className="mr-auto p-1 rounded hover:bg-muted">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </button>

      {/* Map modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60"
          onClick={handleClose}
          onTouchMove={(e) => e.stopPropagation()}
          style={{ overscrollBehavior: "none", touchAction: "none" }}
        >
          <div
            className="bg-card w-full sm:max-w-lg h-[85vh] sm:h-[600px] rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
            onTouchMove={e => e.stopPropagation()}
            style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
          >

            {/* Header */}
            <div className="p-4 border-b border-border flex items-center gap-3 shrink-0">
              <MapPin className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-foreground">اختر على الخريطة</p>
                <p className="text-xs text-muted-foreground">{PALESTINE_CITIES.length} موقع على الخريطة</p>
              </div>
              <button onClick={handleClose} className="p-2 rounded-xl hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-2 border-b border-border shrink-0">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value);
                    // Scroll list to top on new search
                    if (listRef.current) listRef.current.scrollTop = 0;
                    if (e.target.value) {
                      const city = PALESTINE_CITIES.find(c => c.name.startsWith(e.target.value));
                      if (city) flyToCity(city);
                    }
                  }}
                  ref={searchRef}
                  placeholder={`ابحث في ${PALESTINE_CITIES.length} موقع...`}
                  className="w-full h-10 pr-9 pl-4 rounded-xl bg-muted/50 border border-border text-sm outline-none focus:border-primary/50"
                  autoFocus
                />
              </div>
            </div>

            {/* Map + list */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div ref={mapRef} className="h-52 shrink-0" style={{ zIndex: 1, touchAction: "none" }} />
              <div ref={listRef} className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
                {filtered.map(city => (
                  <button key={city.name} type="button"
                    onClick={() => handleSelect(city.name)}
                    onMouseEnter={() => flyToCity(city)}
                    className={`w-full text-right px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 active:bg-muted transition-colors border-b border-border/30 ${
                      selected === city.name ? "bg-primary/8 text-primary" : ""
                    }`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${selected === city.name ? "bg-primary" : "bg-muted-foreground/30"}`} />
                    <span className="text-sm font-medium">{city.name}</span>
                    {selected === city.name && <span className="mr-auto text-xs text-primary font-bold">✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm bar — shows when a city is highlighted but not yet confirmed */}
            {selected && (
              <div className="shrink-0 border-t border-border bg-card p-3">
                <button
                  type="button"
                  onClick={() => {
                    onChange(selected);
                    setIsOpen(false);
                    setSearch("");
                    onClose?.();
                  }}
                  className="w-full h-11 bg-primary text-primary-foreground rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:opacity-80"
                >
                  <span>✓</span>
                  اختر "{selected}"
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
