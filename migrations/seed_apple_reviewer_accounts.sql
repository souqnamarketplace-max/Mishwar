-- ════════════════════════════════════════════════════════════════════════
-- Apple Reviewer Demo Accounts — Setup Script
-- ════════════════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor AFTER you've signed up these 3 accounts
-- via the normal signup flow at https://www.mishwaro.com:
--
--   1. reviewer-passenger@mishwaro.com  (password: AppleReview2026!)
--   2. reviewer-driver@mishwaro.com     (password: AppleReview2026!)
--   3. reviewer-admin@mishwaro.com      (password: AppleReview2026!)
--
-- WHY SIGN UP VIA UI FIRST?
-- Supabase Auth handles password hashing, email confirmation tokens, and
-- a bunch of internal session setup that you can't easily replicate via
-- raw INSERT INTO auth.users. Signing up through the UI does this for you.
-- This script then upgrades roles, seeds verification, and creates demo
-- trips / bookings / reviews / messages so reviewers see a populated app.
--
-- WHAT THIS SCRIPT DOES:
--   1. Marks reviewer-admin@mishwaro.com as role=admin
--   2. Marks reviewer-driver@mishwaro.com as account_type=driver,
--      onboarding complete, verification approved
--   3. Marks reviewer-passenger@mishwaro.com as onboarding complete
--   4. Inserts 3 demo trips posted by the driver
--      (Ramallah→Nablus, Nablus→القدس, Ramallah→Hebron-completed)
--   5. Inserts 1 confirmed booking from passenger on the completed trip
--   6. Inserts 1 5-star review from passenger on the completed trip
--   7. Inserts a sample message thread between driver and passenger
--   8. Inserts the approved driver_licenses record (so verification UI
--      shows "verified" badge)
--
-- IDEMPOTENT: safe to run multiple times. Uses ON CONFLICT and WHERE
-- clauses to avoid duplicates if accounts already exist or trips were
-- already seeded.
-- ════════════════════════════════════════════════════════════════════════


-- ─── 1. UPGRADE ROLES ─────────────────────────────────────────────────

-- Admin: full dashboard access
UPDATE public.profiles
SET
  role                 = 'admin',
  full_name            = COALESCE(full_name, 'Apple Reviewer Admin'),
  onboarding_completed = TRUE,
  is_active            = TRUE,
  updated_at           = NOW()
WHERE email = 'reviewer-admin@mishwaro.com';

-- Driver: account_type=driver, verified, complete profile
UPDATE public.profiles
SET
  account_type         = 'driver',
  full_name            = COALESCE(full_name, 'Apple Reviewer Driver'),
  phone                = COALESCE(phone, '+970-599-100001'),
  city                 = 'رام الله',
  gender               = 'male',
  bio                  = 'حساب توضيحي لمراجعة Apple — سائق موثق على مشوارو',
  car_model            = 'Toyota Corolla',
  car_year             = '2020',
  car_color            = 'أبيض',
  car_plate            = '12-345-67',
  driver_note          = 'سائق محترم، رحلات منتظمة بين رام الله ونابلس',
  onboarding_completed = TRUE,
  verification_pending = FALSE,
  is_active            = TRUE,
  total_rating         = 5.0,
  total_reviews        = 1,
  updated_at           = NOW()
WHERE email = 'reviewer-driver@mishwaro.com';

-- Passenger: full profile, ready to book
UPDATE public.profiles
SET
  account_type         = 'passenger',
  full_name            = COALESCE(full_name, 'Apple Reviewer Passenger'),
  phone                = COALESCE(phone, '+970-599-100002'),
  city                 = 'نابلس',
  gender               = 'male',
  bio                  = 'حساب توضيحي لمراجعة Apple — مسافر',
  onboarding_completed = TRUE,
  is_active            = TRUE,
  updated_at           = NOW()
WHERE email = 'reviewer-passenger@mishwaro.com';


-- ─── 2. APPROVED DRIVER LICENSE (so verified-badge shows) ─────────────

