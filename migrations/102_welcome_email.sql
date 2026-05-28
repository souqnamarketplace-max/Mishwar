-- Migration 102: Welcome email on email confirmation or social/Apple signup
-- See Edge Function: send-welcome-email

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent BOOLEAN NOT NULL DEFAULT false;

-- Trigger for email/password users (fires on email_confirmed_at change)
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_confirm()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE profile_name TEXT;
BEGIN
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  SELECT full_name INTO profile_name FROM public.profiles WHERE email = NEW.email LIMIT 1;
  PERFORM net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/send-welcome-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := jsonb_build_object('user_email', NEW.email, 'full_name', profile_name)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_email_confirmed_welcome ON auth.users;
CREATE TRIGGER on_email_confirmed_welcome
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.send_welcome_email_on_confirm();

-- Trigger for OAuth/Apple users (fires on profiles INSERT)
CREATE OR REPLACE FUNCTION public.send_welcome_email_on_profile_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = NEW.email AND email_confirmed_at IS NOT NULL) THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/send-welcome-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
    body := jsonb_build_object('user_email', NEW.email, 'full_name', NEW.full_name)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_profile_insert_welcome ON public.profiles;
CREATE TRIGGER on_profile_insert_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.send_welcome_email_on_profile_insert();
