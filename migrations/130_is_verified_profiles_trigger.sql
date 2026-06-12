-- Migration 130: profiles.is_verified — auto-set by triggers
-- (applied to production DB 2026-06-12 via Supabase MCP)
--
-- profiles.is_verified = TRUE iff the user has an approved driver_license
-- OR an approved passenger_verification row.
-- Triggers on both tables keep it in sync automatically.
-- Backfill ran at end of migration for existing approved rows (11 users).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.recalc_is_verified(p_user_id UUID) ...
CREATE OR REPLACE FUNCTION public.trg_driver_license_sync_verified() ...
CREATE OR REPLACE FUNCTION public.trg_passenger_verif_sync_verified() ...

-- See full SQL in Supabase migration history.
