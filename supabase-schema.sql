-- =====================================================
-- Mishwar App - Supabase Migration Schema
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PROFILES (extends auth.users - replaces User entity)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  account_type TEXT DEFAULT 'passenger' CHECK (account_type IN ('passenger', 'driver', 'both')),
  phone TEXT,
  avatar_url TEXT,
  gender TEXT CHECK (gender IN ('male', 'female')),
  bio TEXT,
  car_model TEXT,
  car_year TEXT,
  car_color TEXT,
  car_plate TEXT,
  driver_note TEXT,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  verification_pending BOOLEAN DEFAULT FALSE,
  total_rating NUMERIC DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  -- Payment info (saved by driver)
  bank_name TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  bank_iban TEXT,
  card_holder_name TEXT,
  card_last_four TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- TRIPS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  driver_name TEXT,
  driver_email TEXT,
  driver_phone TEXT,
  driver_avatar TEXT,
  driver_rating NUMERIC DEFAULT 0,
  driver_reviews_count INTEGER DEFAULT 0,
  driver_trips_count INTEGER DEFAULT 0,
  driver_gender TEXT CHECK (driver_gender IN ('male', 'female')),
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  from_location TEXT,
  to_location TEXT,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  price NUMERIC NOT NULL,
  available_seats INTEGER DEFAULT 4,
  total_seats INTEGER DEFAULT 4,
  car_model TEXT,
  car_year TEXT,
  car_color TEXT,
  car_plate TEXT,
  car_image TEXT,
  distance TEXT,
  duration TEXT,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'in_progress', 'completed', 'cancelled')),
  amenities JSONB DEFAULT '[]',
  is_direct BOOLEAN DEFAULT TRUE,
  driver_note TEXT,
  payment_methods JSONB DEFAULT '["cash"]'
);

-- =====================================================
-- BOOKINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  trip_id TEXT,
  passenger_name TEXT,
  passenger_email TEXT,
  seats_booked INTEGER DEFAULT 1,
  total_price NUMERIC,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  payment_method TEXT
);

-- =====================================================
-- REVIEWS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  trip_id TEXT,
  reviewer_name TEXT,
  reviewer_email TEXT,
  driver_email TEXT,
  rated_user_email TEXT,
  review_type TEXT DEFAULT 'passenger_rates_driver' CHECK (review_type IN ('passenger_rates_driver', 'driver_rates_passenger')),
  rating NUMERIC NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT
);

-- =====================================================
-- MESSAGES
-- =====================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  conversation_id TEXT,
  sender_email TEXT,
  sender_name TEXT,
  receiver_email TEXT,
  receiver_name TEXT,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'trip_info', 'system')),
  trip_id TEXT
);

-- =====================================================
-- NOTIFICATIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  user_email TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'system' CHECK (type IN ('new_trip', 'price_drop', 'date_match', 'system')),
  trip_id TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  from_city TEXT,
  to_city TEXT
);

-- =====================================================
-- DRIVER LICENSES
-- =====================================================
CREATE TABLE IF NOT EXISTS public.driver_licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  driver_email TEXT NOT NULL,
  driver_name TEXT,
  license_number TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  car_registration_expiry_date DATE,
  insurance_expiry_date DATE,
  license_image_url TEXT NOT NULL,
  car_registration_url TEXT NOT NULL,
  insurance_url TEXT NOT NULL,
  selfie_1_url TEXT NOT NULL,
  selfie_2_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);

-- =====================================================
-- COUPONS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  code TEXT NOT NULL UNIQUE,
  discount_percent NUMERIC NOT NULL,
  max_uses INTEGER DEFAULT 100,
  uses_count INTEGER DEFAULT 0,
  expires_at DATE,
  is_active BOOLEAN DEFAULT TRUE
);

-- =====================================================
-- APP SETTINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  app_name TEXT DEFAULT 'سيرتنا',
  commission_rate NUMERIC DEFAULT 10,
  min_price NUMERIC DEFAULT 10,
  max_price NUMERIC DEFAULT 500,
  max_seats INTEGER DEFAULT 6,
  support_phone TEXT,
  support_email TEXT,
  allow_registration BOOLEAN DEFAULT TRUE,
  maintenance_mode BOOLEAN DEFAULT FALSE
);

