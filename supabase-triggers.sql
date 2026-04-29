-- =====================================================
-- Mishwar — Supabase Automations (DB Triggers)
-- Replaces all 5 Base44 cloud functions
-- Run this in Supabase SQL Editor AFTER supabase-schema.sql
-- =====================================================

-- ─────────────────────────────────────────────────────
-- TRIGGER 1: notifyDriverBooking
-- Fires on every new booking → notifies driver + decrements seats
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_driver_on_booking()
RETURNS TRIGGER AS $$
DECLARE
  trip_record RECORD;
BEGIN
  -- Fetch the trip this booking is for
  SELECT * INTO trip_record
  FROM public.trips
  WHERE id::text = NEW.trip_id
  LIMIT 1;

  IF trip_record IS NULL THEN
    RETURN NEW;
  END IF;

  -- Notify the driver
  INSERT INTO public.notifications (
    user_email, title, message, type, trip_id, from_city, to_city, is_read, created_by
  ) VALUES (
    trip_record.driver_email,
    '🎉 حجز جديد لرحلتك',
    COALESCE(NEW.passenger_name, 'راكب') || ' حجز ' || COALESCE(NEW.seats_booked, 1)::text ||
      ' مقاعد في رحلتك من ' || trip_record.from_city || ' إلى ' || trip_record.to_city,
    'system',
    trip_record.id::text,
    trip_record.from_city,
    trip_record.to_city,
    false,
    'system'
  );

  -- Decrement available seats (never go below 0)
  UPDATE public.trips
  SET
    available_seats = GREATEST(0, COALESCE(available_seats, 1) - COALESCE(NEW.seats_booked, 1)),
    updated_at = NOW()
  WHERE id = trip_record.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_booking_created ON public.bookings;
CREATE TRIGGER on_booking_created
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_driver_on_booking();


-- ─────────────────────────────────────────────────────
-- TRIGGER 2: Restore seats on booking cancellation
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_booking_cancellation()
RETURNS TRIGGER AS $$
DECLARE
  trip_record RECORD;
  notif_email TEXT;
  notif_title TEXT;
