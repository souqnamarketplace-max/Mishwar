-- ════════════════════════════════════════════════════════════════════════
-- Initial release notes for /whats-new launch
-- ════════════════════════════════════════════════════════════════════════
--
-- Paste this into the Supabase SQL editor:
--   https://supabase.com/dashboard/project/dimtdwahtwaslmnuakij/sql/new
--
-- Result:
--   - 1 pinned "welcome" note for everyone
--   - 1 driver-targeted recurring trips announcement
--   - 1 universal note about the new search
--   - 1 universal note about the categorized notifications
--
-- Users opening /whats-new for the first time will see 4 entries.
-- Subsequent releases: just add new INSERT statements via SQL.
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO public.release_notes (title, body, audience, icon, is_pinned, created_by)
VALUES
  (
    'مرحباً بك في مشوارو 🎉',
    'منصة فلسطينية تربط السائقين بالمسافرين — رحلتك أسهل، أوفر، وأسرع. تابع هذه الصفحة لمعرفة كل ميزة جديدة فور إصدارها.',
    'all',
    'Sparkles',
    TRUE,
    'souqnamarketplace@gmail.com'
  ),
  (
    'الرحلات المتكررة 🔁',
    'للسائقين: عرّف قالب رحلة واحد، وسننشرها تلقائياً كل يوم في الموعد الذي تختاره. أنماط مدعومة: يومياً، أيام العمل (الأحد-الخميس)، العطلة (الجمعة-السبت)، أو أسبوعياً نفس اليوم. اذهب إلى "رحلاتي" ← "إدارة الرحلات المتكررة" للبدء.',
    'drivers',
    'Repeat',
    FALSE,
    'souqnamarketplace@gmail.com'
  ),
  (
    'البحث الشامل ⌘K',
    'ابحث في المدن، الرحلات القادمة، والسائقين المفضلين من أي صفحة. اضغط زر البحث في الشريط العلوي، أو على الكمبيوتر استخدم الاختصار Cmd+K (Ctrl+K على Windows). يكفي حرفان للبدء.',
    'all',
    'Search',
    FALSE,
    'souqnamarketplace@gmail.com'
  ),
  (
    'تصنيف الإشعارات 🔔',
    'صندوق الإشعارات أصبح أسهل في التصفح. الإشعارات مصنفة الآن إلى: رحلات، رسائل، المفضلة، والنظام. اضغط أي تصنيف في الأعلى لرؤية ذلك النوع فقط — ولن تضطر بعد الآن للبحث وسط عشرات الإشعارات لتجد رسالة مهمة.',
    'all',
    'Bell',
    FALSE,
    'souqnamarketplace@gmail.com'
  );

-- Verify
SELECT title, audience, is_pinned, published_at
  FROM public.release_notes
  ORDER BY is_pinned DESC, published_at DESC;
