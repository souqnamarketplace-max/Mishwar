# Mishwaro Page-by-Page Bug Audit — May 2026

## Methodology

For each page:

1. **Read top-to-bottom** looking for:
   - Null/undefined reference crashes (`user.foo` when user might be null)
   - Missing error handlers on mutations
   - Race conditions (stale closures, missing deps in useEffect)
   - RLS / auth assumption errors
   - Mobile / RTL layout breaks
   - A11y gaps (missing labels, broken keyboard nav)
   - Dead code / unreachable branches
   - Inconsistent state (UI says one thing, DB says another)
   - Memory leaks (subscriptions, intervals not cleaned up)
   - XSS / injection holes
   - Performance footguns (N+1 queries, large lists without virtualization)

2. **For each issue found** classify as:
   - 🔴 **CRITICAL** — crash, data loss, security
   - 🟠 **HIGH** — broken feature, wrong data shown to user
   - 🟡 **MEDIUM** — UX glitch, edge case
   - 🟢 **LOW** — cosmetic, future-proofing

3. **Fix critical & high in-batch.** Note medium/low for a follow-up.

## Page priority (high-traffic first)

| # | Page | LOC | Status | Issues found |
|---|------|-----|--------|--------------|
| 1 | Home.jsx | 27 | ✅ done | 3 real (HeroSection JSON.parse crash, HeroSection .img.replace crash, StatsBar NaN/5) |
| 2 | SearchTrips.jsx | 371 | ✅ done | 2 real (sort NaN when time is null, error state hidden as empty state) |
| 3 | TripDetails.jsx | 1126 | ✅ done | 3 real (favorites state stale on slug URLs, fake amenity bullets, false marketing trust badges) |
| 4 | MyTrips.jsx | 644 | ✅ done | 3 real (duplicate statusConfig key, allTrips fetching wrong rows hiding old bookings, knock-on driver-not-notified) |
| 5 | Messages.jsx | 1127 | ✅ done | 2 real (chatEmails array mutation, N parallel mark-as-read UPDATEs) |
| 6 | CreateTrip.jsx | 1189 | ✅ done | 1 cross-page (payment method ID inconsistency across booking/display/creation surfaces — fixed in TripDetails) |
| 7 | Onboarding.jsx | 738 | ✅ done | 2 real (no MIME validation on 4 uploads, no bio maxLength) |
| 8 | Login.jsx | 866 | ✅ done | 3 real (rate-limit dead code, email format unchecked, rate-limit never reset on success) |
| 9 | AccountSettings.jsx | 1341 | ✅ done | 6 real incl. 1 CRITICAL (license docs to public bucket, password no current-check, password no compliance, email no format check, avatar no MIME/size, Promise.all not allSettled, prod console.logs) |
| 10 | BecomeDriver.jsx | 718 | ✅ done | 0 real (clean — uses uploads-private correctly; was the reference impl AccountSettings should have followed) |
| 11 | UserProfile.jsx | 528 | pending | |
| 12 | Dashboard.jsx | 512 | pending | |
| 13 | RequestTrip.jsx | 462 | pending | |
| 14 | PassengerVerification.jsx | 411 | pending | |
| 15 | Notifications.jsx | 391 | pending | |
| 16 | PassengerRequests.jsx | 382 | pending | |
| 17 | MyRequests.jsx | ? | pending | |
| 18 | DriverDashboard.jsx | ? | pending | |
| 19 | Favorites.jsx | ? | pending | |
| 20 | Feedback.jsx | ? | pending | |
| - | (static pages below not audited) | | | About, Blog, Community, Help, HowItWorks, Privacy, Safety, Terms |

---

## Findings log

### Page 1 — Home.jsx (composition only; children carry logic)

**🟠 HIGH — HeroSection.jsx line 77: `JSON.parse(raw)` unguarded**
If admin saves malformed JSON to `app_settings.hero_city_slides` (e.g. via raw SQL editor), `JSON.parse` throws, queryFn throws, react-query marks failure, the entire hero stays blank on every refresh.
**Fix:** wrapped in try/catch with dev-only console.warn; fall through to bundled fallback gradient. ✅

