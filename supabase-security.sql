-- ============================================================
-- مشوارو — Supabase Security Hardening Migration v2
-- Fixed: explicit text casting to avoid uuid = text errors
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Helper: get current user email as TEXT (avoids uuid/text mismatch)
-- auth.email() can sometimes return null before session loads,
-- so we use jwt claim directly with explicit text cast
-- Usage in policies: (auth.jwt() ->> 'email')

-- ─── 1. ENABLE RLS ON ALL TABLES ────────────────────────────
ALTER TABLE trips             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_licenses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_payouts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons           ENABLE ROW LEVEL SECURITY;

-- ─── 2. DROP ALL EXISTING POLICIES (clean slate) ────────────
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ─── 3. TRIPS ────────────────────────────────────────────────
-- Public can search confirmed/active trips
CREATE POLICY "trips_select_public" ON trips
  FOR SELECT USING (
    status IN ('confirmed', 'in_progress')
    OR (created_by)::text = (auth.jwt() ->> 'email')
  );

-- Only authenticated users insert trips as themselves
CREATE POLICY "trips_insert" ON trips
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND (created_by)::text = (auth.jwt() ->> 'email')
  );

-- Driver updates/deletes only their own trips
CREATE POLICY "trips_update_own" ON trips
  FOR UPDATE USING (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "trips_delete_own" ON trips
  FOR DELETE USING (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

-- ─── 4. BOOKINGS ─────────────────────────────────────────────
-- Passenger reads own bookings
CREATE POLICY "bookings_select_passenger" ON bookings
  FOR SELECT USING (
    (passenger_email)::text = (auth.jwt() ->> 'email')
  );

-- Driver reads bookings on their trips
CREATE POLICY "bookings_select_driver" ON bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = bookings.trip_id
      AND (t.created_by)::text = (auth.jwt() ->> 'email')
    )
  );

-- Passenger creates booking
CREATE POLICY "bookings_insert" ON bookings
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND (passenger_email)::text = (auth.jwt() ->> 'email')
  );

-- Passenger updates (cancel) their booking
CREATE POLICY "bookings_update_passenger" ON bookings
  FOR UPDATE USING (
    (passenger_email)::text = (auth.jwt() ->> 'email')
  );

-- Driver updates bookings on their trips (accept/reject)
CREATE POLICY "bookings_update_driver" ON bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = bookings.trip_id
      AND (t.created_by)::text = (auth.jwt() ->> 'email')
    )
  );

-- ─── 5. REVIEWS ──────────────────────────────────────────────
-- Public readable — trust system
CREATE POLICY "reviews_select_all" ON reviews
  FOR SELECT USING (true);

-- Write only as yourself, immutable after posting (no UPDATE policy)
CREATE POLICY "reviews_insert" ON reviews
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND (reviewer_email)::text = (auth.jwt() ->> 'email')
  );

-- ─── 6. MESSAGES ─────────────────────────────────────────────
-- Only sender or receiver can read
CREATE POLICY "messages_select_own" ON messages
  FOR SELECT USING (
    (sender_email)::text   = (auth.jwt() ->> 'email')
    OR (receiver_email)::text = (auth.jwt() ->> 'email')
  );

-- Only send as yourself
CREATE POLICY "messages_insert" ON messages
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND (sender_email)::text = (auth.jwt() ->> 'email')
  );

-- Mark received messages as read
CREATE POLICY "messages_update_read" ON messages
  FOR UPDATE USING (
    (receiver_email)::text = (auth.jwt() ->> 'email')
  );

-- ─── 7. PROFILES ─────────────────────────────────────────────
-- Public readable (driver names, ratings)
CREATE POLICY "profiles_select_all" ON profiles
  FOR SELECT USING (true);

-- Only edit your own profile
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

-- ─── 8. NOTIFICATIONS ────────────────────────────────────────
-- Only your own notifications
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (
    (user_email)::text = (auth.jwt() ->> 'email')
  );

-- Any authenticated user can create notifications (system sends to others)
CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
  );

-- Mark your own as read
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (
    (user_email)::text = (auth.jwt() ->> 'email')
  );

-- ─── 9. DRIVER LICENSES ──────────────────────────────────────
CREATE POLICY "licenses_select_own" ON driver_licenses
  FOR SELECT USING (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "licenses_insert_own" ON driver_licenses
  FOR INSERT WITH CHECK (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "licenses_update_own" ON driver_licenses
  FOR UPDATE USING (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

-- ─── 10. DRIVER PAYOUTS ──────────────────────────────────────
CREATE POLICY "payouts_select_own" ON driver_payouts
  FOR SELECT USING (
    (driver_email)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "payouts_insert" ON driver_payouts
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
  );

-- ─── 11. TRIP PREFERENCES ────────────────────────────────────
CREATE POLICY "prefs_select_own" ON trip_preferences
  FOR SELECT USING (
    (user_email)::text = (auth.jwt() ->> 'email')
  );

-- Allow reading all active prefs for trip matching notifications
CREATE POLICY "prefs_select_matching" ON trip_preferences
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND is_active = true
  );

CREATE POLICY "prefs_insert_own" ON trip_preferences
  FOR INSERT WITH CHECK (
    (user_email)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "prefs_update_own" ON trip_preferences
  FOR UPDATE USING (
    (user_email)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "prefs_delete_own" ON trip_preferences
  FOR DELETE USING (
    (user_email)::text = (auth.jwt() ->> 'email')
  );

-- ─── 12. ADMIN AUDIT LOG ─────────────────────────────────────
-- Any authenticated user can insert (system logs)
CREATE POLICY "audit_insert" ON admin_audit_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Only admins can read
CREATE POLICY "audit_select_admin" ON admin_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE (p.created_by)::text = (auth.jwt() ->> 'email')
      AND p.role = 'admin'
    )
  );

-- ─── 13. SUPPORT TICKETS ─────────────────────────────────────
CREATE POLICY "tickets_select_own" ON support_tickets
  FOR SELECT USING (
    (created_by)::text = (auth.jwt() ->> 'email')
  );

CREATE POLICY "tickets_insert" ON support_tickets
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
  );

-- ─── 14. ANNOUNCEMENTS & APP_SETTINGS (public read) ──────────
CREATE POLICY "announcements_select_all" ON announcements
  FOR SELECT USING (true);

CREATE POLICY "settings_select_all" ON app_settings
  FOR SELECT USING (true);

-- Admins write announcements and settings
CREATE POLICY "announcements_all_admin" ON announcements
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE (p.created_by)::text = (auth.jwt() ->> 'email')
      AND p.role = 'admin'
    )
  );

CREATE POLICY "settings_all_admin" ON app_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE (p.created_by)::text = (auth.jwt() ->> 'email')
      AND p.role = 'admin'
    )
  );

-- ─── 15. SELF-BOOKING PREVENTION TRIGGER ────────────────────
CREATE OR REPLACE FUNCTION prevent_self_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trips
    WHERE id = NEW.trip_id
    AND (created_by)::text = (NEW.passenger_email)::text
  ) THEN
    RAISE EXCEPTION 'لا يمكنك حجز مقعد في رحلتك الخاصة';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_self_booking ON bookings;
CREATE TRIGGER trg_prevent_self_booking
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_self_booking();

-- ─── 16. REALTIME (only needed tables) ───────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE trips;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;

-- ─── VERIFY: check RLS is ON for all tables ──────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
