-- Migration 097: Admin notification when a user confirms their email
--
-- Supabase sets auth.users.email_confirmed_at when the user clicks the
-- confirmation link in their inbox. We watch for that column going from
-- NULL → a timestamp and fire a notification to all admin users so they
-- know a new verified account joined the platform.
--
-- Implementation: Postgres trigger on auth.users (UPDATE only).
-- The INSERT path is NOT needed — at sign-up email_confirmed_at is NULL;
-- it only becomes non-NULL when the user clicks the confirmation link.
--
-- How to verify after applying:
--   1. Create a new account with a fresh email.
--   2. Click the confirmation link.
--   3. Open /dashboard → الإشعارات — admin should see a new notification
--      with the user's email and a 👤 icon.

-- ── Helper: send notification to every admin ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admins_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_rec RECORD;
  confirmed_email TEXT;
BEGIN
  -- Only fire when email_confirmed_at changes from NULL to a real timestamp
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  confirmed_email := NEW.email;

  -- Insert a notification row for each admin profile
  FOR admin_rec IN
    SELECT email FROM public.profiles WHERE role = 'admin' AND is_active = true
  LOOP
    INSERT INTO public.notifications (
      user_email,
      type,
      title,
      body,
      data
    ) VALUES (
      admin_rec.email,
      'admin_alert',
      '👤 مستخدم جديد أكّد بريده الإلكتروني',
      'انضم مستخدم جديد إلى منصة مشوارو وأكّد بريده الإلكتروني: ' || confirmed_email,
      jsonb_build_object(
        'user_email', confirmed_email,
        'confirmed_at', NEW.email_confirmed_at
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── Attach trigger to auth.users ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_email_confirmed ON auth.users;

CREATE TRIGGER on_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_email_confirmed();

-- ── Verify ───────────────────────────────────────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgname = 'on_email_confirmed';
-- Expected: 1 row