INSERT INTO public.driver_licenses (
  driver_email,
  driver_name,
  license_number,
  expiry_date,
  car_registration_expiry_date,
  insurance_expiry_date,
  license_image_url,
  car_registration_url,
  insurance_url,
  selfie_1_url,
  selfie_2_url,
  status,
  submitted_at,
  approved_at,
  approved_by,
  created_by
)
SELECT
  'reviewer-driver@mishwaro.com',
  'Apple Reviewer Driver',
  'DEMO-LICENSE-001',
  (NOW() + INTERVAL '5 years')::date,
  (NOW() + INTERVAL '5 years')::date,
  (NOW() + INTERVAL '2 years')::date,
  'https://www.mishwaro.com/logo.png',  -- placeholder; reviewers don't see this
  'https://www.mishwaro.com/logo.png',
  'https://www.mishwaro.com/logo.png',
  'https://www.mishwaro.com/logo.png',
  'https://www.mishwaro.com/logo.png',  -- selfie_2_url (production has NOT NULL constraint)
  'approved',
  NOW() - INTERVAL '7 days',
  NOW() - INTERVAL '6 days',
  'souqnamarketplace@gmail.com',
  'reviewer-driver@mishwaro.com'
WHERE NOT EXISTS (
  SELECT 1 FROM public.driver_licenses
  WHERE driver_email = 'reviewer-driver@mishwaro.com'
);


-- ─── 3. DEMO TRIPS POSTED BY DRIVER ───────────────────────────────────

-- TRIP 1: Upcoming (7 days from now) — passenger can see + book
INSERT INTO public.trips (
  created_by, driver_name, driver_email, driver_phone, driver_rating,
  driver_reviews_count, driver_trips_count, driver_gender,
  from_city, to_city, date, time, price,
  available_seats, total_seats,
  car_model, car_year, car_color, car_plate,
  status, payment_methods, is_direct, driver_note
)
SELECT
  'reviewer-driver@mishwaro.com',
  'Apple Reviewer Driver',
  'reviewer-driver@mishwaro.com',
  '+970-599-100001',
  5.0, 1, 3, 'male',
  'رام الله', 'نابلس',
  (NOW() + INTERVAL '7 days')::date,
  '09:00',
  25,
  3, 4,
  'Toyota Corolla', '2020', 'أبيض', '12-345-67',
  'confirmed',
  '["cash","jawwal_pay","bank_transfer"]'::jsonb,
  TRUE,
  'انطلاق من المنارة، رام الله. توقف ممكن عند مفترق حوارة.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.trips
  WHERE driver_email = 'reviewer-driver@mishwaro.com'
    AND from_city = 'رام الله'
    AND to_city = 'نابلس'
    AND date >= CURRENT_DATE
);

-- TRIP 2: Upcoming (14 days from now) — different route
INSERT INTO public.trips (
  created_by, driver_name, driver_email, driver_phone, driver_rating,
  driver_reviews_count, driver_trips_count, driver_gender,
  from_city, to_city, date, time, price,
  available_seats, total_seats,
  car_model, car_year, car_color, car_plate,
  status, payment_methods, is_direct, driver_note
)
SELECT
  'reviewer-driver@mishwaro.com',
  'Apple Reviewer Driver',
  'reviewer-driver@mishwaro.com',
  '+970-599-100001',
  5.0, 1, 3, 'male',
  'نابلس', 'القدس',
  (NOW() + INTERVAL '14 days')::date,
  '16:00',
  35,
  2, 4,
  'Toyota Corolla', '2020', 'أبيض', '12-345-67',
  'confirmed',
  '["cash","jawwal_pay"]'::jsonb,
  TRUE,
  'الانطلاق من دوار الشهداء، نابلس. التوقف عند نقطة قلنديا.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.trips
  WHERE driver_email = 'reviewer-driver@mishwaro.com'
    AND from_city = 'نابلس'
    AND to_city = 'القدس'
    AND date >= CURRENT_DATE
);

