-- ============================================================
-- MISHWAR — COMPLETE PRODUCTION SQL
-- Run this ONE file in Supabase SQL Editor.
-- Safe to re-run (all statements are idempotent).
-- ============================================================

-- ============================================================
-- PART 1: EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PART 2: HELPER — get current user's email from auth.uid()
-- Used in RLS policies throughout
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_user_email()
RETURNS TEXT AS $$
  SELECT email FROM auth.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PART 3: TABLES (CREATE IF NOT EXISTS — safe to re-run)
-- ============================================================

-- PROFILES (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id                   UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email                TEXT,
  full_name            TEXT,
  role                 TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  account_type         TEXT DEFAULT 'passenger' CHECK (account_type IN ('passenger', 'driver', 'both')),
  phone                TEXT,
  city                 TEXT,
  avatar_url           TEXT,
  gender               TEXT CHECK (gender IN ('male', 'female')),
  bio                  TEXT,
  car_model            TEXT,
  car_year             TEXT,
  car_color            TEXT,
  car_plate            TEXT,
  driver_note          TEXT,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  verification_pending BOOLEAN DEFAULT FALSE,
  total_rating         NUMERIC DEFAULT 0,
  total_reviews        INTEGER DEFAULT 0,
  is_active            BOOLEAN DEFAULT TRUE,
  bank_name            TEXT,
  bank_account_name    TEXT,
  bank_account_number  TEXT,
  bank_iban            TEXT,
  card_holder_name     TEXT,
  card_last_four       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           TEXT
);
-- Idempotent migration: add city column if missing (for DBs created before this change)
DO $$
BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- TRIPS
CREATE TABLE IF NOT EXISTS public.trips (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by           TEXT,
  driver_name          TEXT,
  driver_email         TEXT,
  driver_phone         TEXT,
  driver_avatar        TEXT,
  driver_rating        NUMERIC DEFAULT 0,
  driver_reviews_count INTEGER DEFAULT 0,
  driver_trips_count   INTEGER DEFAULT 0,
  driver_gender        TEXT CHECK (driver_gender IN ('male', 'female')),
  from_city            TEXT NOT NULL CHECK (length(from_city) <= 100),
  to_city              TEXT NOT NULL CHECK (length(to_city) <= 100),
  from_location        TEXT CHECK (length(from_location) <= 200),
  to_location          TEXT CHECK (length(to_location) <= 200),
  date                 DATE NOT NULL,
  time                 TEXT NOT NULL,
  price                NUMERIC NOT NULL CHECK (price >= 0 AND price <= 10000),
  available_seats      INTEGER DEFAULT 4 CHECK (available_seats >= 0 AND available_seats <= 20),
  total_seats          INTEGER DEFAULT 4 CHECK (total_seats >= 1 AND total_seats <= 20),
  car_model            TEXT,
  car_year             TEXT,
  car_color            TEXT,
  car_plate            TEXT,
  car_image            TEXT,
  distance             TEXT,
  duration             TEXT,
  status               TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','in_progress','completed','cancelled')),
  amenities            JSONB DEFAULT '[]',
  is_direct            BOOLEAN DEFAULT TRUE,
  driver_note          TEXT CHECK (length(driver_note) <= 1000),
  payment_methods      JSONB DEFAULT '["cash"]',
  has_checkpoint       BOOLEAN DEFAULT FALSE,
  checkpoint_note      TEXT CHECK (length(checkpoint_note) <= 500),
  is_recurring         BOOLEAN DEFAULT FALSE,
  recurring_days       JSONB DEFAULT '[]'
);

-- BOOKINGS
CREATE TABLE IF NOT EXISTS public.bookings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       TEXT,
  trip_id          TEXT,
  passenger_name   TEXT CHECK (length(passenger_name) <= 200),
  passenger_email  TEXT,
  seats_booked     INTEGER DEFAULT 1 CHECK (seats_booked >= 1 AND seats_booked <= 10),
  total_price      NUMERIC CHECK (total_price >= 0),
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  payment_method   TEXT
);

-- REVIEWS
CREATE TABLE IF NOT EXISTS public.reviews (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  trip_id           TEXT,
  reviewer_name     TEXT,
  reviewer_email    TEXT,
  driver_email      TEXT,
  rated_user_email  TEXT,
  review_type       TEXT DEFAULT 'passenger_rates_driver' CHECK (review_type IN ('passenger_rates_driver','driver_rates_passenger')),
  rating            NUMERIC NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment           TEXT CHECK (length(comment) <= 2000)
);

-- MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  conversation_id TEXT,
  sender_email    TEXT,
  sender_name     TEXT,
  receiver_email  TEXT,
  receiver_name   TEXT,
  content         TEXT NOT NULL CHECK (length(content) <= 5000),
  is_read         BOOLEAN DEFAULT FALSE,
  message_type    TEXT DEFAULT 'text' CHECK (message_type IN ('text','trip_info','system')),
  trip_id         TEXT
);

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  user_email TEXT NOT NULL,
  title      TEXT NOT NULL CHECK (length(title) <= 500),
  message    TEXT NOT NULL CHECK (length(message) <= 2000),
  type       TEXT DEFAULT 'system' CHECK (type IN ('new_trip','price_drop','date_match','system')),
  trip_id    TEXT,
  is_read    BOOLEAN DEFAULT FALSE,
  from_city  TEXT,
  to_city    TEXT
);

-- DRIVER LICENSES
CREATE TABLE IF NOT EXISTS public.driver_licenses (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                    TEXT,
  driver_email                  TEXT NOT NULL,
  driver_name                   TEXT,
  license_number                TEXT NOT NULL,
  expiry_date                   DATE NOT NULL,
  car_registration_expiry_date  DATE,
  insurance_expiry_date         DATE,
  license_image_url             TEXT,
  car_registration_url          TEXT,
  insurance_url                 TEXT,
  selfie_1_url                  TEXT,
  selfie_2_url                  TEXT,
  status                        TEXT DEFAULT 'incomplete' CHECK (status IN ('incomplete','pending','approved','rejected')),
  rejection_reason              TEXT,
  submitted_at                  TIMESTAMPTZ DEFAULT NOW(),
  approved_at                   TIMESTAMPTZ,
  approved_by                   TEXT
);