BEGIN
  -- Restore seats when a booking is cancelled
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN

    UPDATE public.trips
    SET
      available_seats = available_seats + COALESCE(OLD.seats_booked, 1),
      updated_at = NOW()
    WHERE id::text = OLD.trip_id;

    -- Fetch trip for notification
    SELECT * INTO trip_record FROM public.trips WHERE id::text = OLD.trip_id LIMIT 1;

    IF trip_record IS NOT NULL THEN
      IF OLD.passenger_email = NEW.created_by THEN
        notif_email := trip_record.driver_email;
        notif_title := 'ألغى الراكب حجزه';
      ELSE
        notif_email := OLD.passenger_email;
        notif_title := 'ألغى السائق الرحلة';
      END IF;

      INSERT INTO public.notifications (
        user_email, title, message, type, trip_id, is_read, created_by
      ) VALUES (
        notif_email,
        notif_title,
        'تم إلغاء الحجز للرحلة من ' || trip_record.from_city || ' إلى ' || trip_record.to_city ||
          ' في ' || trip_record.date::text || ' ' || trip_record.time,
        'system',
        trip_record.id::text,
        false,
        'system'
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


-- ─────────────────────────────────────────────────────
-- TRIGGER 3: notifyLicenseStatusChange
-- Fires when driver license status changes → notifies driver
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_license_status_change()
RETURNS TRIGGER AS $$
DECLARE
  title_text TEXT;
  message_text TEXT;
BEGIN
  -- Only fire on actual status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    title_text  := '✅ رخصتك موافق عليها!';
    message_text := 'تم الموافقة على رخصة القيادة الخاصة بك. يمكنك الآن نشر الرحلات.';
  ELSIF NEW.status = 'rejected' THEN
    title_text  := '❌ تم رفض رخصتك';
    message_text := 'للأسف، تم رفض رخصة القيادة الخاصة بك. السبب: ' ||
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


-- ─────────────────────────────────────────────────────
-- TRIGGER 4: matchTripsToPreferences
-- Fires on new trip → matches against user preferences → sends notifications
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_trip_to_preferences()
RETURNS TRIGGER AS $$
DECLARE
  pref       RECORD;
  reasons    TEXT[];
  notif_type TEXT;
BEGIN
  -- Only run for confirmed trips
  IF NEW.status != 'confirmed' THEN
    RETURN NEW;
  END IF;

  FOR pref IN
    SELECT * FROM public.trip_preferences
    WHERE is_active = true
      AND from_city = NEW.from_city
      AND to_city   = NEW.to_city
  LOOP
    reasons := ARRAY[]::TEXT[];

    -- Price match
    IF pref.notify_on_price THEN
      IF pref.max_price IS NULL OR NEW.price <= pref.max_price THEN
        reasons := array_append(reasons, 'السعر ₪' || NEW.price::text || ' ضمن ميزانيتك');
      END IF;
    END IF;

    -- Date match
    IF pref.notify_on_date THEN
      IF pref.preferred_date IS NULL OR NEW.date = pref.preferred_date THEN
        reasons := array_append(reasons,
          CASE WHEN pref.preferred_date IS NOT NULL
               THEN 'الرحلة في تاريخ ' || NEW.date::text
               ELSE 'رحلة متاحة قريباً'
          END
        );
      END IF;
    END IF;

    -- Skip if no relevant reason
    CONTINUE WHEN array_length(reasons, 1) IS NULL;

    -- Avoid duplicate notifications for same trip+user
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_email = pref.user_email
        AND trip_id    = NEW.id::text
    );

    notif_type := CASE
      WHEN pref.notify_on_date AND pref.preferred_date IS NOT NULL AND pref.preferred_date = NEW.date
        THEN 'date_match'
      ELSE 'new_trip'
    END;

    INSERT INTO public.notifications (
      user_email, title, message, type, trip_id, from_city, to_city, is_read, created_by
    ) VALUES (
      pref.user_email,
      'رحلة جديدة: ' || NEW.from_city || ' ← ' || NEW.to_city,
      array_to_string(reasons, ' • ') ||
        ' | الموعد: ' || NEW.date::text || ' ' || NEW.time ||
        ' | السعر: ₪' || NEW.price::text,
      notif_type,
      NEW.id::text,
      NEW.from_city,
      NEW.to_city,
      false,
      'system'
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_trip_created_match_preferences ON public.trips;
CREATE TRIGGER on_trip_created_match_preferences
  AFTER INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.match_trip_to_preferences();


-- ─────────────────────────────────────────────────────
-- TRIGGER 5: Auto-update driver stats on new review
-- Updates driver's total_rating and total_reviews in profiles
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_driver_rating()
RETURNS TRIGGER AS $$
DECLARE
  avg_rating NUMERIC;
  review_count INTEGER;
BEGIN
  IF NEW.review_type != 'passenger_rates_driver' THEN
    RETURN NEW;
  END IF;

  SELECT AVG(rating), COUNT(*)
  INTO avg_rating, review_count
  FROM public.reviews
  WHERE driver_email = NEW.driver_email
    AND review_type  = 'passenger_rates_driver';

  UPDATE public.profiles
  SET
    total_rating  = ROUND(avg_rating, 1),
    total_reviews = review_count,
    updated_at    = NOW()
  WHERE email = NEW.driver_email;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_review_created ON public.reviews;
CREATE TRIGGER on_review_created
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_driver_rating();


-- ─────────────────────────────────────────────────────
-- DAILY CRON: checkDocumentExpiryReminders
-- Requires pg_cron — enable it in Supabase Dashboard:
-- Database → Extensions → pg_cron → Enable
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_document_expiry()
RETURNS void AS $$
DECLARE
  lic            RECORD;
  doc_name       TEXT;
  doc_date       DATE;
  thirty_days    DATE := CURRENT_DATE + INTERVAL '30 days';
BEGIN
  FOR lic IN
    SELECT * FROM public.driver_licenses WHERE status = 'approved'
  LOOP
    -- Check each document type
    FOR doc_name, doc_date IN
      VALUES
        ('رخصة القيادة',  lic.expiry_date),
        ('تسجيل المركبة', lic.car_registration_expiry_date),
        ('التأمين',       lic.insurance_expiry_date)
    LOOP
      CONTINUE WHEN doc_date IS NULL;

      -- Expired → revoke
      IF doc_date < CURRENT_DATE THEN
        UPDATE public.driver_licenses
        SET status = 'rejected',
            rejection_reason = 'انتهت صلاحية ' || doc_name,
            updated_at = NOW()
        WHERE id = lic.id;

      -- Expiring within 30 days → warn (max once per 7 days)
      ELSIF doc_date <= thirty_days THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.notifications
          WHERE user_email = lic.driver_email
            AND title      = '⏰ تنبيه: ' || doc_name || ' ينتهي قريباً'
            AND created_at > NOW() - INTERVAL '7 days'
        ) THEN
          INSERT INTO public.notifications (
            user_email, title, message, type, is_read, created_by
          ) VALUES (
            lic.driver_email,
            '⏰ تنبيه: ' || doc_name || ' ينتهي قريباً',
            'صلاحية ' || doc_name || ' تنتهي في ' || doc_date::text ||
              '. يرجى تحديث المستندات من الإعدادات لتتمكن من نشر الرحلات.',
            'system',
            false,
            'system'
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule daily at 8:00 AM UTC
-- (run this separately AFTER enabling pg_cron extension)
-- SELECT cron.schedule('check-doc-expiry', '0 8 * * *', 'SELECT public.check_document_expiry()');


-- ─────────────────────────────────────────────────────
-- ADMIN SETUP
-- Run this to make yourself an admin:
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';
-- ─────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────
-- FIX: Sync trip available_seats on existing trips
-- Ensures available_seats is correctly set based on bookings
-- ─────────────────────────────────────────────────────
UPDATE public.trips t
SET available_seats = GREATEST(
  0,
  COALESCE(t.total_seats, 4) - COALESCE((
    SELECT SUM(seats_booked)
    FROM public.bookings b
    WHERE b.trip_id = t.id::text
      AND b.status NOT IN ('cancelled')
  ), 0)
)
WHERE true;


-- ─────────────────────────────────────────────────────
-- ADD PAYMENT COLUMNS TO PROFILES (if missing)
-- Safe to re-run
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='bank_name') THEN
    ALTER TABLE public.profiles ADD COLUMN bank_name TEXT;
    ALTER TABLE public.profiles ADD COLUMN bank_account_name TEXT;
    ALTER TABLE public.profiles ADD COLUMN bank_account_number TEXT;
    ALTER TABLE public.profiles ADD COLUMN bank_iban TEXT;
    ALTER TABLE public.profiles ADD COLUMN card_holder_name TEXT;
    ALTER TABLE public.profiles ADD COLUMN card_last_four TEXT;
    RAISE NOTICE 'Payment columns added to profiles';
  ELSE
    RAISE NOTICE 'Payment columns already exist';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────
-- ADD CHECKPOINT + RECURRING COLUMNS TO TRIPS
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trips' AND column_name='has_checkpoint') THEN
    ALTER TABLE public.trips ADD COLUMN has_checkpoint BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trips' AND column_name='checkpoint_note') THEN
    ALTER TABLE public.trips ADD COLUMN checkpoint_note TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trips' AND column_name='is_recurring') THEN
    ALTER TABLE public.trips ADD COLUMN is_recurring BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trips' AND column_name='recurring_days') THEN
    ALTER TABLE public.trips ADD COLUMN recurring_days JSONB DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trips' AND column_name='driver_phone') THEN
    ALTER TABLE public.trips ADD COLUMN driver_phone TEXT;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────
-- TRIGGER: Notify passengers when driver starts trip
-- Fires when trip status changes to 'in_progress'
-- ─────────────────────────────────────────────────────
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
        booking.passenger_email,
        '🚗 السائق في الطريق!',
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
      -- Update booking to completed
      UPDATE public.bookings SET status = 'completed' WHERE id = booking.id;
      -- Prompt review
      INSERT INTO public.notifications (user_email, title, message, type, trip_id, is_read, created_by)
      VALUES (
        booking.passenger_email,
        '⭐ كيف كانت رحلتك؟',
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
