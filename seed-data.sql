-- ============================================================
-- MISHWAR — REALISTIC SEED DATA
-- Run this AFTER supabase-production.sql
-- Creates realistic test scenarios for engallam27 (passenger) 
-- and souqnamarketplace (admin + driver)
-- ============================================================

-- ── 1) UPDATE PROFILES (make souqnamarketplace also a driver) ──
UPDATE public.profiles SET
  full_name      = 'سوق نا - السائق',
  account_type   = 'both',
  role           = 'admin',
  phone          = '0599123456',
  city           = 'رام الله',
  bio            = 'سائق موثق على مِشوار. أوصلكم بأمان وراحة بين المدن الفلسطينية.',
  car_model      = 'تويوتا كامري',
  car_year       = '2021',
  car_color      = 'فضي',
  car_plate      = '6-1234-95',
  gender         = 'male',
  total_rating   = 4.8,
  total_reviews  = 12,
  is_active      = true,
  onboarding_completed = true,
  updated_at = NOW()
WHERE email = 'souqnamarketplace@gmail.com';

UPDATE public.profiles SET
  full_name      = 'إنج علام',
  account_type   = 'passenger',
  phone          = '0598765432',
  city           = 'نابلس',
  bio            = 'مهندس - أسافر بانتظام بين نابلس ورام الله',
  gender         = 'male',
  is_active      = true,
  onboarding_completed = true,
  updated_at = NOW()
WHERE email = 'engallam27@gmail.com';

-- Add a driver_licenses record for souqnamarketplace as APPROVED
INSERT INTO public.driver_licenses (
  driver_email, driver_name, license_number, expiry_date,
  car_registration_expiry_date, insurance_expiry_date,
  license_image_url, car_registration_url, insurance_url, selfie_1_url, selfie_2_url,
  status, submitted_at, approved_at, approved_by, created_by
)
SELECT
  'souqnamarketplace@gmail.com', 'سوق نا - السائق', '987654321', '2027-12-31',
  '2026-08-15', '2026-06-30',
  'https://placehold.co/600x400/15803d/white?text=License',
  'https://placehold.co/600x400/15803d/white?text=Registration',
  'https://placehold.co/600x400/15803d/white?text=Insurance',
  'https://placehold.co/600x400/15803d/white?text=Selfie+1',
  'https://placehold.co/600x400/15803d/white?text=Selfie+2',
  'approved', NOW() - INTERVAL '90 days', NOW() - INTERVAL '88 days', 'system', 'seed-data'
WHERE NOT EXISTS (
  SELECT 1 FROM public.driver_licenses WHERE driver_email = 'souqnamarketplace@gmail.com'
);


-- ── 2) TRIPS (driven by souqnamarketplace) ──
-- Wipe any prior seed trips first to avoid duplicates on re-run
DELETE FROM public.trips WHERE created_by = 'seed-data';

-- All trips for souqnamarketplace. driver_id is looked up from auth.users.
WITH driver AS (
  SELECT id AS driver_id FROM auth.users WHERE lower(email) = 'souqnamarketplace@gmail.com' LIMIT 1
)
INSERT INTO public.trips (
  driver_id, driver_name, driver_email, driver_phone, driver_avatar, driver_rating, driver_reviews_count, driver_gender,
  from_city, to_city, from_location, to_location,
  date, time, price, available_seats, total_seats,
  car_model, car_year, car_color, car_plate,
  status, amenities, payment_methods, driver_note, is_direct, stops,
  created_by, created_at
)
SELECT
  driver.driver_id,
  v.driver_name, v.driver_email, v.driver_phone, v.driver_avatar, v.driver_rating, v.driver_reviews_count, v.driver_gender,
  v.from_city, v.to_city, v.from_location, v.to_location,
  v.date::date, v.time, v.price, v.available_seats, v.total_seats,
  v.car_model, v.car_year, v.car_color, v.car_plate,
  v.status, v.amenities::jsonb, v.payment_methods::jsonb, v.driver_note, v.is_direct, v.stops::jsonb,
  v.created_by, v.created_at