-- COUPONS
CREATE TABLE IF NOT EXISTS public.coupons (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       TEXT,
  code             TEXT NOT NULL UNIQUE CHECK (length(code) <= 50),
  discount_percent NUMERIC NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  max_uses         INTEGER DEFAULT 100 CHECK (max_uses > 0),
  uses_count       INTEGER DEFAULT 0 CHECK (uses_count >= 0),
  expires_at       DATE,
  is_active        BOOLEAN DEFAULT TRUE
);

-- APP SETTINGS
CREATE TABLE IF NOT EXISTS public.app_settings (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         TEXT,
  app_name           TEXT DEFAULT 'مِشوار',
  commission_rate    NUMERIC DEFAULT 10,
  min_price          NUMERIC DEFAULT 10,
  max_price          NUMERIC DEFAULT 500,
  max_seats          INTEGER DEFAULT 6,
  support_phone      TEXT,
  support_email      TEXT,
  allow_registration BOOLEAN DEFAULT TRUE,
  maintenance_mode   BOOLEAN DEFAULT FALSE
);

-- ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS public.announcements (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  text       TEXT NOT NULL CHECK (length(text) <= 1000),
  is_active  BOOLEAN DEFAULT TRUE
);

-- SUPPORT TICKETS
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT,
  subject     TEXT NOT NULL CHECK (length(subject) <= 500),
  description TEXT CHECK (length(description) <= 5000),
  user_name   TEXT,
  user_email  TEXT,
  status      TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved'))
);

-- TRIP PREFERENCES
CREATE TABLE IF NOT EXISTS public.trip_preferences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  user_email      TEXT,
  user_name       TEXT,
  from_city       TEXT NOT NULL CHECK (length(from_city) <= 100),
  to_city         TEXT NOT NULL CHECK (length(to_city) <= 100),
  max_price       NUMERIC CHECK (max_price >= 0),
  preferred_date  DATE,
  notify_on_price BOOLEAN DEFAULT TRUE,
  notify_on_date  BOOLEAN DEFAULT TRUE,
  is_active       BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- PART 4: AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- PART 5: UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','trips','bookings','reviews','messages',
    'notifications','driver_licenses','coupons','app_settings',
    'announcements','support_tickets','trip_preferences'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON public.%s', t, t);
    EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================
-- PART 6: STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads', 'uploads', TRUE, 5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','application/pdf'];

-- ============================================================
-- PART 7: ROW LEVEL SECURITY — PRODUCTION GRADE
-- ============================================================
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_licenses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_preferences ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies for a clean slate
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── PROFILES ────────────────────────────────────────────────
-- Anyone authenticated can read profiles (public info for trip cards)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Users can only update/insert their own profile
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

-- Admins can update any profile (for admin dashboard)
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── TRIPS ────────────────────────────────────────────────────
-- Anyone can read confirmed/active trips
DROP POLICY IF EXISTS "trips_select_public" ON public.trips;
CREATE POLICY "trips_select_public" ON public.trips
  FOR SELECT USING (true);

-- Only authenticated users can create trips
DROP POLICY IF EXISTS "trips_insert" ON public.trips;
CREATE POLICY "trips_insert" ON public.trips
  FOR INSERT TO authenticated
  WITH CHECK (driver_email = public.auth_user_email());

-- Only the driver who owns the trip can update it (or admin)
DROP POLICY IF EXISTS "trips_update_driver" ON public.trips;
CREATE POLICY "trips_update_driver" ON public.trips
  FOR UPDATE TO authenticated
  USING (
    driver_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- Only the driver or admin can delete
DROP POLICY IF EXISTS "trips_delete_driver" ON public.trips;
CREATE POLICY "trips_delete_driver" ON public.trips
  FOR DELETE TO authenticated
  USING (
    driver_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- ── BOOKINGS ─────────────────────────────────────────────────
-- Passengers see their own bookings; drivers see bookings on their trips; admins see all
DROP POLICY IF EXISTS "bookings_select" ON public.bookings;
CREATE POLICY "bookings_select" ON public.bookings
  FOR SELECT TO authenticated
  USING (
    passenger_email = public.auth_user_email()
    OR trip_id IN (
      SELECT id::text FROM public.trips
      WHERE driver_email = public.auth_user_email()
    )
    OR public.auth_user_role() = 'admin'
  );

-- Passengers create their own bookings
DROP POLICY IF EXISTS "bookings_insert" ON public.bookings;
CREATE POLICY "bookings_insert" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (passenger_email = public.auth_user_email());

-- Passengers can cancel their own; drivers can confirm/cancel on their trips; admins all
DROP POLICY IF EXISTS "bookings_update" ON public.bookings;
CREATE POLICY "bookings_update" ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    passenger_email = public.auth_user_email()
    OR trip_id IN (
      SELECT id::text FROM public.trips
      WHERE driver_email = public.auth_user_email()
    )
    OR public.auth_user_role() = 'admin'
  );

-- Only admins can hard-delete bookings
DROP POLICY IF EXISTS "bookings_delete_admin" ON public.bookings;
CREATE POLICY "bookings_delete_admin" ON public.bookings
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── REVIEWS ──────────────────────────────────────────────────
-- Reviews are publicly readable (trust/rating system)
DROP POLICY IF EXISTS "reviews_select" ON public.reviews;
CREATE POLICY "reviews_select" ON public.reviews
  FOR SELECT USING (true);

-- Users write their own reviews only
DROP POLICY IF EXISTS "reviews_insert" ON public.reviews;
CREATE POLICY "reviews_insert" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (reviewer_email = public.auth_user_email());

-- Admins can delete reviews
DROP POLICY IF EXISTS "reviews_delete_admin" ON public.reviews;
CREATE POLICY "reviews_delete_admin" ON public.reviews
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── MESSAGES ─────────────────────────────────────────────────
-- Users see messages they sent or received
DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    sender_email = public.auth_user_email()
    OR receiver_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_email = public.auth_user_email());