**🟠 HIGH — HeroSection.jsx lines 186, 257: `s.img.replace(...)` unguarded**
If a slide object is missing `.img` (admin deletes an image but leaves the row), `.replace` throws TypeError on undefined, entire `slides.map` errors, React error boundary blanks the hero.
**Fix:** (a) tightened the filter above so slides without a string `.img` are excluded; (b) belt-and-braces `typeof s.img === "string"` check at the render sites. ✅

**🟡 MEDIUM — StatsBar.jsx line 87: avgRating shows "NaN/5" when any review has null rating**
A single review with `rating === null` propagates through `reduce` and the home page displays "NaN/5" on the average-rating stat tile. Visible on a marketing surface.
**Fix:** filter to `typeof r.rating === "number" && !isNaN(r.rating)` before averaging. ✅

**False alarms checked:**
- `api.entities.Trip.subscribe()` returning non-function — verified it does return a cleanup fn.
- `AnimatedNumber` `value.toString()` on null — verified all callers pass guaranteed numbers.

### Page 2 — SearchTrips.jsx

**🟠 HIGH — line 145: sort comparator returns NaN when `t.time` is null**
`new Date(a.date + " " + null)` is Invalid Date. Subtracting two Invalid Dates yields NaN. Array.sort with a NaN comparator gives implementation-defined ordering — passengers see a jumbled trip list. Legacy rows without time were the trigger.
**Fix:** fallback to `'00:00'` when time is null so the Date is still valid. Also added `|| 0` to price branches as belt-and-braces. ✅

**🟠 HIGH — line 55→330: `error` from the query is destructured but never rendered**
When the trips query fails (RLS denial, network down), the page falls through to the empty state ("لا توجد رحلات بهذه المعايير"). Users think their search criteria are wrong and loop on changing filters when actually the network failed.
**Fix:** added an explicit error branch with a retry button that invalidates the trips query. ✅

**🟡 LOW noted, not fixed (filter inconsistency):**
- Line 131 `t.price > parseFloat(maxPrice)` — null/string prices silently pass the filter. Acceptable since results are still queryable, and the inconsistency is hidden.
- `isTripExpired(t)` called inside `.filter` on every re-render — perf footgun on 500 trips, not a bug.

### Page 3 — TripDetails.jsx

