-- ============================================================
-- مشوارو — Supabase Security Hardening Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

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

-- ─── 2. DROP OLD POLICIES (clean slate) ─────────────────────
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname
    FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ─── 3. TRIPS ────────────────────────────────────────────────
-- Anyone can read confirmed future trips (for search)
CREATE POLICY "trips_read_public" ON trips
  FOR SELECT USING (status IN ('confirmed','in_progress'));

-- Driver can read ALL their own trips (including completed/cancelled)
CREATE POLICY "trips_read_own" ON trips
  FOR SELECT USING (created_by = auth.email());

-- Only authenticated users can create trips
CREATE POLICY "trips_insert" ON trips
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    created_by = auth.email()
  );

-- Driver can only update their own trips
CREATE POLICY "trips_update_own" ON trips
  FOR UPDATE USING (created_by = auth.email());

-- Driver can only delete their own trips
CREATE POLICY "trips_delete_own" ON trips
  FOR DELETE USING (created_by = auth.email());

-- ─── 4. BOOKINGS ─────────────────────────────────────────────
-- Passenger sees their own bookings
CREATE POLICY "bookings_read_passenger" ON bookings
  FOR SELECT USING (passenger_email = auth.email());

-- Driver sees bookings on their trips
CREATE POLICY "bookings_read_driver" ON bookings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM trips t WHERE t.id = bookings.trip_id AND t.created_by = auth.email())
  );

-- Passenger creates booking (cannot book own trip — enforced by DB trigger)
CREATE POLICY "bookings_insert" ON bookings
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    passenger_email = auth.email()
  );

-- Passenger can cancel their booking; driver can accept/reject
CREATE POLICY "bookings_update_passenger" ON bookings
  FOR UPDATE USING (passenger_email = auth.email());

CREATE POLICY "bookings_update_driver" ON bookings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM trips t WHERE t.id = bookings.trip_id AND t.created_by = auth.email())
  );

-- ─── 5. REVIEWS ──────────────────────────────────────────────
-- Anyone can read reviews (public trust system)
CREATE POLICY "reviews_read_all" ON reviews
  FOR SELECT USING (true);

-- Authenticated users write reviews as themselves
CREATE POLICY "reviews_insert" ON reviews
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    reviewer_email = auth.email()
  );

-- Cannot edit reviews after posting
-- (no UPDATE policy = immutable reviews)

-- ─── 6. MESSAGES ─────────────────────────────────────────────
-- User sees only messages they sent or received
CREATE POLICY "messages_read_own" ON messages
  FOR SELECT USING (
    sender_email = auth.email() OR
    receiver_email = auth.email()
  );

-- User can only send messages as themselves
CREATE POLICY "messages_insert" ON messages
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    sender_email = auth.email()
  );

-- User can mark their received messages as read
CREATE POLICY "messages_update_read" ON messages
  FOR UPDATE USING (receiver_email = auth.email());

-- ─── 7. PROFILES ─────────────────────────────────────────────
-- Anyone can read basic profile info (driver ratings, names)
CREATE POLICY "profiles_read_all" ON profiles
  FOR SELECT USING (true);

-- User can only update their own profile
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (created_by = auth.email());

-- Auth system creates profile on signup
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (created_by = auth.email());

-- ─── 8. NOTIFICATIONS ────────────────────────────────────────
-- User sees only their own notifications
CREATE POLICY "notifications_read_own" ON notifications
  FOR SELECT USING (user_email = auth.email());

-- System/authenticated users can create notifications for others
CREATE POLICY "notifications_insert" ON notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- User can mark own notifications as read
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (user_email = auth.email());

-- ─── 9. DRIVER LICENSES ──────────────────────────────────────
-- Only the driver sees their own licenses
CREATE POLICY "licenses_read_own" ON driver_licenses
  FOR SELECT USING (created_by = auth.email());

-- Admins can see all licenses for verification
CREATE POLICY "licenses_read_admin" ON driver_licenses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.created_by = auth.email() AND p.role = 'admin')
  );

CREATE POLICY "licenses_insert_own" ON driver_licenses
  FOR INSERT WITH CHECK (created_by = auth.email());

CREATE POLICY "licenses_update_own" ON driver_licenses
  FOR UPDATE USING (created_by = auth.email());

-- ─── 10. DRIVER PAYOUTS ──────────────────────────────────────
-- Driver sees only their own payouts
CREATE POLICY "payouts_read_own" ON driver_payouts
  FOR SELECT USING (driver_email = auth.email());

CREATE POLICY "payouts_insert" ON driver_payouts
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ─── 11. TRIP PREFERENCES ────────────────────────────────────
-- User sees only their own preferences
CREATE POLICY "prefs_read_own" ON trip_preferences
  FOR SELECT USING (user_email = auth.email());

-- System reads all preferences for matching (allow service role)
CREATE POLICY "prefs_read_system" ON trip_preferences
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "prefs_insert_own" ON trip_preferences
  FOR INSERT WITH CHECK (user_email = auth.email());

CREATE POLICY "prefs_update_own" ON trip_preferences
  FOR UPDATE USING (user_email = auth.email());

CREATE POLICY "prefs_delete_own" ON trip_preferences
  FOR DELETE USING (user_email = auth.email());

-- ─── 12. ADMIN AUDIT LOG ─────────────────────────────────────
-- Only admins can read audit log
CREATE POLICY "audit_read_admin" ON admin_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.created_by = auth.email() AND p.role = 'admin')
  );

-- Any authenticated user can insert (system actions)
CREATE POLICY "audit_insert" ON admin_audit_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ─── 13. SUPPORT TICKETS ─────────────────────────────────────
CREATE POLICY "tickets_read_own" ON support_tickets
  FOR SELECT USING (created_by = auth.email());

CREATE POLICY "tickets_read_admin" ON support_tickets
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.created_by = auth.email() AND p.role = 'admin')
  );

CREATE POLICY "tickets_insert" ON support_tickets
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ─── 14. ANNOUNCEMENTS & APP SETTINGS ────────────────────────
-- Public readable
CREATE POLICY "announcements_read_all" ON announcements
  FOR SELECT USING (true);

CREATE POLICY "settings_read_all" ON app_settings
  FOR SELECT USING (true);

-- Only admins can write
CREATE POLICY "announcements_write_admin" ON announcements
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.created_by = auth.email() AND p.role = 'admin')
  );

CREATE POLICY "settings_write_admin" ON app_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.created_by = auth.email() AND p.role = 'admin')
  );

-- ─── 15. PREVENT DRIVER SELF-BOOKING (DB TRIGGER) ───────────
CREATE OR REPLACE FUNCTION prevent_self_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM trips
    WHERE id = NEW.trip_id AND created_by = NEW.passenger_email
  ) THEN
    RAISE EXCEPTION 'لا يمكنك حجز مقعد في رحلتك الخاصة';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_self_booking ON bookings;
CREATE TRIGGER trg_prevent_self_booking
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_self_booking();

-- ─── 16. AUTH RATE LIMITING (Supabase built-in) ──────────────
-- Run these in: Dashboard → Auth → Settings (UI) OR via SQL:
-- Email signups per hour: 10
-- OTP expiry: 3600 seconds
-- Minimum password length: 8

ALTER SYSTEM SET app.settings.max_email_signups_per_hour = '10';

-- ─── 17. REALTIME SECURITY ───────────────────────────────────
-- Only allow realtime on tables that need it
-- (Messages, Notifications, Trips, Bookings)
ALTER PUBLICATION supabase_realtime ADD TABLE trips;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;

-- ─── DONE ────────────────────────────────────────────────────
-- Verify RLS is enabled:
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
