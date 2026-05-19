-- ─────────────────────────────────────────────────────────────────────────────
-- 091_driver_licenses_user_id.sql
--
-- Why: driver_licenses uses driver_email as its user-identifier, which worked
-- when one auth user owned each email — but Sign in with Apple (and any
-- second-OAuth scenario) can produce TWO auth users sharing an email, and
-- the email-keyed query then leaks the older user's approved license into
-- the newer user's session. Concretely: BecomeDriver shows "تم توثيق حسابك"
-- and VerificationStatusSection shows the user as verified, while
-- profiles.account_type (correctly keyed by user_id) still says 'passenger'.
-- The two sources of truth disagree, the user sees ghost data, and admin
-- gets no signal because no real submission happened.
--
-- Fix: add user_id (FK to auth.users) to driver_licenses, backfill from
-- the existing driver_email values, and let the client switch its filter.
-- driver_email stays for now — it's referenced by RLS policies, trip
-- denormalization, and analytics — but new writes will populate both.
--
-- Backfill ambiguity: if multiple auth users share an email (the very bug
-- we're fixing), the UPDATE below picks one arbitrarily. That's fine — the
-- row was already serving that arbitrary user before this migration, so
-- nothing regresses. New duplicate-email auth users start clean.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.driver_licenses
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Case-insensitive backfill — auth.users.email is canonically lowercase,
-- but historical driver_email values may have mixed case, so lower() both.
UPDATE public.driver_licenses dl
SET user_id = u.id
FROM auth.users u
WHERE dl.user_id IS NULL
  AND dl.driver_email IS NOT NULL
  AND lower(u.email) = lower(dl.driver_email);

-- Index for the new BecomeDriver / VerificationStatusSection query path.
-- The "user_id, created_at DESC" composite mirrors the client's filter
-- + sort: WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1/10.
-- (Client code sorts by "-created_date", but apiClient.js translates
-- that to created_at before the SQL hits Postgres — the underlying
-- column has always been created_at.)
CREATE INDEX IF NOT EXISTS idx_driver_licenses_user_id_created_at
  ON public.driver_licenses (user_id, created_at DESC);

COMMIT;