**🟠 HIGH — line 166: `useState(() => getFavs().has(id))` stale on slug URLs**
The useState initializer only runs once. For slug URLs, `id` is `null` at first render (the trip hasn't resolved yet), so `getFavs().has(null)` returns false. When the trip resolves and id becomes a real UUID, this state never updates — the heart icon stays un-favorited even on trips the user previously favorited.
**Fix:** moved to useEffect that re-syncs when `id` (or `favKey`, i.e. user email) changes. Initial state false; effect populates correct value when id is known. ✅

**🟠 HIGH — lines 431-443: hardcoded fake amenities**
The sidebar showed "تكييف، موسيقى، مسموح بالتدخين، حقيبة" on EVERY trip regardless of the driver's actual `trip.amenities` / `pref_smoking` / `pref_pets`. A driver who explicitly DISABLED smoking would still see their trip page advertising "مسموح بالتدخين" to passengers. The real amenity-chip logic exists further down in the page (line 705+) — the sidebar block was redundant fake duplication.
**Fix:** removed the hardcoded list; kept just the seat-count bullet. Real amenity chips already render in the main details panel. ✅

**🟠 HIGH — lines 1107-1123: false marketing claims in trust badges**
Four badges claimed: (1) 24/7 support team (doesn't exist), (2) "complete protection for your payments" (payments are external via Jawwal/Reflect/bank, not in-app), (3) free cancellation (true but vague), (4) "thousands of users trust us" (same fake claim being scrubbed elsewhere). App Store reviewers flag this as misleading marketing.
**Fix:** replaced with 4 truthful claims about features we actually ship: in-app messaging, mutual rating system, cancel-before-trip, user reporting to admins. ✅

### Page 4 — MyTrips.jsx

**🟡 MEDIUM — lines 33,37: `statusConfig.cancelled` defined twice**
JavaScript silently uses the second definition (destructive theme) and the first (red-100) is dead. Not a runtime bug since the second is the intended one, but the duplicate made it look like an inconsistency and was the kind of thing that bites someone later.
**Fix:** deduped, kept the destructive-themed version, reordered keys to match status flow. ✅

**🔴 CRITICAL — lines 191-194: `allTrips` fetched the platform's 200 newest trips, not the user's booked trips**
`api.entities.Trip.list("-created_date", 200)` returns the latest 200 trips on the entire platform, then the page filtered to `bookedTripIds.has(t.id)`. The instant the platform has more than 200 trips newer than the user's booked one, **the booking disappears from /my-trips** — the trip isn't in `allTrips` to be filtered in. The user thinks their booking was cancelled. Heavy bandwidth waste too (200 unrelated trips on every load).
**Fix:** new query `["my-booked-trips", email, idsKey]` that queries trips with `.in("id", myBookedTripIds)`. Fetches only the trips the user has bookings on. Scales with the user's booking count (1-50) instead of platform size. Updated 2 invalidation sites to use the new queryKey. ✅

**🟠 HIGH (knock-on of CRITICAL above) — line 137-138: cancel-booking driver notification silently skipped**
When passenger cancels a booking, the cancel handler does `allTrips?.find(t => t.id === booking?.trip_id)` to look up the driver email for the notification. With the old `allTrips` query, if the booked trip wasn't in the latest 200 platform trips, `trip` was undefined, the `if (trip?.driver_email...)` guard silently skipped, and **the driver never got bell-pinged about the cancellation**. Seat went back into the pool with no driver awareness.
**Fix:** automatic — by fixing the `allTrips` query above, the lookup now always finds the trip the booking is on. ✅

### Page 5 — Messages.jsx

**🟡 MEDIUM — line 177: `chatEmails.sort()` mutates the useMemo'd array**
`chatEmails` is returned from `useMemo` — same reference across renders. `.sort()` mutates in place, silently corrupting the cached value. Subsequent renders would see the already-sorted array. Not a runtime crash but a foot-gun.
**Fix:** spread before sort: `[...chatEmails].sort()`. ✅

**🟠 HIGH — lines 390-401: N parallel UPDATE queries on mark-as-read**
Opening a conversation with 50 unread messages fired 50 individual `UPDATE messages SET is_read=true WHERE id=X` queries in parallel. Slow on mobile, wasteful on Supabase quota. Also the silent `.catch(() => {})` hid RLS failures during testing.
**Fix:** single batch UPDATE using `.in("id", unreadIds)` — one round trip regardless of unread count. Errors now surface in dev console via `import.meta.env.DEV` guard. ✅

**False alarms checked:**
- Line 118 `.or(\`sender_email.eq.${email}...\`)` — PostgREST injection concern. Verified: emails are validated server-side before insertion, and RLS would deny crafted queries even if they parsed. Not a real issue.

### Page 6 — CreateTrip.jsx

**🟠 HIGH (cross-page) — payment method ID inconsistency across 5+ surfaces**
We have 3 different ID conventions in use simultaneously:
| File | Bank | Jawwal | Reflect | Card |
|---|---|---|---|---|
| CreateTrip (form) | bank_transfer | jawwal_pay | reflect | (none) |
| CreateTrip (autosave) | bank_transfer | jawwal_pay | reflect | credit_card |
| TripDetails (display panel) | bank_transfer | (missing) | (missing) | card |
| TripDetails (booking modal) | **bank** | **jawwal** | reflect | (none) |
| PassengerPaymentSetup | bank_transfer | jawwal_pay | reflect | card |
| DriverPaymentSetup | **bank** | (missing) | reflect | (none) |

Consequence: a driver enables bank_transfer at trip creation → trip row stores `["bank_transfer"]` → booking modal looks for `"bank"` → no match → bank option silently absent from passenger's payment choices. Same for jawwal_pay vs jawwal. Same for credit_card vs card on the display panel. Drivers confused: "I enabled these methods, why aren't passengers using them?"
**Fix (this batch):** aligned the TripDetails booking modal + display panel with the canonical `bank_transfer` / `jawwal_pay` / `reflect` / `credit_card` IDs used everywhere else. Drivers' enabled methods now show up to passengers as intended.
**Deferred:** DriverPaymentSetup.jsx still uses `"bank"` (not `"bank_transfer"`). This is a setup-time UI inconsistency but doesn't affect trip data shape. Worth a follow-up but not in this batch's scope. Flagged in the page when we get to it. 🟡

**False alarms / deferred:**
- Recurring trip date logic at line 425-437: when picked date IS one of the recurring days, the trip publishes for +7 days from picked date rather than ALSO for the picked date. May be intentional UX; flagging for product review. 🟡

### Page 7 — Onboarding.jsx

**🟠 HIGH — 4 file-upload handlers had no MIME validation**
`accept="image/*"` (or `image/*,application/pdf`) is a UX hint only. Browsers (especially Android Capacitor WebView and accessibility-mode pickers) often ignore it — users can select a `.txt` / `.exe` / random binary file and it goes straight to Supabase storage. A non-image stored as an avatar then renders as a broken image everywhere it's shown.
**Fix:** new `isAllowedUpload(file, { imageOnly })` helper checks `file.type` is `image/*` (avatars/selfies) or `image/* + application/pdf` (license docs). Wired into all 4 upload handlers (avatar, license, car-reg, insurance, selfie). User sees a clear Arabic toast on bad types instead of a silent malformed upload. ✅

**🟡 MEDIUM — bio textarea had no maxLength**
A user could paste 100k characters into the bio field. DB write either bloats the profiles table (no schema cap visible) or fails with a non-friendly Postgres error. Either way, bad UX.
**Fix:** added `maxLength={500}` matching the bio width shown elsewhere in the app, plus a live counter that turns red at 90% capacity. The counter is hidden when empty so it doesn't clutter the field. ✅

### Page 8 — Login.jsx

**🟠 HIGH — `incrementAttempts()` defined but NEVER CALLED**
The rate-limit infrastructure looked complete: `checkRateLimit()`, `incrementAttempts()`, `getRateLimit()`, comment claiming "Brute force protection — max 5 attempts per 15 minutes." But `incrementAttempts` was never invoked anywhere in the file. The whole rate-limit was dead code — `checkRateLimit()` always returned true because nothing wrote to the storage key. A client could hammer the login endpoint indefinitely (subject only to Supabase's server-side limit, which DOES catch this — so not a critical security hole, but the UX intent was completely broken).
**Fix:** call `incrementAttempts()` on every failed auth attempt EXCEPT the "email not confirmed" case (that's a legitimate user trying to recover, not a brute-force). Now after 5 bad password attempts within 15 minutes the user sees the timeout toast. ✅

**🟠 HIGH — Email format never validated before submit**
Login form accepted `user@gmail` (no TLD), `user@`, `@gmail.com` and similar typos. Server rejected with a generic "failed" toast. Also: the rate-limit check ran BEFORE the field-presence check, so empty-form submits theoretically counted against the limit (though see above — the limit was dead anyway).
**Fix:** validate `isValidEmail(form.email)` before submit, with a specific "صيغة البريد الإلكتروني غير صحيحة" toast. Moved field-presence + email-format BEFORE the rate-limit check so unrelated input errors don't burn rate-limit slots. ✅

**🟡 MEDIUM — Rate-limit never reset on successful login**
A user at 4 attempts who finally gets the password right keeps the counter pinned at 4 across sessions. Next time they typo their password, ONE attempt locks them out for 15 minutes.
**Fix:** `localStorage.removeItem('mishwaro_login_rl')` on successful login. Canonical reset-on-success pattern. ✅

**False alarms:**
- Client-side rate limit being bypassable via incognito / devtools — true, but server-side Supabase rate limit handles it. Worth noting in comments (already done).

### Page 9 — AccountSettings.jsx

**🔴 CRITICAL — `uploadFile` writes identity-grade PII to the PUBLIC bucket**
License photos, car registration documents, insurance documents, and identity selfies were being uploaded to the `'uploads'` bucket (public-read). The full publicUrl was stored in the DB column, meaning anyone with the URL had **permanent unauthenticated read access** to a driver's government ID, license photo, or selfie. URLs leak via screenshots, admin audit logs, support chats, anywhere they're referenced. BecomeDriver.jsx already does this correctly (uses `'uploads-private'` with signed-URL resolution via licenseUrls.js); AccountSettings was the inconsistent re-upload path. **Real privacy bug — App Store / GDPR concern.**
**Fix:** route to `'uploads-private'`, store the path (not URL), let resolveDocumentUrl sign at render time. Legacy rows with full URLs continue working via the isPublicHttpUrl pass-through in that helper. ✅

**🟠 HIGH — Password update never verified the current password**
The form asked for the current password but never checked it. `supabase.auth.updateUser({ password })` only requires a valid session — anyone with an open session on a public computer could change the password without knowing the existing one. UI was lying to the user about what protection was in place.
**Fix:** call `signInWithPassword` on the user's own email with the current password before allowing the change. Wrong → toast + early return. Right → continue to updateUser. (Re-authenticating to the same account doesn't disturb the active session.) ✅

**🟠 HIGH — Password update missing Supabase policy compliance check**
Same problem Login.jsx had: server requires lowercase + uppercase + digit + 8 chars but the client only checked length. Users typing 'alllowercase' got a generic 422 error.
**Fix:** added `validatePasswordCompliance` check matching the rules used in signup and password recovery. Also added "new must differ from current" check — was missing. ✅

**🟡 MEDIUM — Email update no format validation**
Same as Login — any string went to Supabase, returned a generic error. Also: success toast claimed "تم تحديث" but Supabase actually emails a confirmation link to the NEW address; the change isn't applied until they click. Toast was misleading.
**Fix:** added isValidEmail check; updated success toast to say "تم إرسال رسالة تأكيد إلى البريد الجديد" with longer duration. ✅

**🟠 HIGH — Avatar upload no MIME or size validation**
Same defect as Onboarding had (pre-batch-4 fix). Avatar bucket is public, so any uploaded file is permanently web-accessible.
**Fix:** check `file.type.startsWith("image/")` + 5MB cap up front. ✅

**🟡 MEDIUM — Avatar trip-update used Promise.all instead of allSettled**
When the avatar updates, the page fetches the user's last 100 trips and updates each with a fresh `driver_avatar` URL. If ANY single trip-update failed (RLS race, deleted trip, etc.), `Promise.all` rejected the whole chain. The avatar IS already saved on the profile by that point, but the user sees "تعذر رفع الصورة" and thinks the entire upload failed.
**Fix:** `Promise.allSettled` — partial failures tolerated, the profile-level avatar is the source of truth, trips reconcile on next read. ✅

**🟡 LOW — Two production console.logs leaking account internals**
One explicitly comment-marked "Once stable, remove this log." Page is now stable. The second logged the self-heal RPC result on every mount.
**Fix:** removed both. ✅

### Page 10 — BecomeDriver.jsx

**No real bugs.** The wizard correctly uses `uploads-private` for all identity docs (the comment at line 169-177 explains exactly why), validates dates server-of-truth (re-checks on submit even if input min was bypassed), uses per-field uploading state for concurrent uploads, and properly hydrates from existing license rows for resume-after-rejection.

This was the reference implementation that AccountSettings's uploadFile should have followed. ✅





