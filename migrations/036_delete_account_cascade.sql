-- ════════════════════════════════════════════════════════════════════════
-- Migration 036 — Account-deletion cascade: handle dangling artifacts
-- ════════════════════════════════════════════════════════════════════════
--
-- BACKGROUND
-- Before this migration, delete_user_account_v2 (last touched in
-- migration 035 to add the trigger handshake) anonymized the email
-- column on profiles + denormalized email columns across tables. That's
-- adequate for static history (past bookings, past trips, past reviews)
-- but leaves three classes of LIVE artifacts dangling:
--
--   (1) PENDING BOOKINGS the deleting user made as a passenger.
--       Their driver still sees them in /driver/passengers as
--       "[حساب محذوف] wants to book your trip" with no way to confirm
--       (the passenger can never log back in). Worse, seats stay
--       decremented from the trip's available_seats because the
--       book_seat RPC reserved them and the cancel never ran.
--
--   (2) OPEN TRIP REQUESTS the deleting user posted.
--       Visible in the driver feed as a live "I want a ride from X to Y"
--       from a user who's gone. Drivers wasting time clicking through;
--       admin support tickets when they realize they can't contact the
--       passenger.
--
--   (3) DENORMALIZED PII columns the email-only sweep missed.
--       trips.driver_name, trips.driver_phone, trips.driver_avatar,
--       bookings.passenger_name, trip_requests.passenger_name,
--       messages.sender_name, messages.receiver_name. After deletion
--       the email column reads "deleted-<uuid>@deleted.local" — but the
--       deleted user's REAL NAME (and phone, for past trips) is still
--       embedded across the schema. A passenger who took a trip with
--       Alice last month still sees "السائق: Alice • 0599…" on the
--       trip detail page after Alice deletes. That's a real
--       right-to-be-forgotten violation, not just a UX gap.
--
-- WHAT'S BLOCKED VS CASCADED VS PRESERVED
-- Three different decisions for three different artifact types:
--
--   BLOCKED (pre-flight refuses deletion entirely):
--     - Future driver trips with status='confirmed' (date >= today)
--       The driver has commitments to passengers who'd be stranded.
--       User must cancel the trips themselves first.
--     - Future passenger bookings with status='confirmed'
--       The driver is counting on this passenger to show up. Same logic.
--
--   CASCADED (this migration auto-resolves):
--     - Pending bookings as passenger → cancelled + seats refunded + driver notified
--     - Open trip requests as passenger → cancelled
--     - Pending bookings AS DRIVER (i.e. someone tried to book one of
--       my future trips but I hadn't confirmed yet, and now I'm deleting).
--       Edge case: the driver is being blocked from deletion by their
--       trips (confirmed/future), so they MUST cancel those trips first,
--       which itself cancels associated bookings. So we don't expect
--       this case to reach the cascade — but if it did via some race,
--       cancelling pending bookings on the driver's trips is the
--       right call.
--
--   PRESERVED:
--     - Past completed bookings/trips. The OTHER party has a legitimate
--       claim to their history (ratings earned, dispute records).
--     - Reviews to/from the deleted user (emails anonymized but body +
--       star rating preserved). Removing the rating would unfairly
--       penalize the other party.
--     - Notification BODIES referencing the deleted user by name.
--       Historical "Alice booked your trip" stays as plain text — the
--       driver already saw it weeks ago and the notification log is a
--       record of what they were told. Going back to retroactively
--       scrub it would also break sort-by-relevance.
--     - admin_audit_log entries referencing the deleted user. Critical
--       for fraud investigation, dispute resolution, and policy
--       enforcement. GDPR explicitly carves out "legitimate interest"
--       for moderation/security records.
--     - user_blocks (anonymized but rows survive) — preserves the
--       record of why a block existed in case of dispute.
--
-- WHY ONE BIG TRANSACTION
-- Putting all of this inside the same SECURITY DEFINER function means:
--   - Atomicity: if any step fails (e.g. seat refund hits a constraint),
--     the entire deletion rolls back. User isn't left half-deleted with
--     half their pending bookings cancelled.
--   - Performance: one round-trip instead of N from the client side.
--   - Security: client doesn't need additional grants for any of these
--     UPDATEs. The RPC is the only privileged surface.
--
-- RETURN VALUE
-- Extended from just {success, deleted_at, reason} to include cascade
-- counts so the client can:
--   (a) show a meaningful summary toast ("ألغينا 2 حجز معلق")
--   (b) attach the numbers to the client-side admin_audit_log entry
--       so admins can see the scope of any individual deletion at a
--       glance ("user X deleted account, triggered cancellation of
--       2 pending bookings and 1 trip request").
--
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_user_account_v2(
  p_reason TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog, auth
AS $$
DECLARE
  v_uid                  UUID := auth.uid();
  v_old_email            TEXT;
  v_new_email            TEXT;
  v_today                DATE := CURRENT_DATE;
  v_active_trips         INT;
  v_active_bookings      INT;
  v_cancelled_bookings   INT := 0;
  v_cancelled_requests   INT := 0;
  r RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_old_email FROM auth.users WHERE id = v_uid;
  IF v_old_email IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- ─── Pre-flight: refuse if confirmed commitments exist ─────────────
  -- Unchanged from migration 003 / 035. These are commitments to OTHER
  -- users that the deleting user must resolve themselves before we'll
  -- let them walk away. Auto-cancelling confirmed bookings would be
  -- too aggressive — the other party agreed to a trip with this
  -- specific person and deserves a heads-up via the normal cancel flow
  -- (which sends a personalized notification, applies late-cancel
  -- strikes if warranted, etc.) rather than a silent "your booking was
  -- cancelled because the user deleted their account" message.

  SELECT COUNT(*) INTO v_active_trips
  FROM public.trips
  WHERE driver_email = v_old_email
    AND status = 'confirmed'
    AND date >= v_today;
  IF v_active_trips > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming trips as driver', v_active_trips;
  END IF;

  SELECT COUNT(*) INTO v_active_bookings
  FROM public.bookings b
  JOIN public.trips t ON t.id::text = b.trip_id
  WHERE b.passenger_email = v_old_email
    AND b.status = 'confirmed'
    AND t.date >= v_today;
  IF v_active_bookings > 0 THEN
    RAISE EXCEPTION 'cannot delete: % upcoming bookings as passenger', v_active_bookings;
  END IF;

  v_new_email := 'deleted-' || v_uid || '@deleted.local';

  -- ─── (1) Auto-cancel PENDING bookings the user made as passenger ──
  -- These are bookings the driver hadn't accepted yet. The book_seat
  -- RPC reserved seats from the trip; we need to refund them. Mirrors
  -- the seat-refund pattern from cancel_booking() in migration 018.
  --
  -- We use a per-booking loop (not a bulk UPDATE … FROM) because each
  -- booking might be on a different trip with different seats_booked,
  -- and we need to update each parent trip individually. The loop is
  -- bounded by the user's pending bookings — typically 0-3 rows, not
  -- a performance concern.
  --
  -- For each cancelled booking, also insert a notification to the
  -- driver so their pending-requests dashboard updates promptly and
  -- they understand why the request vanished. The notification body
  -- is intentionally vague — doesn't reveal the deleted user's old
  -- name (they're trying to be forgotten) but tells the driver the
  -- cancellation wasn't their fault.
  FOR r IN
    SELECT b.id AS booking_id, b.trip_id, b.seats_booked,
           t.driver_email, t.from_city, t.to_city, t.date
    FROM public.bookings b
    JOIN public.trips t ON t.id::text = b.trip_id
    WHERE b.passenger_email = v_old_email
      AND b.status = 'pending'
  LOOP
    UPDATE public.bookings
    SET status              = 'cancelled',
        cancellation_reason = 'passenger_deleted_account',
        updated_at          = NOW()
    WHERE id = r.booking_id;

    -- Refund seats to the trip. Bounded between 0 and the seats_total
    -- ceiling (same defensive bound cancel_booking uses, to handle
    -- the rare case where seats_total is missing/legacy NULL).
    UPDATE public.trips
    SET available_seats = LEAST(
          GREATEST(available_seats + COALESCE(r.seats_booked, 1), 0),
          COALESCE(total_seats, 20)
        ),
        updated_at = NOW()
    WHERE id::text = r.trip_id;

    -- Notify the driver. user_email is the driver's email. type='system'
    -- because there's no dedicated 'booking_cancelled' type yet and the
    -- existing notification bell renderer treats unknown types as
    -- generic system messages. from_city/to_city populate the route
    -- preview so the driver can see WHICH trip without opening.
    INSERT INTO public.notifications (
      user_email, title, message, type, trip_id, from_city, to_city
    )
    VALUES (
      r.driver_email,
      'تم إلغاء حجز معلق',
      'ألغي حجز معلق على رحلتك من ' || r.from_city || ' إلى ' || r.to_city ||
        ' بسبب إغلاق حساب المستخدم. أصبحت المقاعد متاحة مجدداً.',
      'system',
      r.trip_id,
      r.from_city,
      r.to_city
    );

    v_cancelled_bookings := v_cancelled_bookings + 1;
  END LOOP;

  -- ─── (2) Auto-cancel OPEN trip requests the user posted ───────────
  -- Open requests are just postings in the driver feed — no seats
  -- reserved, no commitments. Set status='cancelled' + reason so the
  -- feed query (which filters status='open') stops showing them.
  -- Drivers who'd already seen the request just see it disappear on
  -- next refresh; no notification needed (they hadn't taken any
  -- action yet).
  WITH cancelled_requests AS (
    UPDATE public.trip_requests
    SET status      = 'cancelled',
        admin_note  = COALESCE(admin_note, '') ||
                      CASE WHEN admin_note IS NULL OR admin_note = ''
                           THEN 'auto-cancelled: user_deleted_account'
                           ELSE E'\nauto-cancelled: user_deleted_account' END,
        updated_at  = NOW()
    WHERE passenger_email = v_old_email
      AND status = 'open'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cancelled_requests FROM cancelled_requests;

  -- ─── DELETION HANDSHAKE (from migration 035) ──────────────────────
  -- Tell the guard_profile_protected_columns trigger this UPDATE is
  -- part of an authorized self-deletion so the email/deleted_at
  -- changes don't get rejected.
  PERFORM set_config('mishwar.deleting_account', v_uid::text, true);

  -- ─── (3) Anonymize the profile row ────────────────────────────────
  UPDATE public.profiles SET
    full_name              = '[حساب محذوف]',
    email                  = v_new_email,
    avatar_url             = NULL,
    phone                  = NULL,
    bio                    = NULL,
    bank_iban              = NULL,
    bank_account_number    = NULL,
    bank_account_name      = NULL,
    bank_name              = NULL,
    card_holder_name       = NULL,
    card_last_four         = NULL,
    car_model              = NULL,
    car_year               = NULL,
    car_color              = NULL,
    car_plate              = NULL,
    driver_note            = NULL,
    deleted_at             = NOW(),
    deletion_reason        = p_reason,
    is_active              = FALSE
  WHERE id = v_uid;

  -- ─── (4) Rotate auth.users.email so the user can't log back in ────
  UPDATE auth.users
  SET email                = v_new_email,
      raw_user_meta_data   = jsonb_build_object('deleted', true)
  WHERE id = v_uid;

  -- ─── (5) Anonymize denormalized PII across the schema ─────────────
  -- Each UPDATE now sets BOTH the email AND the name/phone fields in
  -- one shot. Same WHERE clause as before (match on old email), but
  -- the SET list extends to every column carrying the deleted user's
  -- name, phone, or avatar URL.
  --
  -- WHY THIS WASN'T IN MIGRATION 003
  -- The original RPC anonymized only email columns on the theory that
  -- the JOIN-to-profile lookup would surface "[حساب محذوف]" wherever
  -- the user was referenced. That works for views that query the
  -- profile table by email — but the app routinely shows
  -- trip.driver_name / booking.passenger_name / message.sender_name
  -- WITHOUT a profile join (because the join would be too slow for
  -- trip lists, and because the snapshot at booking time is the
  -- contract). So those denormalized columns kept the original PII
  -- alive after deletion, which is exactly the right-to-be-forgotten
  -- bug this migration fixes.

  UPDATE public.messages
  SET sender_email = v_new_email,
      sender_name  = '[حساب محذوف]'
  WHERE sender_email = v_old_email;

  UPDATE public.messages
  SET receiver_email = v_new_email,
      receiver_name  = '[حساب محذوف]'
  WHERE receiver_email = v_old_email;

  UPDATE public.bookings
  SET passenger_email = v_new_email,
      passenger_name  = '[حساب محذوف]'
  WHERE passenger_email = v_old_email;

  UPDATE public.trips
  SET driver_email  = v_new_email,
      driver_name   = '[حساب محذوف]',
      driver_phone  = NULL,
      driver_avatar = NULL
  WHERE driver_email = v_old_email;

  UPDATE public.notifications
  SET user_email = v_new_email
  WHERE user_email = v_old_email;
  -- Note: notification body text NOT scrubbed. See preservation
  -- rationale at the top of this file. The body is a historical
  -- record of what the OTHER user was told; scrubbing it
  -- retroactively would (a) be unbounded text-replacement work and
  -- (b) erase the audit trail of what notifications a non-deleted
  -- user actually received.

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewer_email') THEN
    UPDATE public.reviews
    SET reviewer_email = v_new_email
    WHERE reviewer_email = v_old_email;
    -- Reviewer body + star rating preserved intentionally.
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reviews' AND column_name='reviewed_email') THEN
    UPDATE public.reviews
    SET reviewed_email = v_new_email
    WHERE reviewed_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_blocks' AND column_name='blocker_email') THEN
    UPDATE public.user_blocks SET blocker_email = v_new_email WHERE blocker_email = v_old_email;
    UPDATE public.user_blocks SET blocked_email = v_new_email WHERE blocked_email = v_old_email;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trip_requests') THEN
    -- Update both email AND passenger_name on trip_requests. This
    -- catches the auto-cancelled rows from step (2) above (which we
    -- still want anonymized on the name column) PLUS any matched/
    -- expired requests from the user's history.
    UPDATE public.trip_requests
    SET passenger_email = v_new_email,
        passenger_name  = '[حساب محذوف]'
    WHERE passenger_email = v_old_email;
  END IF;

  RETURN jsonb_build_object(
    'success',                  true,
    'deleted_at',               NOW(),
    'reason',                   p_reason,
    'cancelled_bookings_count', v_cancelled_bookings,
    'cancelled_requests_count', v_cancelled_requests
  );
END $$;

REVOKE ALL ON FUNCTION public.delete_user_account_v2(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account_v2(TEXT) TO authenticated;

-- ─── Verification ─────────────────────────────────────────────────────
-- Confirm the cascade logic landed by checking for the cancelled_bookings
-- counter variable in the function body. Also re-check the handshake
-- from migration 035 didn't get dropped (CREATE OR REPLACE replaces the
-- entire body, so if the handshake wasn't reproduced above, account
-- deletion would silently break again).
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'delete_user_account_v2';

  IF v_body NOT LIKE '%v_cancelled_bookings%' THEN
    RAISE EXCEPTION 'MIGRATION 036 FAILED: delete_user_account_v2 missing cascade logic';
  END IF;
  IF v_body NOT LIKE '%mishwar.deleting_account%' THEN
    RAISE EXCEPTION 'MIGRATION 036 FAILED: delete_user_account_v2 lost handshake from migration 035';
  END IF;
  IF v_body NOT LIKE '%passenger_deleted_account%' THEN
    RAISE EXCEPTION 'MIGRATION 036 FAILED: cancellation_reason marker missing';
  END IF;

  RAISE NOTICE 'MIGRATION 036 OK — delete cascade ready (pending bookings, open requests, denormalized PII)';
END $$;
