/**
 * Shared Palestinian cities list.
 * Single source of truth — import everywhere instead of duplicating.
 */
export const CITIES = [
  // رام الله والبيرة
  "رام الله","البيرة","الرام","العيزرية","أبو ديس","بيتونيا","بيتين","دير قديس","الجيب","الطيبة","نعلين","كفر نعمة","مخماس","قطنة",
  // جنين
  "جنين","اليامون","برقين","سيلة الظهر","قبلان","قفين","يعبد","الزبابدة",
  // نابلس
  "نابلس","بيتا","جمّاعين","حوّارة","العوجا","سالم","قريوط","كفر قدوم","لوبان",
  // طولكرم
  "طولكرم","علّار","الطيرة","عنبتا","شويكة","دنابة",
  // قلقيلية
  "قلقيلية","عزون","هبلة",
  // سلفيت
  "سلفيت","برقة","بروقين","كفر الديك",
  // الخليل
  "الخليل","دورا","الظاهرية","سعير","تفوح","يطا","إذنا","بني نعيم",
  // بيت لحم
  "بيت لحم","بيت ساحور","بيت جالا","بتّير","الخضر","بيت فجار","نحالين",
  // أريحا
  "أريحا","نويعمة","الجفتليك","الخان الأحمر",
  // القدس
  "القدس القديمة","ضواحي القدس","شعفاط","سلوان","الطور","جبل المكبر",
  // أخرى
  "بديا","شقبا","كفر مالك",
].sort((a, b) => a.localeCompare(b, 'ar'));

/**
 * Normalize Arabic text for fuzzy comparison.
 * Handles common variations:
 *   - Alef variants: أ إ آ ٱ → ا
 *   - Ta marbuta: ة → ه
 *   - Alef maqsura: ى → ي
 *   - Waw with hamza above: ؤ → و
 *   - Ya with hamza below: ئ → ي
 *   - Hamza above/below alef: ء → (removed)
 *   - Tatweel/kashida: ـ → (removed)
 *   - Diacritics (harakat): removed
 *   - Spaces: normalized (multiple → single, leading/trailing removed)
 */
export function normalizeArabic(text) {
  if (!text) return "";
  return text
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ → ا
    .replace(/ة/g, "ه")                      // ة → ه
    .replace(/ى/g, "ي")                      // ى → ي
    .replace(/ؤ/g, "و")                      // ؤ → و
    .replace(/ئ/g, "ي")                      // ئ → ي
    .replace(/[ء]/g, "")                           // ء → removed
    .replace(/ـ/g, "")                             // ـ kashida → removed
    .replace(/[ً-ٰٟ]/g, "")              // diacritics → removed
    .replace(/\s+/g, " ")                               // normalize spaces
    .trim();
}

/**
 * Returns true if candidate city matches search query using smart Arabic matching.
 * Handles partial matches, normalized alef/ta marbuta, and substring search.
 *
 * @param {string} candidate - The stored city name (from DB / trips table)
 * @param {string} query     - What the user typed / searched
 * @returns {boolean}
 */
export function cityMatches(candidate, query) {
  if (!candidate || !query) return !query; // empty query matches everything
  const normC = normalizeArabic(candidate.toLowerCase());
  const normQ = normalizeArabic(query.toLowerCase().trim());
  if (!normQ) return true;
  // Exact normalized match
  if (normC === normQ) return true;
  // Substring match (partial city name)
  if (normC.includes(normQ)) return true;
  // Query contains the full city (e.g. "رام الله والبيرة" contains "رام الله")
  if (normQ.includes(normC)) return true;
  return false;
}
