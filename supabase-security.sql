-- ============================================================
-- مشوارو — Supabase Security Migration v3
-- Fix: helper function guarantees TEXT, avoids uuid=text error
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── STEP 1: Create a guaranteed-text email helper ───────────
-- This avoids ALL type ambiguity. auth_email() always returns text.
CREATE OR REPLACE FUNCTION auth_email()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json ->> 'email',
    ''
  );
$$;

-- ─── STEP 2: Enable RLS on all tables ────────────────────────
ALTER TABLE trips            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_licenses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_payouts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons          ENABLE ROW LEVEL SECURITY;

-- ─── STEP 3: Drop all existing policies ──────────────────────
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname
    FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ─── STEP 4: TRIPS ───────────────────────────────────────────
CREATE POLICY "trips_select" ON trips FOR SELECT USING (
  status IN ('confirmed','in_progress')
  OR created_by::text = auth_email()
);
CREATE POLICY "trips_insert" ON trips FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND created_by::text = auth_email()
);
CREATE POLICY "trips_update" ON trips FOR UPDATE USING (
  created_by::text = auth_email()
);
CREATE POLICY "trips_delete" ON trips FOR DELETE USING (
  created_by::text = auth_email()
);

-- ─── STEP 5: BOOKINGS ────────────────────────────────────────
CREATE POLICY "bookings_select" ON bookings FOR SELECT USING (
  passenger_email::text = auth_email()
  OR EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = bookings.trip_id
    AND t.created_by::text = auth_email()
  )
);
CREATE POLICY "bookings_insert" ON bookings FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND passenger_email::text = auth_email()
);
CREATE POLICY "bookings_update" ON bookings FOR UPDATE USING (
  passenger_email::text = auth_email()
  OR EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = bookings.trip_id
    AND t.created_by::text = auth_email()
  )
);

-- ─── STEP 6: REVIEWS ─────────────────────────────────────────
CREATE POLICY "reviews_select" ON reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert" ON reviews FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND reviewer_email::text = auth_email()
);
-- No UPDATE — reviews are immutable after posting

-- ─── STEP 7: MESSAGES ────────────────────────────────────────
CREATE POLICY "messages_select" ON messages FOR SELECT USING (
  sender_email::text   = auth_email()
  OR receiver_email::text = auth_email()
);
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
  AND sender_email::text = auth_email()
);
CREATE POLICY "messages_update" ON messages FOR UPDATE USING (
  receiver_email::text = auth_email()
);

-- ─── STEP 8: PROFILES ────────────────────────────────────────
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (
  created_by::text = auth_email()
);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (
  created_by::text = auth_email()
);

-- ─── STEP 9: NOTIFICATIONS ───────────────────────────────────
CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  user_email::text = auth_email()
);
CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (
  user_email::text = auth_email()
);

-- ─── STEP 10: DRIVER LICENSES ────────────────────────────────
CREATE POLICY "licenses_select" ON driver_licenses FOR SELECT USING (
  created_by::text = auth_email()
);
CREATE POLICY "licenses_insert" ON driver_licenses FOR INSERT WITH CHECK (
  created_by::text = auth_email()
);
CREATE POLICY "licenses_update" ON driver_licenses FOR UPDATE USING (
  created_by::text = auth_email()
);

-- ─── STEP 11: DRIVER PAYOUTS ─────────────────────────────────
CREATE POLICY "payouts_select" ON driver_payouts FOR SELECT USING (
  driver_email::text = auth_email()
);
CREATE POLICY "payouts_insert" ON driver_payouts FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);

-- ─── STEP 12: TRIP PREFERENCES ───────────────────────────────
CREATE POLICY "prefs_select" ON trip_preferences FOR SELECT USING (
  user_email::text = auth_email()
  OR (auth.role() = 'authenticated' AND is_active = true)
);
CREATE POLICY "prefs_insert" ON trip_preferences FOR INSERT WITH CHECK (
  user_email::text = auth_email()
);
CREATE POLICY "prefs_update" ON trip_preferences FOR UPDATE USING (
  user_email::text = auth_email()
);
CREATE POLICY "prefs_delete" ON trip_preferences FOR DELETE USING (
  user_email::text = auth_email()
);

-- ─── STEP 13: ADMIN AUDIT LOG ────────────────────────────────
CREATE POLICY "audit_insert" ON admin_audit_log FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);
CREATE POLICY "audit_select" ON admin_audit_log FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.created_by::text = auth_email()
    AND p.role::text = 'admin'
  )
);

-- ─── STEP 14: SUPPORT TICKETS ────────────────────────────────
CREATE POLICY "tickets_select" ON support_tickets FOR SELECT USING (
  created_by::text = auth_email()
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.created_by::text = auth_email()
    AND p.role::text = 'admin'
  )
);
CREATE POLICY "tickets_insert" ON support_tickets FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);

-- ─── STEP 15: ANNOUNCEMENTS (public read, admin write) ────────
CREATE POLICY "announcements_select" ON announcements FOR SELECT USING (true);
CREATE POLICY "announcements_write" ON announcements FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.created_by::text = auth_email()
    AND p.role::text = 'admin'
  )
);

-- ─── STEP 16: APP SETTINGS (public read, admin write) ─────────
CREATE POLICY "settings_select" ON app_settings FOR SELECT USING (true);
CREATE POLICY "settings_write" ON app_settings FOR ALL USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.created_by::text = auth_email()
    AND p.role::text = 'admin'
  )
);

-- ─── STEP 17: SELF-BOOKING PREVENTION TRIGGER ─────────────────
CREATE OR REPLACE FUNCTION prevent_self_booking()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trips
    WHERE id = NEW.trip_id
    AND created_by::text = NEW.passenger_email::text
  ) THEN
    RAISE EXCEPTION 'لا يمكنك حجز مقعد في رحلتك الخاصة';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_booking ON bookings;
CREATE TRIGGER trg_prevent_self_booking
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_self_booking();

-- ─── STEP 18: REALTIME (wrapped to avoid duplicate errors) ────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE trips;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── VERIFY: all tables should show rowsecurity = true ────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ─── ADD hero_city_slides COLUMN TO app_settings ────────────────
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS hero_city_slides TEXT;