-- TRIP 3: Already completed (7 days ago) — for review system demo
INSERT INTO public.trips (
  created_by, driver_name, driver_email, driver_phone, driver_rating,
  driver_reviews_count, driver_trips_count, driver_gender,
  from_city, to_city, date, time, price,
  available_seats, total_seats,
  car_model, car_year, car_color, car_plate,
  status, payment_methods, is_direct, driver_note
)
SELECT
  'reviewer-driver@mishwaro.com',
  'Apple Reviewer Driver',
  'reviewer-driver@mishwaro.com',
  '+970-599-100001',
  5.0, 1, 3, 'male',
  'رام الله', 'الخليل',
  (NOW() - INTERVAL '7 days')::date,
  '08:00',
  45,
  0, 4,                     -- 0 seats left = was fully booked
  'Toyota Corolla', '2020', 'أبيض', '12-345-67',
  'completed',
  '["cash","jawwal_pay"]'::jsonb,
  TRUE,
  'رحلة مكتملة — سعدنا بالخدمة'
WHERE NOT EXISTS (
  SELECT 1 FROM public.trips
  WHERE driver_email = 'reviewer-driver@mishwaro.com'
    AND from_city = 'رام الله'
    AND to_city = 'الخليل'
    AND status = 'completed'
);


-- ─── 4. BOOKING — passenger booked the completed trip ────────────────

INSERT INTO public.bookings (
  created_by, trip_id, passenger_name, passenger_email,
  seats_booked, total_price, status,
  payment_method, payment_status, paid_at,
  pickup_city, notes
)
SELECT
  'reviewer-passenger@mishwaro.com',
  t.id::text,
  'Apple Reviewer Passenger',
  'reviewer-passenger@mishwaro.com',
  1, 45,
  'completed',
  'cash', 'paid',
  (NOW() - INTERVAL '7 days'),
  'رام الله',
  'سأكون عند مفترق المنارة الساعة 8 صباحاً'
FROM public.trips t
WHERE t.driver_email = 'reviewer-driver@mishwaro.com'
  AND t.from_city = 'رام الله'
  AND t.to_city = 'الخليل'
  AND t.status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.trip_id = t.id::text
      AND b.passenger_email = 'reviewer-passenger@mishwaro.com'
  )
LIMIT 1;


-- ─── 5. REVIEW — passenger left 5-star review on completed trip ──────

INSERT INTO public.reviews (
  created_by, trip_id,
  reviewer_name, reviewer_email,
  driver_email, rated_user_email,
  review_type, rating, comment
)
SELECT
  'reviewer-passenger@mishwaro.com',
  t.id::text,
  'Apple Reviewer Passenger',
  'reviewer-passenger@mishwaro.com',
  'reviewer-driver@mishwaro.com',
  'reviewer-driver@mishwaro.com',
  'passenger_rates_driver',
  5,
  'سائق ممتاز، انطلاق في الموعد، السيارة نظيفة، تواصل محترم. أنصح به بشدة.'
FROM public.trips t
WHERE t.driver_email = 'reviewer-driver@mishwaro.com'
  AND t.from_city = 'رام الله'
  AND t.to_city = 'الخليل'
  AND t.status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM public.reviews r
    WHERE r.trip_id = t.id::text
      AND r.reviewer_email = 'reviewer-passenger@mishwaro.com'
  )
LIMIT 1;


-- ─── 6. MESSAGE THREAD — driver ↔ passenger sample conversation ──────

-- Find the upcoming Ramallah→Nablus trip to attach messages to
WITH upcoming_trip AS (
  SELECT id FROM public.trips
  WHERE driver_email = 'reviewer-driver@mishwaro.com'
    AND from_city = 'رام الله'
    AND to_city = 'نابلس'
    AND date >= CURRENT_DATE
  ORDER BY date ASC
  LIMIT 1
),
-- Conversation_id: deterministic so re-runs don't dupe
conv AS (
  SELECT 'reviewer-driver-passenger-' || (SELECT id FROM upcoming_trip)::text AS cid
)
INSERT INTO public.messages (
  created_by, conversation_id, trip_id,
  sender_email, sender_name, receiver_email, receiver_name,
  content, message_type, is_read
)
SELECT *
FROM (
  VALUES
    (
      'reviewer-driver@mishwaro.com',
      (SELECT cid FROM conv),
      (SELECT id::text FROM upcoming_trip),
      'reviewer-driver@mishwaro.com', 'Apple Reviewer Driver',
      'reviewer-passenger@mishwaro.com', 'Apple Reviewer Passenger',
      'أهلاً، أنا منطلق من رام الله الساعة 9 صباحاً',
      'text', TRUE
    ),
    (
      'reviewer-passenger@mishwaro.com',
      (SELECT cid FROM conv),
      (SELECT id::text FROM upcoming_trip),
      'reviewer-passenger@mishwaro.com', 'Apple Reviewer Passenger',
      'reviewer-driver@mishwaro.com', 'Apple Reviewer Driver',
      'ممتاز، سأكون عند مفترق المنارة الساعة 8:55',
      'text', TRUE
    ),
    (
      'reviewer-driver@mishwaro.com',
      (SELECT cid FROM conv),
      (SELECT id::text FROM upcoming_trip),
      'reviewer-driver@mishwaro.com', 'Apple Reviewer Driver',
      'reviewer-passenger@mishwaro.com', 'Apple Reviewer Passenger',
      'تمام، رحلة سعيدة',
      'text', TRUE
    )
) AS v(created_by, conversation_id, trip_id,
       sender_email, sender_name, receiver_email, receiver_name,
       content, message_type, is_read)