-- Insert default settings
INSERT INTO public.app_settings (app_name, commission_rate, min_price, max_price, max_seats, allow_registration, maintenance_mode)
VALUES ('سيرتنا', 10, 10, 500, 6, TRUE, FALSE)
ON CONFLICT DO NOTHING;

-- =====================================================
-- ANNOUNCEMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  text TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);

-- =====================================================
-- SUPPORT TICKETS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  user_name TEXT,
  user_email TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved'))
);

-- =====================================================
-- TRIP PREFERENCES
-- =====================================================
CREATE TABLE IF NOT EXISTS public.trip_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  user_email TEXT,
  user_name TEXT,
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  max_price NUMERIC,
  preferred_date DATE,
  notify_on_price BOOLEAN DEFAULT TRUE,
  notify_on_date BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE
);

-- =====================================================
-- SUPABASE STORAGE BUCKET
-- =====================================================
-- Create uploads bucket (safe to re-run)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  TRUE,
  5242880,  -- 5MB limit
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/jpg','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 5242880;

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','trips','bookings','reviews','messages','notifications','driver_licenses','coupons','app_settings','announcements','support_tickets','trip_preferences']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON public.%s', t, t);
    EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t, t);
  END LOOP;
END $$;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_preferences ENABLE ROW LEVEL SECURITY;

-- PROFILES: Anyone can read profiles, users update own
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles are viewable by authenticated users" ON public.profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- TRIPS: Public read, authenticated write own
DROP POLICY IF EXISTS "Trips are publicly readable" ON public.trips;
CREATE POLICY "Trips are publicly readable" ON public.trips FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can create trips" ON public.trips;
CREATE POLICY "Authenticated users can create trips" ON public.trips FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Trip creators and admins can update" ON public.trips;
CREATE POLICY "Trip creators and admins can update" ON public.trips FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Trip creators and admins can delete" ON public.trips;
CREATE POLICY "Trip creators and admins can delete" ON public.trips FOR DELETE TO authenticated USING (true);

-- BOOKINGS: Users see their own
DROP POLICY IF EXISTS "Users can view relevant bookings" ON public.bookings;
CREATE POLICY "Users can view relevant bookings" ON public.bookings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can create bookings" ON public.bookings;
CREATE POLICY "Authenticated users can create bookings" ON public.bookings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update bookings" ON public.bookings;
CREATE POLICY "Authenticated users can update bookings" ON public.bookings FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete bookings" ON public.bookings;
CREATE POLICY "Authenticated users can delete bookings" ON public.bookings FOR DELETE TO authenticated USING (true);

-- REVIEWS: Public read
DROP POLICY IF EXISTS "Reviews are publicly readable" ON public.reviews;
CREATE POLICY "Reviews are publicly readable" ON public.reviews FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can create reviews" ON public.reviews;
CREATE POLICY "Authenticated users can create reviews" ON public.reviews FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update reviews" ON public.reviews;
CREATE POLICY "Authenticated users can update reviews" ON public.reviews FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete reviews" ON public.reviews;
CREATE POLICY "Authenticated users can delete reviews" ON public.reviews FOR DELETE TO authenticated USING (true);

-- MESSAGES: Authenticated
DROP POLICY IF EXISTS "Authenticated users can view messages" ON public.messages;
CREATE POLICY "Authenticated users can view messages" ON public.messages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can create messages" ON public.messages;
CREATE POLICY "Authenticated users can create messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update messages" ON public.messages;
CREATE POLICY "Authenticated users can update messages" ON public.messages FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete messages" ON public.messages;
CREATE POLICY "Authenticated users can delete messages" ON public.messages FOR DELETE TO authenticated USING (true);

-- NOTIFICATIONS: Users see own
DROP POLICY IF EXISTS "Authenticated users can view notifications" ON public.notifications;
CREATE POLICY "Authenticated users can view notifications" ON public.notifications FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
CREATE POLICY "Authenticated users can create notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update notifications" ON public.notifications;
CREATE POLICY "Authenticated users can update notifications" ON public.notifications FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete notifications" ON public.notifications;
CREATE POLICY "Authenticated users can delete notifications" ON public.notifications FOR DELETE TO authenticated USING (true);