FROM driver, (
  VALUES
  -- Trip 1: TODAY — confirmed (engallam booked seat in this)
  ('سوق نا - السائق', 'souqnamarketplace@gmail.com', '0599123456', NULL::text, 4.8, 12, 'male',
   'رام الله', 'نابلس', 'دوار المنارة', 'دوار الشهداء',
   CURRENT_DATE::text, '08:30', 35.0, 2, 4,
   'تويوتا كامري', '2021', 'فضي', '6-1234-95',
   'confirmed', '["wifi","ac","music","no_smoking"]', '["cash","card"]',
   'الانطلاق من دوار المنارة الساعة 8:30 بالضبط. أرجو الالتزام بالموعد.',
   true, '[]', 'seed-data', NOW() - INTERVAL '2 days'),

  -- Trip 2: TOMORROW
  ('سوق نا - السائق', 'souqnamarketplace@gmail.com', '0599123456', NULL::text, 4.8, 12, 'male',
   'نابلس', 'رام الله', 'دوار الشهداء', 'دوار المنارة',
   (CURRENT_DATE + INTERVAL '1 day')::text, '17:00', 35.0, 3, 4,
   'تويوتا كامري', '2021', 'فضي', '6-1234-95',
   'confirmed', '["wifi","ac","music","no_smoking"]', '["cash","card"]',
   'رحلة المساء — مريحة وسريعة',
   true, '[]', 'seed-data', NOW() - INTERVAL '1 day'),

  -- Trip 3: 2 DAYS — multi-stop showcase نابلس → بيت لحم via رام الله and بيت جالا
  ('سوق نا - السائق', 'souqnamarketplace@gmail.com', '0599123456', NULL::text, 4.8, 12, 'male',
   'نابلس', 'بيت لحم', 'دوار الشهداء', 'باب بيت لحم',
   (CURRENT_DATE + INTERVAL '2 days')::text, '07:00', 60.0, 3, 4,
   'تويوتا كامري', '2021', 'فضي', '6-1234-95',
   'confirmed', '["wifi","ac","music","no_smoking"]', '["cash","card"]',
   'رحلة طويلة مع محطات. نتوقف لدقائق في كل محطة. يمكن للراكب النزول في رام الله أو بيت جالا.',
   false,
   '[{"city":"رام الله","location":"دوار المنارة","time":"08:30","price_from_origin":35,"seats_available":3},{"city":"بيت جالا","location":"ساحة المهد","time":"10:15","price_from_origin":50,"seats_available":2}]',
   'seed-data', NOW() - INTERVAL '6 hours'),

  -- Trip 4: 3 DAYS — long route الخليل → جنين with 3 stops
  ('سوق نا - السائق', 'souqnamarketplace@gmail.com', '0599123456', NULL::text, 4.8, 12, 'male',
   'الخليل', 'جنين', 'دوار ابن رشد', 'دوار الشهداء',
   (CURRENT_DATE + INTERVAL '3 days')::text, '06:30', 90.0, 4, 4,
   'تويوتا كامري', '2021', 'فضي', '6-1234-95',
   'confirmed', '["wifi","ac","music","no_smoking"]', '["cash"]',
   'رحلة عبر الضفة الغربية كاملة. توقفات قصيرة في كل مدينة.',
   false,
   '[{"city":"بيت لحم","location":"باب بيت لحم","time":"07:30","price_from_origin":30,"seats_available":4},{"city":"رام الله","location":"دوار المنارة","time":"09:00","price_from_origin":55,"seats_available":4},{"city":"نابلس","location":"دوار الشهداء","time":"10:30","price_from_origin":75,"seats_available":3}]',
   'seed-data', NOW() - INTERVAL '4 hours'),

  -- Trip 5: COMPLETED — past trip (engallam booked + completed)
  ('سوق نا - السائق', 'souqnamarketplace@gmail.com', '0599123456', NULL::text, 4.8, 12, 'male',
   'نابلس', 'رام الله', 'دوار الشهداء', 'دوار المنارة',
   (CURRENT_DATE - INTERVAL '8 days')::text, '09:00', 35.0, 0, 4,
   'تويوتا كامري', '2021', 'فضي', '6-1234-95',
   'completed', '["wifi","ac","music","no_smoking"]', '["cash"]',
   'رحلة تمت بنجاح',
   true, '[]', 'seed-data', NOW() - INTERVAL '8 days'),

  -- Trip 6: COMPLETED — older trip
  ('سوق نا - السائق', 'souqnamarketplace@gmail.com', '0599123456', NULL::text, 4.8, 12, 'male',
   'رام الله', 'الخليل', 'دوار المنارة', 'دوار ابن رشد',
   (CURRENT_DATE - INTERVAL '15 days')::text, '14:00', 80.0, 0, 4,
   'تويوتا كامري', '2021', 'فضي', '6-1234-95',
   'completed', '["wifi","ac","music","no_smoking"]', '["cash","card"]',
   'رحلة طويلة',
   true, '[]', 'seed-data', NOW() - INTERVAL '15 days'),

  -- Trip 7: TODAY EVENING — soon
  ('سوق نا - السائق', 'souqnamarketplace@gmail.com', '0599123456', NULL::text, 4.8, 12, 'male',
   'نابلس', 'الخليل', 'دوار الشهداء', 'دوار ابن رشد',
   CURRENT_DATE::text, '18:00', 75.0, 1, 4,
   'تويوتا كامري', '2021', 'فضي', '6-1234-95',
   'confirmed', '["wifi","ac","music","no_smoking"]', '["cash"]',
   'رحلة المساء',
   true, '[]', 'seed-data', NOW() - INTERVAL '3 hours')
) AS v(
  driver_name, driver_email, driver_phone, driver_avatar, driver_rating, driver_reviews_count, driver_gender,
  from_city, to_city, from_location, to_location,
  date, time, price, available_seats, total_seats,
  car_model, car_year, car_color, car_plate,
  status, amenities, payment_methods, driver_note, is_direct, stops,
  created_by, created_at
);

