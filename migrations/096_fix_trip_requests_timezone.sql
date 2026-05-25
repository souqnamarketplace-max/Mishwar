-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: trip_requests expire prematurely due to UTC vs Asia/Jerusalem mismatch
--
-- Why: migration 019 created compute_request_expiry() which uses
-- p_date::timestamptz. PostgreSQL casts DATE → TIMESTAMPTZ using the SESSION
-- TimeZone, which on Supabase defaults to UTC. So a request for "today" in
-- Palestine time expires at midnight UTC = 2-3am Palestine time, NOT
-- midnight Palestine.
--
-- IMPACT:
--   Request posted at 9pm Palestine (= 6pm UTC) for "today, flexible time":
--   - compute_request_expiry returns end of today in UTC = 23:59:59 UTC =
--     2:59am NEXT day Palestine. OK, fine.
--
--   Request posted at 11pm Palestine on May 23 (= 8pm UTC May 23) for
--   "tomorrow (May 24) flexible":
--   - p_date = May 24, expiry = 23:59:59 UTC May 24 = 2:59am May 25 Palestine.
--   - Drivers in Palestine see request available until early morning May 25. OK.
--
--   BUT: Request posted at 2am Palestine on May 24 (= 11pm UTC May 23) for
--   "today (May 24) at 9am exact":
--   - p_date::timestamptz + p_time::interval =
--     May 24 00:00 UTC + 9 hours = May 24 09:00 UTC = 12:00 Palestine.
--   - Driver in Palestine sees the request expire at NOON local time
--     instead of 9AM local time. Confusing but not catastrophic.
--
--   The REAL bug: morning/afternoon/evening slots use the same naive cast:
--   "morning" expires at p_date 12:00 UTC = 14:00-15:00 Palestine.
--   "evening" expires at p_date 22:00 UTC = midnight to 1am Palestine.
--   These all shift by 2-3 hours, making the windows wrong.
--
--   Most critical: in early-morning Palestine hours (12am-3am Palestine =
--   9pm-midnight UTC previous day), the date hasn't changed in UTC yet so
--   any "today" request expires at end of YESTERDAY UTC = 2-3am Palestine =
--   ALREADY EXPIRED. New requests disappear immediately.
--
-- Fix: anchor all time computations to Asia/Jerusalem via AT TIME ZONE so
-- the result represents the wall-clock time the user intended.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_request_expiry(
  p_date DATE,
  p_time TIME,
  p_flexibility TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  -- Build the local wall-clock TIMESTAMP first (no zone) then attach
  -- Asia/Jerusalem so the result is the correct UTC instant for that
  -- local time. Without AT TIME ZONE, the cast uses SESSION TimeZone
  -- which is UTC on Supabase → off by 2-3 hours.
  v_local_ts TIMESTAMP;
BEGIN
  -- Exact time was given → expire at exactly that moment, Palestine time
  IF p_time IS NOT NULL AND p_flexibility = 'exact' THEN
    v_local_ts := (p_date::text || ' ' || p_time::text)::timestamp;
    RETURN v_local_ts AT TIME ZONE 'Asia/Jerusalem';
  END IF;

  -- Time slot windows — expire at the end of the slot, Palestine time
  IF p_flexibility = 'morning' THEN
    v_local_ts := (p_date::text || ' 12:00:00')::timestamp;
    RETURN v_local_ts AT TIME ZONE 'Asia/Jerusalem';
  END IF;
  IF p_flexibility = 'afternoon' THEN
    v_local_ts := (p_date::text || ' 17:00:00')::timestamp;
    RETURN v_local_ts AT TIME ZONE 'Asia/Jerusalem';
  END IF;
  IF p_flexibility = 'evening' THEN
    v_local_ts := (p_date::text || ' 22:00:00')::timestamp;
    RETURN v_local_ts AT TIME ZONE 'Asia/Jerusalem';
  END IF;

  -- Flexible / no specific time → end of requested date, Palestine time
  v_local_ts := (p_date::text || ' 23:59:59')::timestamp;
  RETURN v_local_ts AT TIME ZONE 'Asia/Jerusalem';
END $$;

-- Re-compute expiry for existing OPEN requests so they get the correct
-- value (avoids drivers seeing stale "expired" rows that are actually
-- still in the future Palestine time).
UPDATE public.trip_requests
SET expires_at = public.compute_request_expiry(requested_date, requested_time, time_flexibility),
    updated_at = now()
WHERE status = 'open';

-- And reset 'expired' rows that should still be open (timezone bug
-- prematurely expired them). Only restore if the new expiry is in the
-- future — otherwise they're correctly expired.
UPDATE public.trip_requests
SET status = 'open', updated_at = now()
WHERE status = 'expired'
  AND public.compute_request_expiry(requested_date, requested_time, time_flexibility) > now();