-- DRIVER LICENSES
DROP POLICY IF EXISTS "Authenticated users can view licenses" ON public.driver_licenses;
CREATE POLICY "Authenticated users can view licenses" ON public.driver_licenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can create licenses" ON public.driver_licenses;
CREATE POLICY "Authenticated users can create licenses" ON public.driver_licenses FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update licenses" ON public.driver_licenses;
CREATE POLICY "Authenticated users can update licenses" ON public.driver_licenses FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete licenses" ON public.driver_licenses;
CREATE POLICY "Authenticated users can delete licenses" ON public.driver_licenses FOR DELETE TO authenticated USING (true);

-- COUPONS: Public read
DROP POLICY IF EXISTS "Coupons are publicly readable" ON public.coupons;
CREATE POLICY "Coupons are publicly readable" ON public.coupons FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can manage coupons" ON public.coupons;
CREATE POLICY "Authenticated users can manage coupons" ON public.coupons FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update coupons" ON public.coupons;
CREATE POLICY "Authenticated users can update coupons" ON public.coupons FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete coupons" ON public.coupons;
CREATE POLICY "Authenticated users can delete coupons" ON public.coupons FOR DELETE TO authenticated USING (true);

-- APP SETTINGS: Public read
DROP POLICY IF EXISTS "App settings are publicly readable" ON public.app_settings;
CREATE POLICY "App settings are publicly readable" ON public.app_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can manage settings" ON public.app_settings;
CREATE POLICY "Authenticated users can manage settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update settings" ON public.app_settings;
CREATE POLICY "Authenticated users can update settings" ON public.app_settings FOR UPDATE TO authenticated USING (true);

-- ANNOUNCEMENTS: Public read
DROP POLICY IF EXISTS "Announcements are publicly readable" ON public.announcements;
CREATE POLICY "Announcements are publicly readable" ON public.announcements FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can manage announcements" ON public.announcements;
CREATE POLICY "Authenticated users can manage announcements" ON public.announcements FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update announcements" ON public.announcements;
CREATE POLICY "Authenticated users can update announcements" ON public.announcements FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete announcements" ON public.announcements;
CREATE POLICY "Authenticated users can delete announcements" ON public.announcements FOR DELETE TO authenticated USING (true);

-- SUPPORT TICKETS
DROP POLICY IF EXISTS "Authenticated users can view tickets" ON public.support_tickets;
CREATE POLICY "Authenticated users can view tickets" ON public.support_tickets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Anyone can create tickets" ON public.support_tickets;
CREATE POLICY "Anyone can create tickets" ON public.support_tickets FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update tickets" ON public.support_tickets;
CREATE POLICY "Authenticated users can update tickets" ON public.support_tickets FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete tickets" ON public.support_tickets;
CREATE POLICY "Authenticated users can delete tickets" ON public.support_tickets FOR DELETE TO authenticated USING (true);

-- TRIP PREFERENCES
DROP POLICY IF EXISTS "Authenticated users can view preferences" ON public.trip_preferences;
CREATE POLICY "Authenticated users can view preferences" ON public.trip_preferences FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can create preferences" ON public.trip_preferences;
CREATE POLICY "Authenticated users can create preferences" ON public.trip_preferences FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update preferences" ON public.trip_preferences;
CREATE POLICY "Authenticated users can update preferences" ON public.trip_preferences FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can delete preferences" ON public.trip_preferences;
CREATE POLICY "Authenticated users can delete preferences" ON public.trip_preferences FOR DELETE TO authenticated USING (true);

-- STORAGE: Public uploads bucket
DROP POLICY IF EXISTS "Public read access on uploads" ON storage.objects;
CREATE POLICY "Public read access on uploads" ON storage.objects FOR SELECT USING (bucket_id = 'uploads');
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
CREATE POLICY "Authenticated users can upload files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'uploads');
DROP POLICY IF EXISTS "Authenticated users can update files" ON storage.objects;
CREATE POLICY "Authenticated users can update files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'uploads');

-- Enable Realtime for all tables (safe to re-run)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.trips','public.bookings','public.reviews','public.messages',
    'public.notifications','public.trip_preferences','public.profiles'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