-- ── 3) BOOKINGS (engallam books some of souqnamarketplace's trips) ──
DELETE FROM public.bookings WHERE created_by = 'seed-data';

-- engallam books today's trip
INSERT INTO public.bookings (
  trip_id, passenger_name, passenger_email, seats_booked, total_price, status, payment_method, created_by, created_at
)
SELECT id, 'إنج علام', 'engallam27@gmail.com', 1, 35, 'confirmed', 'cash', 'seed-data', NOW() - INTERVAL '1 day'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND date = CURRENT_DATE LIMIT 1;

-- engallam booked the past trip from a week ago (which is now completed)
INSERT INTO public.bookings (
  trip_id, passenger_name, passenger_email, seats_booked, total_price, status, payment_method, created_by, created_at
)
SELECT id, 'إنج علام', 'engallam27@gmail.com', 1, 35, 'completed', 'cash', 'seed-data', NOW() - INTERVAL '8 days'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND status = 'completed' AND date = CURRENT_DATE - 7 LIMIT 1;

-- engallam booked the trip from 2 weeks ago (also completed)
INSERT INTO public.bookings (
  trip_id, passenger_name, passenger_email, seats_booked, total_price, status, payment_method, created_by, created_at
)
SELECT id, 'إنج علام', 'engallam27@gmail.com', 2, 80, 'completed', 'cash', 'seed-data', NOW() - INTERVAL '15 days'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND status = 'completed' AND date = CURRENT_DATE - 14 LIMIT 1;

-- engallam books tomorrow's trip too
INSERT INTO public.bookings (
  trip_id, passenger_name, passenger_email, seats_booked, total_price, status, payment_method, created_by, created_at
)
SELECT id, 'إنج علام', 'engallam27@gmail.com', 1, 35, 'confirmed', 'cash', 'seed-data', NOW() - INTERVAL '6 hours'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND date = CURRENT_DATE + 1 LIMIT 1;


-- ── 4) REVIEWS (after completed trips) ──
DELETE FROM public.reviews WHERE created_by = 'seed-data';

-- engallam rates the driver after past trip 1
INSERT INTO public.reviews (
  trip_id, reviewer_name, reviewer_email, driver_email, rated_user_email,
  review_type, rating, comment, created_by, created_at
)
SELECT
  id::text, 'إنج علام', 'engallam27@gmail.com', 'souqnamarketplace@gmail.com', 'souqnamarketplace@gmail.com',
  'passenger_rates_driver', 5,
  'سائق ممتاز، انطلق في الموعد بالضبط والسيارة نظيفة جداً. أنصح به!',
  'seed-data', NOW() - INTERVAL '6 days'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND status = 'completed' AND date = CURRENT_DATE - 7 LIMIT 1;