DROP POLICY IF EXISTS "messages_update" ON public.messages;
CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    sender_email = public.auth_user_email()
    OR receiver_email = public.auth_user_email()
  );

DROP POLICY IF EXISTS "messages_delete" ON public.messages;
CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE TO authenticated
  USING (
    sender_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- ── NOTIFICATIONS ────────────────────────────────────────────
-- Users only see their own notifications
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- System/triggers create notifications (service role)
-- Authenticated users can create notifications (for review alerts etc)
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- Users can mark their own notifications read/deleted
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- ── DRIVER LICENSES ──────────────────────────────────────────
-- Drivers see only their own; admins see all
DROP POLICY IF EXISTS "licenses_select" ON public.driver_licenses;
CREATE POLICY "licenses_select" ON public.driver_licenses
  FOR SELECT TO authenticated
  USING (
    driver_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "licenses_insert" ON public.driver_licenses;
CREATE POLICY "licenses_insert" ON public.driver_licenses
  FOR INSERT TO authenticated
  WITH CHECK (driver_email = public.auth_user_email());

-- Drivers update their own (resubmit); admins approve/reject
DROP POLICY IF EXISTS "licenses_update" ON public.driver_licenses;
CREATE POLICY "licenses_update" ON public.driver_licenses
  FOR UPDATE TO authenticated
  USING (
    driver_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "licenses_delete_admin" ON public.driver_licenses;
CREATE POLICY "licenses_delete_admin" ON public.driver_licenses
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── COUPONS ──────────────────────────────────────────────────
-- Anyone can read coupons (to validate at checkout)
DROP POLICY IF EXISTS "coupons_select" ON public.coupons;
CREATE POLICY "coupons_select" ON public.coupons
  FOR SELECT USING (true);

-- Only admins can create/update/delete coupons
DROP POLICY IF EXISTS "coupons_insert_admin" ON public.coupons;
CREATE POLICY "coupons_insert_admin" ON public.coupons
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "coupons_update_admin" ON public.coupons;
CREATE POLICY "coupons_update_admin" ON public.coupons
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "coupons_delete_admin" ON public.coupons;
CREATE POLICY "coupons_delete_admin" ON public.coupons
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── APP SETTINGS ─────────────────────────────────────────────
-- Public read (app name, contact info used on help page)
DROP POLICY IF EXISTS "settings_select" ON public.app_settings;
CREATE POLICY "settings_select" ON public.app_settings
  FOR SELECT USING (true);

-- Only admins can write
DROP POLICY IF EXISTS "settings_write_admin" ON public.app_settings;
CREATE POLICY "settings_write_admin" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "settings_update_admin" ON public.app_settings;
CREATE POLICY "settings_update_admin" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── ANNOUNCEMENTS ────────────────────────────────────────────
-- Public read (shown on homepage)
DROP POLICY IF EXISTS "announcements_select" ON public.announcements;
CREATE POLICY "announcements_select" ON public.announcements
  FOR SELECT USING (true);

-- Only admins can write
DROP POLICY IF EXISTS "announcements_write_admin" ON public.announcements;
CREATE POLICY "announcements_write_admin" ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "announcements_update_admin" ON public.announcements;
CREATE POLICY "announcements_update_admin" ON public.announcements
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "announcements_delete_admin" ON public.announcements;
CREATE POLICY "announcements_delete_admin" ON public.announcements
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── SUPPORT TICKETS ──────────────────────────────────────────
-- Users see their own tickets; admins see all
DROP POLICY IF EXISTS "tickets_select" ON public.support_tickets;
CREATE POLICY "tickets_select" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

-- Anyone (even unauthenticated guests) can submit a ticket
DROP POLICY IF EXISTS "tickets_insert" ON public.support_tickets;
CREATE POLICY "tickets_insert" ON public.support_tickets
  FOR INSERT WITH CHECK (true);

-- Only admins can update/delete tickets
DROP POLICY IF EXISTS "tickets_update_admin" ON public.support_tickets;
CREATE POLICY "tickets_update_admin" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "tickets_delete_admin" ON public.support_tickets;
CREATE POLICY "tickets_delete_admin" ON public.support_tickets
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'admin');

-- ── TRIP PREFERENCES ────────────────────────────────────────
-- Users see only their own preferences
DROP POLICY IF EXISTS "prefs_select" ON public.trip_preferences;
CREATE POLICY "prefs_select" ON public.trip_preferences
  FOR SELECT TO authenticated
  USING (
    user_email = public.auth_user_email()
    OR public.auth_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "prefs_insert" ON public.trip_preferences;
CREATE POLICY "prefs_insert" ON public.trip_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_email = public.auth_user_email());

DROP POLICY IF EXISTS "prefs_update" ON public.trip_preferences;
CREATE POLICY "prefs_update" ON public.trip_preferences
  FOR UPDATE TO authenticated
  USING (user_email = public.auth_user_email());

DROP POLICY IF EXISTS "prefs_delete" ON public.trip_preferences;
CREATE POLICY "prefs_delete" ON public.trip_preferences
  FOR DELETE TO authenticated
  USING (user_email = public.auth_user_email());

-- ── STORAGE POLICIES (idempotent — safe to re-run) ──────────
-- Drop legacy policy names from prior versions
DROP POLICY IF EXISTS "Public read access on uploads"          ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete files"   ON storage.objects;

-- Drop current policies (so this whole block is re-runnable)
DROP POLICY IF EXISTS "storage_public_read" ON storage.objects;
DROP POLICY IF EXISTS "storage_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "storage_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "storage_auth_delete" ON storage.objects;

DROP POLICY IF EXISTS "storage_public_read" ON storage.objects;
CREATE POLICY "storage_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'uploads');

DROP POLICY IF EXISTS "storage_auth_upload" ON storage.objects;
CREATE POLICY "storage_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads');

DROP POLICY IF EXISTS "storage_auth_update" ON storage.objects;
CREATE POLICY "storage_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'uploads');

DROP POLICY IF EXISTS "storage_auth_delete" ON storage.objects;
CREATE POLICY "storage_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'uploads');

-- ============================================================
-- PART 8: PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_trips_driver_email      ON public.trips(driver_email);
CREATE INDEX IF NOT EXISTS idx_trips_status            ON public.trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_date              ON public.trips(date);
CREATE INDEX IF NOT EXISTS idx_trips_from_to           ON public.trips(from_city, to_city);
CREATE INDEX IF NOT EXISTS idx_trips_created_at        ON public.trips(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_trip_id        ON public.bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger      ON public.bookings(passenger_email);
CREATE INDEX IF NOT EXISTS idx_bookings_status         ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at     ON public.bookings(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_email     ON public.notifications(user_email);
CREATE INDEX IF NOT EXISTS idx_notifications_read      ON public.notifications(user_email, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created   ON public.notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_driver_email    ON public.reviews(driver_email);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer        ON public.reviews(reviewer_email);
CREATE INDEX IF NOT EXISTS idx_reviews_trip            ON public.reviews(trip_id);

CREATE INDEX IF NOT EXISTS idx_licenses_driver_email   ON public.driver_licenses(driver_email);
CREATE INDEX IF NOT EXISTS idx_licenses_status         ON public.driver_licenses(status);

CREATE INDEX IF NOT EXISTS idx_profiles_email          ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role           ON public.profiles(role);

CREATE INDEX IF NOT EXISTS idx_messages_conversation   ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender         ON public.messages(sender_email);
CREATE INDEX IF NOT EXISTS idx_messages_receiver       ON public.messages(receiver_email);

CREATE INDEX IF NOT EXISTS idx_prefs_user_email        ON public.trip_preferences(user_email);
CREATE INDEX IF NOT EXISTS idx_prefs_route             ON public.trip_preferences(from_city, to_city);

-- ============================================================
-- PART 9: RATE LIMITING — prevent spam bookings
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_booking_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.bookings
  WHERE passenger_email = NEW.passenger_email
    AND created_at > NOW() - INTERVAL '1 hour';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'تم تجاوز الحد المسموح به من الحجوزات. يرجى المحاولة لاحقاً.';
  END IF;

  -- Also prevent double-booking same trip
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE trip_id = NEW.trip_id
      AND passenger_email = NEW.passenger_email
      AND status NOT IN ('cancelled')
  ) THEN
    RAISE EXCEPTION 'لقد حجزت هذه الرحلة بالفعل.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS booking_rate_limit ON public.bookings;
CREATE TRIGGER booking_rate_limit
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.check_booking_rate_limit();

-- ============================================================
-- PART 10: AUTOMATION TRIGGERS
-- ============================================================

-- Trigger 1: Notify driver on new booking + decrement seats
CREATE OR REPLACE FUNCTION public.notify_driver_on_booking()
RETURNS TRIGGER AS $$
DECLARE
  trip_record RECORD;
BEGIN
  SELECT * INTO trip_record FROM public.trips WHERE id::text = NEW.trip_id LIMIT 1;
  IF trip_record IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_email, title, message, type, trip_id, from_city, to_city, is_read, created_by
  ) VALUES (
    trip_record.driver_email,
    '🎉 حجز جديد لرحلتك',
    COALESCE(NEW.passenger_name, 'راكب') || ' حجز ' || COALESCE(NEW.seats_booked,1)::text ||
      ' مقاعد في رحلتك من ' || trip_record.from_city || ' إلى ' || trip_record.to_city,
    'system', trip_record.id::text, trip_record.from_city, trip_record.to_city, false, 'system'
  );

  UPDATE public.trips
  SET available_seats = GREATEST(0, COALESCE(available_seats,1) - COALESCE(NEW.seats_booked,1)),
      updated_at = NOW()
  WHERE id = trip_record.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_booking_created ON public.bookings;
CREATE TRIGGER on_booking_created
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_driver_on_booking();

-- Trigger 2: Restore seats + notify on booking cancellation
CREATE OR REPLACE FUNCTION public.handle_booking_cancellation()
RETURNS TRIGGER AS $$
DECLARE
  trip_record  RECORD;
  notif_email  TEXT;
  notif_title  TEXT;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN

    UPDATE public.trips
    SET available_seats = available_seats + COALESCE(OLD.seats_booked, 1),
        updated_at = NOW()
    WHERE id::text = OLD.trip_id;

    SELECT * INTO trip_record FROM public.trips WHERE id::text = OLD.trip_id LIMIT 1;

    IF trip_record IS NOT NULL THEN
      IF OLD.passenger_email = public.auth_user_email() OR OLD.created_by = public.auth_user_email() THEN
        notif_email := trip_record.driver_email;
        notif_title := 'ألغى الراكب حجزه';
      ELSE
        notif_email := OLD.passenger_email;
        notif_title := 'ألغى السائق الرحلة';
      END IF;

      INSERT INTO public.notifications (
        user_email, title, message, type, trip_id, is_read, created_by
      ) VALUES (
        notif_email, notif_title,
        'تم إلغاء الحجز للرحلة من ' || trip_record.from_city || ' إلى ' ||
          trip_record.to_city || ' في ' || trip_record.date::text || ' ' || trip_record.time,
        'system', trip_record.id::text, false, 'system'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_booking_cancelled ON public.bookings;
CREATE TRIGGER on_booking_cancelled
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_booking_cancellation();

-- Trigger 3: Notify driver when license status changes
CREATE OR REPLACE FUNCTION public.notify_license_status_change()
RETURNS TRIGGER AS $$
DECLARE
  title_text   TEXT;
  message_text TEXT;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' THEN
    title_text   := '✅ رخصتك موافق عليها!';
    message_text := 'تم الموافقة على رخصة القيادة الخاصة بك. يمكنك الآن نشر الرحلات.';
  ELSIF NEW.status = 'rejected' THEN
    title_text   := '❌ تم رفض رخصتك';
    message_text := 'للأسف، تم رفض رخصة القيادة. السبب: ' ||
      COALESCE(NEW.rejection_reason, 'لم يتم تحديد السبب') ||
      '. يرجى تحديث المستندات والمحاولة مجدداً.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_email, title, message, type, is_read, created_by)
  VALUES (NEW.driver_email, title_text, message_text, 'system', false, 'system');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_license_status_change ON public.driver_licenses;
CREATE TRIGGER on_license_status_change
  AFTER UPDATE ON public.driver_licenses
  FOR EACH ROW EXECUTE FUNCTION public.notify_license_status_change();

-- Trigger 4: Match new trips to user preferences
CREATE OR REPLACE FUNCTION public.match_trip_to_preferences()
RETURNS TRIGGER AS $$
DECLARE
  pref       RECORD;
  reasons    TEXT[];
  notif_type TEXT;
BEGIN
  IF NEW.status != 'confirmed' THEN RETURN NEW; END IF;

  FOR pref IN
    SELECT * FROM public.trip_preferences
    WHERE is_active = true AND from_city = NEW.from_city AND to_city = NEW.to_city
  LOOP
    reasons := ARRAY[]::TEXT[];

    IF pref.notify_on_price THEN
      IF pref.max_price IS NULL OR NEW.price <= pref.max_price THEN
        reasons := array_append(reasons, 'السعر ₪' || NEW.price::text || ' ضمن ميزانيتك');
      END IF;
    END IF;

    IF pref.notify_on_date THEN
      IF pref.preferred_date IS NULL OR NEW.date = pref.preferred_date THEN
        reasons := array_append(reasons,
          CASE WHEN pref.preferred_date IS NOT NULL
               THEN 'الرحلة في تاريخ ' || NEW.date::text
               ELSE 'رحلة متاحة قريباً' END);
      END IF;
    END IF;

    CONTINUE WHEN array_length(reasons, 1) IS NULL;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_email = pref.user_email AND trip_id = NEW.id::text
    );

    notif_type := CASE
      WHEN pref.notify_on_date AND pref.preferred_date IS NOT NULL AND pref.preferred_date = NEW.date
        THEN 'date_match' ELSE 'new_trip' END;

    INSERT INTO public.notifications (
      user_email, title, message, type, trip_id, from_city, to_city, is_read, created_by
    ) VALUES (
      pref.user_email,
      'رحلة جديدة: ' || NEW.from_city || ' ← ' || NEW.to_city,
      array_to_string(reasons, ' • ') ||
        ' | الموعد: ' || NEW.date::text || ' ' || NEW.time || ' | السعر: ₪' || NEW.price::text,
      notif_type, NEW.id::text, NEW.from_city, NEW.to_city, false, 'system'
    );
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_trip_created_match_preferences ON public.trips;
CREATE TRIGGER on_trip_created_match_preferences
  AFTER INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.match_trip_to_preferences();

-- Trigger 5: Auto-update driver rating when reviewed
CREATE OR REPLACE FUNCTION public.update_driver_rating()
RETURNS TRIGGER AS $$
DECLARE
  avg_rating   NUMERIC;
  review_count INTEGER;
BEGIN
  IF NEW.review_type != 'passenger_rates_driver' THEN RETURN NEW; END IF;

  SELECT AVG(rating), COUNT(*)
  INTO avg_rating, review_count
  FROM public.reviews
  WHERE driver_email = NEW.driver_email AND review_type = 'passenger_rates_driver';

  UPDATE public.profiles
  SET total_rating = ROUND(avg_rating, 1), total_reviews = review_count, updated_at = NOW()
  WHERE email = NEW.driver_email;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_created ON public.reviews;
CREATE TRIGGER on_review_created
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_driver_rating();

-- Trigger 6: Notify passengers when trip status changes
CREATE OR REPLACE FUNCTION public.notify_passengers_trip_started()
RETURNS TRIGGER AS $$
DECLARE
  booking RECORD;
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' THEN
    FOR booking IN
      SELECT * FROM public.bookings
      WHERE trip_id = NEW.id::text AND status NOT IN ('cancelled')
    LOOP
      INSERT INTO public.notifications (user_email, title, message, type, trip_id, is_read, created_by)
      VALUES (
        booking.passenger_email, '🚗 السائق في الطريق!',
        'بدأت رحلتك من ' || NEW.from_city || ' إلى ' || NEW.to_city || '. كن جاهزاً في نقطة الالتقاء.',
        'system', NEW.id::text, false, 'system'
      );
    END LOOP;
  END IF;

  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    FOR booking IN
      SELECT * FROM public.bookings
      WHERE trip_id = NEW.id::text AND status = 'confirmed'
    LOOP
      UPDATE public.bookings SET status = 'completed' WHERE id = booking.id;

      INSERT INTO public.notifications (user_email, title, message, type, trip_id, is_read, created_by)
      VALUES (
        booking.passenger_email, '⭐ كيف كانت رحلتك؟',
        'اكتملت رحلتك من ' || NEW.from_city || ' إلى ' || NEW.to_city || '. قيّم تجربتك مع السائق!',
        'system', NEW.id::text, false, 'system'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_trip_status_changed ON public.trips;
CREATE TRIGGER on_trip_status_changed
  AFTER UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.notify_passengers_trip_started();

-- ============================================================
-- PART 11: DOCUMENT EXPIRY CHECK FUNCTION (run via cron)
-- Enable pg_cron in Supabase: Database → Extensions → pg_cron
-- Then run: SELECT cron.schedule('check-doc-expiry','0 8 * * *','SELECT public.check_document_expiry()');
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_document_expiry()
RETURNS void AS $$
DECLARE
  lic         RECORD;
  doc_name    TEXT;
  doc_date    DATE;
  thirty_days DATE := CURRENT_DATE + INTERVAL '30 days';
BEGIN
  FOR lic IN SELECT * FROM public.driver_licenses WHERE status = 'approved' LOOP
    FOR doc_name, doc_date IN
      VALUES ('رخصة القيادة', lic.expiry_date),
             ('تسجيل المركبة', lic.car_registration_expiry_date),
             ('التأمين', lic.insurance_expiry_date)
    LOOP
      CONTINUE WHEN doc_date IS NULL;

      IF doc_date < CURRENT_DATE THEN
        UPDATE public.driver_licenses
        SET status = 'rejected', rejection_reason = 'انتهت صلاحية ' || doc_name, updated_at = NOW()
        WHERE id = lic.id;
      ELSIF doc_date <= thirty_days THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_email = lic.driver_email
            AND title = '⏰ تنبيه: ' || doc_name || ' ينتهي قريباً'
            AND created_at > NOW() - INTERVAL '7 days'
        ) THEN
          INSERT INTO public.notifications (user_email, title, message, type, is_read, created_by)
          VALUES (
            lic.driver_email,
            '⏰ تنبيه: ' || doc_name || ' ينتهي قريباً',
            'صلاحية ' || doc_name || ' تنتهي في ' || doc_date::text || '. يرجى تحديث المستندات من الإعدادات.',
            'system', false, 'system'
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PART 12: REALTIME (scoped to relevant tables only)
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.trips', 'public.bookings', 'public.reviews',
    'public.messages', 'public.notifications', 'public.trip_preferences', 'public.profiles'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ============================================================
-- PART 13: DEFAULT DATA
-- ============================================================
INSERT INTO public.app_settings (app_name, commission_rate, min_price, max_price, max_seats, allow_registration, maintenance_mode)
VALUES ('مِشوار', 10, 10, 500, 6, TRUE, FALSE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- PART 14: ADMIN USER SETUP
-- Run this separately with your actual admin user's UUID:
--
--   INSERT INTO public.profiles (id, email, full_name, role, onboarding_completed, is_active)
--   SELECT id, email, 'مدير النظام', 'admin', true, true
--   FROM auth.users WHERE email = 'souqnamarketplace@gmail.com'
--   ON CONFLICT (id) DO UPDATE SET role = 'admin', onboarding_completed = true;
--
-- ============================================================

-- ============================================================
-- ADDITIONAL PERFORMANCE INDEXES (missing from original)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_trips_search ON public.trips(from_city, to_city, date, status);
CREATE INDEX IF NOT EXISTS idx_trips_confirmed ON public.trips(status, date) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_bookings_composite ON public.bookings(passenger_email, status, created_at DESC);


-- ============================================================
-- ACCOUNT MANAGEMENT RPC (proper cascade deletion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_user_account(user_id_param UUID)
RETURNS void AS $$
BEGIN
  -- Verify the caller is the user themselves
  IF auth.uid() != user_id_param THEN
    RAISE EXCEPTION 'Unauthorized: can only delete your own account';
  END IF;

  -- Anonymize personal data first (preserve trip/booking history for other users)
  UPDATE public.profiles SET
    full_name = 'حساب محذوف',
    email = 'deleted-' || user_id_param || '@deleted.local',
    phone = NULL,
    avatar_url = NULL,
    bio = NULL,
    car_model = NULL,
    car_plate = NULL,
    bank_name = NULL,
    bank_account_number = NULL,
    bank_iban = NULL,
    card_holder_name = NULL,
    card_last_four = NULL,
    is_active = FALSE,
    onboarding_completed = FALSE,
    updated_at = NOW()
  WHERE id = user_id_param;

  -- Cancel any active trips this user owned
  UPDATE public.trips SET status = 'cancelled', updated_at = NOW()
  WHERE driver_email IN (SELECT email FROM auth.users WHERE id = user_id_param)
    AND status NOT IN ('completed', 'cancelled');

  -- Cancel any active bookings
  UPDATE public.bookings SET status = 'cancelled', updated_at = NOW()
  WHERE passenger_email IN (SELECT email FROM auth.users WHERE id = user_id_param)
    AND status NOT IN ('completed', 'cancelled');

  -- Delete preferences
  DELETE FROM public.trip_preferences WHERE user_email IN (SELECT email FROM auth.users WHERE id = user_id_param);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_user_account(UUID) TO authenticated;

-- ============================================================
-- ADMIN ACTION AUDIT LOG (track who did what)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  admin_email TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (length(action) <= 100),
  target_type TEXT,
  target_id   TEXT,
  details     JSONB DEFAULT '{}',
  ip_address  TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_admin    ON public.admin_audit_log(admin_email);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON public.admin_audit_log(action);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_admin" ON public.admin_audit_log;
CREATE POLICY "audit_select_admin" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.auth_user_role() = 'admin');

DROP POLICY IF EXISTS "audit_insert_admin" ON public.admin_audit_log;
CREATE POLICY "audit_insert_admin" ON public.admin_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() = 'admin');

-- ============================================================
-- BULK BROADCAST RPC — instead of 1000 individual inserts
-- ============================================================
CREATE OR REPLACE FUNCTION public.broadcast_notification(title_text TEXT, message_text TEXT)
RETURNS INTEGER AS $$
DECLARE
  count_sent INTEGER;
BEGIN
  IF public.auth_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Only admins can broadcast notifications';
  END IF;

  INSERT INTO public.notifications (user_email, title, message, type, is_read, created_by)
  SELECT email, title_text, message_text, 'system', false, public.auth_user_email()
  FROM public.profiles
  WHERE is_active = true AND email IS NOT NULL;

  GET DIAGNOSTICS count_sent = ROW_COUNT;

  -- Log the broadcast in audit
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, details)
  VALUES (
    public.auth_user_email(),
    'broadcast_notification',
    'all_users',
    jsonb_build_object('title', title_text, 'count', count_sent)
  );

  RETURN count_sent;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.broadcast_notification(TEXT, TEXT) TO authenticated;

-- ============================================================
-- CANCEL BOOKING RPC — replaces the broken base44.functions.invoke
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_booking(booking_id_param UUID)
RETURNS void AS $$
DECLARE
  booking_record RECORD;
  caller_email   TEXT;
BEGIN
  caller_email := public.auth_user_email();
  
  SELECT * INTO booking_record FROM public.bookings WHERE id = booking_id_param;
  IF booking_record IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  -- Only the passenger or trip driver can cancel
  IF booking_record.passenger_email != caller_email
     AND NOT EXISTS (SELECT 1 FROM public.trips WHERE id::text = booking_record.trip_id AND driver_email = caller_email)
     AND public.auth_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized to cancel this booking';
  END IF;

  IF booking_record.status = 'cancelled' THEN
    RAISE EXCEPTION 'Booking already cancelled';
  END IF;

  UPDATE public.bookings SET status = 'cancelled', updated_at = NOW()
  WHERE id = booking_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID) TO authenticated;


-- ============================================================
-- LOGIN ATTEMPTS TRACKING (rate limit auth via DB)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address  TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON public.login_attempts(email, attempted_at DESC);

-- Auto-cleanup old attempts (keep 24 hours)
CREATE OR REPLACE FUNCTION public.cleanup_old_login_attempts()
RETURNS void AS $$
BEGIN
  DELETE FROM public.login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_attempts_select_admin" ON public.login_attempts;
CREATE POLICY "login_attempts_select_admin" ON public.login_attempts
  FOR SELECT TO authenticated
  USING (public.auth_user_role() = 'admin');

-- Anyone can insert their own attempt log
DROP POLICY IF EXISTS "login_attempts_insert_anon" ON public.login_attempts;
CREATE POLICY "login_attempts_insert_anon" ON public.login_attempts
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ============================================================
-- CONTENT MODERATION FILTER (basic Arabic profanity check)
-- ============================================================
CREATE OR REPLACE FUNCTION public.contains_inappropriate_content(text_input TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Basic check: blank/null is fine
  IF text_input IS NULL OR length(trim(text_input)) = 0 THEN
    RETURN FALSE;
  END IF;
  
  -- Length check
  IF length(text_input) > 1000 THEN
    RETURN TRUE;
  END IF;
  
  -- Check for excessive caps (>50% caps with length > 20)
  -- Could expand with profanity word list later
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- TRIP NOTES MODERATION TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.moderate_trip_notes()
RETURNS TRIGGER AS $$
BEGIN
  IF public.contains_inappropriate_content(NEW.driver_note) THEN
    RAISE EXCEPTION 'Trip notes contain inappropriate content';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trip_notes_moderation ON public.trips;
CREATE TRIGGER trip_notes_moderation
  BEFORE INSERT OR UPDATE OF driver_note ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.moderate_trip_notes();


-- ============================================================
-- DASHBOARD REPORT AGGREGATIONS (replaces full table scans)
-- ============================================================
-- Returns key metrics in ONE query instead of fetching 600+ rows
CREATE OR REPLACE FUNCTION public.dashboard_metrics()
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.auth_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  SELECT jsonb_build_object(
    'total_users',          (SELECT count(*) FROM public.profiles WHERE is_active = true),
    'total_drivers',        (SELECT count(*) FROM public.profiles WHERE account_type IN ('driver','both')),
    'total_passengers',     (SELECT count(*) FROM public.profiles WHERE account_type IN ('passenger','both')),
    'total_trips',          (SELECT count(*) FROM public.trips),
    'total_bookings',       (SELECT count(*) FROM public.bookings),
    'total_revenue',        (SELECT COALESCE(sum(total_price), 0) FROM public.bookings WHERE status = 'completed'),
    'avg_rating',           (SELECT COALESCE(round(avg(rating)::numeric, 1), 0) FROM public.reviews),
    'total_reviews',        (SELECT count(*) FROM public.reviews),
    -- Status breakdowns for charts
    'trips_by_status', (SELECT jsonb_object_agg(status, cnt) FROM (
       SELECT status, count(*) AS cnt FROM public.trips GROUP BY status) s),
    'bookings_by_status', (SELECT jsonb_object_agg(status, cnt) FROM (
       SELECT status, count(*) AS cnt FROM public.bookings GROUP BY status) s),
    -- Top 6 cities by trip origin
    'trips_by_city', (SELECT jsonb_agg(jsonb_build_object('name', from_city, 'value', cnt) ORDER BY cnt DESC) FROM (
       SELECT from_city, count(*) AS cnt FROM public.trips GROUP BY from_city ORDER BY cnt DESC LIMIT 6) c),
    -- Recent activity
    'reviews_this_week',    (SELECT count(*) FROM public.reviews WHERE created_at >= NOW() - INTERVAL '7 days'),
    'trips_this_week',      (SELECT count(*) FROM public.trips WHERE created_at >= NOW() - INTERVAL '7 days'),
    'bookings_this_week',   (SELECT count(*) FROM public.bookings WHERE created_at >= NOW() - INTERVAL '7 days'),
    'new_users_this_week',  (SELECT count(*) FROM public.profiles WHERE created_at >= NOW() - INTERVAL '7 days')
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.dashboard_metrics() TO authenticated;

-- Time-series data for charts (last 30 days)
CREATE OR REPLACE FUNCTION public.dashboard_timeseries()
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.auth_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  SELECT jsonb_build_object(
    'trips_by_day',
      (SELECT jsonb_agg(jsonb_build_object('date', date_bucket, 'count', cnt) ORDER BY date_bucket)
       FROM (
         SELECT date_trunc('day', created_at)::date AS date_bucket, count(*) AS cnt
         FROM public.trips
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY date_bucket
       ) t),
    'bookings_by_day',
      (SELECT jsonb_agg(jsonb_build_object('date', date_bucket, 'count', cnt) ORDER BY date_bucket)
       FROM (
         SELECT date_trunc('day', created_at)::date AS date_bucket, count(*) AS cnt
         FROM public.bookings
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY date_bucket
       ) b),
    'top_routes',
      (SELECT jsonb_agg(jsonb_build_object('from', from_city, 'to', to_city, 'count', cnt) ORDER BY cnt DESC)
       FROM (
         SELECT from_city, to_city, count(*) AS cnt
         FROM public.trips
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY from_city, to_city
         ORDER BY cnt DESC
         LIMIT 10
       ) r)
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.dashboard_timeseries() TO authenticated;


-- ============================================================
-- UNIFIED ACTIVITY LOG (admin) — paginated, server-side merged
-- ============================================================
CREATE OR REPLACE FUNCTION public.activity_log(
  filter_type TEXT DEFAULT NULL,
  page_param INTEGER DEFAULT 1,
  page_size_param INTEGER DEFAULT 30
)
RETURNS jsonb AS $$
DECLARE
  result jsonb;
  total_count INTEGER;
  offset_val INTEGER;
BEGIN
  IF public.auth_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  offset_val := (page_param - 1) * page_size_param;

  -- Build a unified view with type, date, text, id
  WITH unified AS (
    SELECT 'booking'::text AS type, created_at, id::text AS id,
           'حجز جديد من ' || COALESCE(passenger_name, 'راكب') ||
           ' — ₪' || COALESCE(total_price, 0)::text ||
           ' — الحالة: ' || status AS text
    FROM public.bookings
    WHERE filter_type IS NULL OR filter_type = 'all' OR filter_type = 'booking'

    UNION ALL

    SELECT 'trip'::text, created_at, id::text,
           'رحلة جديدة: ' || from_city || ' → ' || to_city ||
           ' بواسطة ' || COALESCE(driver_name, 'سائق') ||
           ' — الحالة: ' || status
    FROM public.trips
    WHERE filter_type IS NULL OR filter_type = 'all' OR filter_type = 'trip'

    UNION ALL

    SELECT 'review'::text, created_at, id::text,
           'تقييم جديد: ' || rating::text || '/5 ⭐ من ' ||
           COALESCE(reviewer_name, 'مستخدم') ||
           ' — "' || COALESCE(comment, '') || '"'
    FROM public.reviews
    WHERE filter_type IS NULL OR filter_type = 'all' OR filter_type = 'review'

    UNION ALL

    SELECT 'user'::text, created_at, id::text,
           'مستخدم جديد: ' || COALESCE(full_name, email) ||
           ' — الدور: ' || role
    FROM public.profiles
    WHERE filter_type IS NULL OR filter_type = 'all' OR filter_type = 'user'
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb),
    'total', (SELECT count(*) FROM unified),
    'page', page_param,
    'totalPages', CEIL((SELECT count(*) FROM unified)::numeric / page_size_param)::INTEGER
  ) INTO result
  FROM (
    SELECT * FROM unified ORDER BY created_at DESC LIMIT page_size_param OFFSET offset_val
  ) t;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.activity_log(TEXT, INTEGER, INTEGER) TO authenticated;


-- ============================================================
-- DRIVER PAYMENTS SUMMARY (per-driver revenue + commission)
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_payments_summary()
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.auth_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  WITH driver_revenue AS (
    SELECT
      t.driver_email,
      t.driver_name,
      count(b.id) AS booking_count,
      COALESCE(sum(b.total_price), 0) AS total_revenue,
      COALESCE(sum(b.total_price) * 0.10, 0) AS commission,
      COALESCE(sum(b.total_price) * 0.90, 0) AS driver_payout
    FROM public.bookings b
    JOIN public.trips t ON t.id::text = b.trip_id
    WHERE b.status IN ('confirmed', 'completed')
    GROUP BY t.driver_email, t.driver_name
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'total_revenue',   (SELECT COALESCE(sum(total_revenue), 0) FROM driver_revenue),
      'total_commission',(SELECT COALESCE(sum(commission), 0) FROM driver_revenue),
      'total_payouts',   (SELECT COALESCE(sum(driver_payout), 0) FROM driver_revenue),
      'total_bookings',  (SELECT COALESCE(sum(booking_count), 0) FROM driver_revenue),
      'driver_count',    (SELECT count(*) FROM driver_revenue)
    ),
    'drivers', (SELECT jsonb_agg(row_to_json(d) ORDER BY total_revenue DESC) FROM driver_revenue d)
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.driver_payments_summary() TO authenticated;

-- ============================================================
-- TRIGGER: Prevent driver from booking their own trip
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_no_self_booking()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trip_driver_email TEXT;
BEGIN
  -- Get the driver email of the trip being booked
  SELECT driver_email INTO trip_driver_email
  FROM public.trips
  WHERE id = NEW.trip_id;

  -- Reject if passenger and driver are the same person
  IF trip_driver_email IS NOT NULL 
     AND NEW.passenger_email IS NOT NULL
     AND lower(trip_driver_email) = lower(NEW.passenger_email) THEN
    RAISE EXCEPTION 'لا يمكنك حجز مقعد في رحلتك الخاصة' 
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any (idempotent)
DROP TRIGGER IF EXISTS prevent_self_booking ON public.bookings;

-- Create trigger that fires BEFORE INSERT
CREATE TRIGGER prevent_self_booking
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.check_no_self_booking();

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✅ Self-booking guard installed:';
  RAISE NOTICE '   Trigger: prevent_self_booking on public.bookings (BEFORE INSERT)';
  RAISE NOTICE '   Function: public.check_no_self_booking()';
  RAISE NOTICE '   Behavior: rejects bookings where passenger_email = trip.driver_email';
END $$;