WHERE NOT EXISTS (
  SELECT 1 FROM public.messages m
  WHERE m.sender_email   IN ('reviewer-driver@mishwaro.com','reviewer-passenger@mishwaro.com')
    AND m.receiver_email IN ('reviewer-driver@mishwaro.com','reviewer-passenger@mishwaro.com')
);


-- ─── 7. VERIFY EVERYTHING ────────────────────────────────────────────

DO $$
DECLARE
  admin_ok      BOOLEAN;
  driver_ok     BOOLEAN;
  passenger_ok  BOOLEAN;
  license_ok    BOOLEAN;
  trips_count   INTEGER;
  booking_ok    BOOLEAN;
  review_ok     BOOLEAN;
  messages_count INTEGER;
BEGIN
  SELECT (role = 'admin') INTO admin_ok
    FROM public.profiles WHERE email = 'reviewer-admin@mishwaro.com';
  SELECT (account_type = 'driver' AND onboarding_completed) INTO driver_ok
    FROM public.profiles WHERE email = 'reviewer-driver@mishwaro.com';
  SELECT (onboarding_completed) INTO passenger_ok
    FROM public.profiles WHERE email = 'reviewer-passenger@mishwaro.com';
  SELECT EXISTS (
    SELECT 1 FROM public.driver_licenses
    WHERE driver_email = 'reviewer-driver@mishwaro.com' AND status = 'approved'
  ) INTO license_ok;
  SELECT COUNT(*) INTO trips_count
    FROM public.trips WHERE driver_email = 'reviewer-driver@mishwaro.com';
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE passenger_email = 'reviewer-passenger@mishwaro.com'
  ) INTO booking_ok;
  SELECT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE reviewer_email = 'reviewer-passenger@mishwaro.com'
  ) INTO review_ok;
  SELECT COUNT(*) INTO messages_count
    FROM public.messages
    WHERE sender_email IN ('reviewer-driver@mishwaro.com','reviewer-passenger@mishwaro.com');

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE 'APPLE REVIEWER DEMO DATA — SETUP REPORT';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE 'Admin role set:           %', admin_ok;
  RAISE NOTICE 'Driver verified+onboarded: %', driver_ok;
  RAISE NOTICE 'Passenger onboarded:      %', passenger_ok;
  RAISE NOTICE 'Driver license approved:  %', license_ok;
  RAISE NOTICE 'Trips seeded:             % (expected 3)', trips_count;
  RAISE NOTICE 'Booking exists:           %', booking_ok;
  RAISE NOTICE 'Review exists:            %', review_ok;
  RAISE NOTICE 'Messages seeded:          % (expected 3)', messages_count;
  RAISE NOTICE '═══════════════════════════════════════════════════════';

  IF NOT (admin_ok AND driver_ok AND passenger_ok AND license_ok
          AND trips_count >= 3 AND booking_ok AND review_ok AND messages_count >= 3) THEN
    RAISE WARNING 'Some demo data is missing — review the report above.';
  ELSE
    RAISE NOTICE '✅ All demo data ready for Apple review.';
  END IF;
END $$;