-- driver rates engallam back
INSERT INTO public.reviews (
  trip_id, reviewer_name, reviewer_email, driver_email, rated_user_email,
  review_type, rating, comment, created_by, created_at
)
SELECT
  id::text, 'سوق نا - السائق', 'souqnamarketplace@gmail.com', 'souqnamarketplace@gmail.com', 'engallam27@gmail.com',
  'driver_rates_passenger', 5,
  'راكب محترم وملتزم بالمواعيد. أهلاً بك دائماً.',
  'seed-data', NOW() - INTERVAL '6 days'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND status = 'completed' AND date = CURRENT_DATE - 7 LIMIT 1;

-- engallam rates again on second past trip
INSERT INTO public.reviews (
  trip_id, reviewer_name, reviewer_email, driver_email, rated_user_email,
  review_type, rating, comment, created_by, created_at
)
SELECT
  id::text, 'إنج علام', 'engallam27@gmail.com', 'souqnamarketplace@gmail.com', 'souqnamarketplace@gmail.com',
  'passenger_rates_driver', 4,
  'رحلة جيدة، وصلنا بأمان. شوي تأخير في البداية بس عادي.',
  'seed-data', NOW() - INTERVAL '13 days'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND status = 'completed' AND date = CURRENT_DATE - 14 LIMIT 1;

-- driver rates engallam (second time)
INSERT INTO public.reviews (
  trip_id, reviewer_name, reviewer_email, driver_email, rated_user_email,
  review_type, rating, comment, created_by, created_at
)
SELECT
  id::text, 'سوق نا - السائق', 'souqnamarketplace@gmail.com', 'souqnamarketplace@gmail.com', 'engallam27@gmail.com',
  'driver_rates_passenger', 5,
  'دائماً مرحب به في رحلاتي. شخص لطيف ومحترم.',
  'seed-data', NOW() - INTERVAL '13 days'
FROM public.trips WHERE driver_email = 'souqnamarketplace@gmail.com' AND status = 'completed' AND date = CURRENT_DATE - 14 LIMIT 1;


-- ── 5) MESSAGES (real conversation between engallam and souqnamarketplace) ──
DELETE FROM public.messages WHERE created_by = 'seed-data';

WITH conv AS (SELECT 'conv-eng-souq-001' AS id)
INSERT INTO public.messages (
  conversation_id, sender_email, sender_name, receiver_email, receiver_name,
  content, is_read, message_type, created_by, created_at
) VALUES
('conv-eng-souq-001', 'engallam27@gmail.com', 'إنج علام', 'souqnamarketplace@gmail.com', 'سوق نا - السائق',
 'السلام عليكم، حجزت رحلة الغد من نابلس لرام الله',
 true, 'text', 'seed-data', NOW() - INTERVAL '1 day'),

('conv-eng-souq-001', 'souqnamarketplace@gmail.com', 'سوق نا - السائق', 'engallam27@gmail.com', 'إنج علام',
 'وعليكم السلام أهلاً بك. الرحلة الساعة 5 من دوار الشهداء',
 true, 'text', 'seed-data', NOW() - INTERVAL '23 hours'),

('conv-eng-souq-001', 'engallam27@gmail.com', 'إنج علام', 'souqnamarketplace@gmail.com', 'سوق نا - السائق',
 'تمام، ممكن رقمك للتواصل في حال أي طارئ؟',
 true, 'text', 'seed-data', NOW() - INTERVAL '20 hours'),

('conv-eng-souq-001', 'souqnamarketplace@gmail.com', 'سوق نا - السائق', 'engallam27@gmail.com', 'إنج علام',
 'بالطبع: 0599123456 - واتساب أيضاً',
 true, 'text', 'seed-data', NOW() - INTERVAL '19 hours'),

('conv-eng-souq-001', 'engallam27@gmail.com', 'إنج علام', 'souqnamarketplace@gmail.com', 'سوق نا - السائق',
 'شكراً جزيلاً، إن شاء الله نلتقي بكرة',
 true, 'text', 'seed-data', NOW() - INTERVAL '18 hours'),

('conv-eng-souq-001', 'souqnamarketplace@gmail.com', 'سوق نا - السائق', 'engallam27@gmail.com', 'إنج علام',
 'السيارة فضية تويوتا كامري لوحة 6-1234-95',
 false, 'text', 'seed-data', NOW() - INTERVAL '2 hours');


-- ── 6) NOTIFICATIONS (mix for both users) ──
DELETE FROM public.notifications WHERE created_by = 'seed-data';

INSERT INTO public.notifications (
  user_email, title, message, type, is_read, from_city, to_city, created_by, created_at
) VALUES
-- For engallam (passenger)
('engallam27@gmail.com', '🎉 تم تأكيد حجزك',
 'تم تأكيد حجزك في رحلة سوق نا من نابلس إلى رام الله غداً الساعة 5:00 مساءً',
 'system', false, 'نابلس', 'رام الله', 'seed-data', NOW() - INTERVAL '6 hours'),

('engallam27@gmail.com', '⭐ كيف كانت رحلتك؟',
 'اكتملت رحلتك من رام الله إلى بيت لحم. قيّم تجربتك مع السائق!',
 'system', false, 'رام الله', 'بيت لحم', 'seed-data', NOW() - INTERVAL '14 days'),

('engallam27@gmail.com', 'رحلة جديدة على مسارك المفضل',
 'رحلة من نابلس إلى رام الله متاحة الآن - السعر ₪35',
 'new_trip', true, 'نابلس', 'رام الله', 'seed-data', NOW() - INTERVAL '2 days'),

-- For souqnamarketplace (driver)
('souqnamarketplace@gmail.com', '🎉 حجز جديد لرحلتك',
 'إنج علام حجز مقعد في رحلتك من نابلس إلى رام الله',
 'system', false, 'نابلس', 'رام الله', 'seed-data', NOW() - INTERVAL '1 day'),

('souqnamarketplace@gmail.com', '⭐ تقييم جديد لرحلتك',
 'إنج علام أعطاك تقييم 5 نجوم على رحلة نابلس → رام الله',
 'system', true, 'نابلس', 'رام الله', 'seed-data', NOW() - INTERVAL '6 days'),

('souqnamarketplace@gmail.com', '✅ رخصتك موافق عليها!',
 'تم الموافقة على رخصة القيادة الخاصة بك. يمكنك الآن نشر الرحلات.',
 'system', true, NULL, NULL, 'seed-data', NOW() - INTERVAL '88 days');


-- ── 7) TRIP PREFERENCES (engallam follows a route) ──
DELETE FROM public.trip_preferences WHERE created_by = 'seed-data';

INSERT INTO public.trip_preferences (
  user_email, user_name, from_city, to_city, max_price,
  notify_on_price, notify_on_date, is_active, created_by
) VALUES
('engallam27@gmail.com', 'إنج علام', 'نابلس', 'رام الله', 50, true, true, true, '[]'::jsonb, 'seed-data'),
('engallam27@gmail.com', 'إنج علام', 'رام الله', 'نابلس', 50, true, true, true, '[]'::jsonb, 'seed-data');


-- ── 8) ANNOUNCEMENT ──
INSERT INTO public.announcements (text, is_active, created_by)
SELECT '🌟 مرحباً بك في مِشوار - منصة مشاركة الرحلات الفلسطينية. تخفيض 10% على أول رحلة!', true, '[]'::jsonb, 'seed-data'
WHERE NOT EXISTS (SELECT 1 FROM public.announcements WHERE text LIKE '%مرحباً بك في مِشوار%');


-- ── 9) Verification — print summary ──
DO $$
DECLARE
  trips_count   INTEGER;
  bookings_count INTEGER;
  reviews_count  INTEGER;
  messages_count INTEGER;
  notifs_count   INTEGER;
BEGIN
  SELECT count(*) INTO trips_count    FROM public.trips    WHERE driver_email = 'souqnamarketplace@gmail.com';
  SELECT count(*) INTO bookings_count FROM public.bookings WHERE passenger_email = 'engallam27@gmail.com';
  SELECT count(*) INTO reviews_count  FROM public.reviews  WHERE created_by = 'seed-data';
  SELECT count(*) INTO messages_count FROM public.messages WHERE created_by = 'seed-data';
  SELECT count(*) INTO notifs_count   FROM public.notifications WHERE created_by = 'seed-data';

  RAISE NOTICE '✅ Seed complete:';
  RAISE NOTICE '   • % trips (souqnamarketplace as driver)', trips_count;
  RAISE NOTICE '   • % bookings (engallam27 as passenger)', bookings_count;
  RAISE NOTICE '   • % reviews', reviews_count;
  RAISE NOTICE '   • % messages', messages_count;
  RAISE NOTICE '   • % notifications', notifs_count;
END $$;
