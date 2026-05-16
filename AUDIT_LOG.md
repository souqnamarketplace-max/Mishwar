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
| 11 | UserProfile.jsx | 536 | ✅ done | 1 real (fake 92% acceptance rate default) |
| 12 | Dashboard.jsx | 535 | ✅ done | 4 real (today-vs-all-time label lies, fake weekly grouping, fake daily timeseries, 'both' users double-counted in pie) |
| 13 | RequestTrip.jsx | 477 | ✅ done | 1 real (rules-of-hooks violation on auth gate) |
| 14 | PassengerVerification.jsx | 425 | ✅ done | 1 real (rules-of-hooks violation on auth gate) |
| 15 | Notifications.jsx | 393 | ✅ done | 3 real (missing onError handlers on 3 mutations, unbounded max_price input) |
| 16 | PassengerRequests.jsx | 396 | ✅ done | 2 real (queryKey not scoped to user — cache leak across sessions, navigate-during-render) |
| 17 | MyRequests.jsx | 233 | ✅ done | 1 real (rules-of-hooks violation on auth gate) |
| 18 | DriverDashboard.jsx | 333 | ✅ done | 2 real incl. 1 CRITICAL (earnings understated for older trips, payment_method label mismatch) |
| 19 | Favorites.jsx | 145 | ✅ done | 1 CRITICAL (favorites of older trips silently disappearing — same anti-pattern as MyTrips) |
| 20 | Feedback.jsx | 209 | ✅ done | 2 real (notifyAdmin awaited in mutationFn could fail entire submit, no maxLength on inputs) |
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

### Page 11 — UserProfile.jsx

**🟡 MEDIUM — Fake 92% acceptance rate for users with no data**
`bookings.length ? real_rate : 92`. Brand-new users with zero bookings displayed "معدل القبول 92%" — fabricated marketing number on every empty profile. App Store review and basic data honesty both rule this out. Same pattern as the false "thousands of users trust us" claims being scrubbed elsewhere.
**Fix:** default to `null`. Render-site conditional hides the stat card when `null` instead of showing fake data. ✅

**🟡 LOW noted, not fixed (semantic):**
- `acceptanceRate` is computed from the target's own passenger-bookings cancellation rate, but the label is generic "معدل القبول" — conflates driver acceptance with passenger no-shows. The metric is ambiguous on a profile that could be either role. Worth a product-level decision before reworking. 🟡

### Page 12 — Dashboard.jsx

**🟠 HIGH — Stat cards labeled "today" displayed all-time numbers**
"المستخدمين النشطين اليوم" (Active users today) showed `totalUsers.toString()` — all users ever. "الحجوزات اليوم" (Bookings today) showed `confirmedBookings.toString()` — all confirmed bookings ever. The labels promised today data; the values were all-time. Admin decisions were being made on inflated numbers.
**Fix:** computed real `usersToday` / `bookingsToday` from `created_at >= today` filter. Cards labeled "today" now use today counts; cards labeled "إجمالي" use all-time. ✅

**🟠 HIGH — Revenue chart "Week 1/2/3/4" was NOT weeks**
`bookings.slice(0, 25)` / `.slice(25, 50)` / etc., labeled "الأسبوع 1" through "الأسبوع 4". These were arbitrary 25-row index chunks from a list ordered by `-created_date`. So "Week 1" = "the 25 newest bookings". Numbers had no relation to actual weeks. Admin analytics built on this would draw false conclusions.
**Fix:** group by actual calendar week using `created_at` date arithmetic. Each bucket sums revenue from bookings created in a rolling 7-day window. Confirmed/completed status filter applied so cancelled bookings don't inflate revenue. ✅

**🟠 HIGH — Daily trips chart labels lied about being a daily timeseries**
`trips.slice(0, 7).map(t => ({ name: t.created_at, value: t.price }))`. Labels were the creation dates of the 7 most recent trips — could all be from today, or all spread across the past month. Bars represented prices of individual trips, not daily totals. Confusing chart.
**Fix:** bucket by calendar day for the last 7 days; bar value = count of trips created on that day (zero days included). Labels are now real dates, values are real daily volumes. ✅

**🟡 MEDIUM — Users of type "both" double-counted in pie chart**
`passengerCount = users.filter(u => u.account_type === "passenger" || u.account_type === "both")` AND `driverCount = users.filter(u => u.account_type === "driver" || u.account_type === "both")`. A user of type "both" was counted in BOTH segments. If you had 100 users all "both", the pie showed 200 slices. Visual misrepresentation of platform composition.
**Fix:** split into three exclusive categories — passenger-only, driver-only, both. Each user counted exactly once. Pie filter drops zero-count slices so the chart isn't cluttered when one category is empty. ✅

### Page 13 — RequestTrip.jsx

**🟠 HIGH — Rules-of-hooks violation on auth gate**
Lines 121-124 (old): `if (!isAuthenticated) { navigate(...); return null; }`. This early-return ran AFTER two `useQuery`s and BEFORE `useMutation` + `useMemo`. Hook count was 3 on un-authed renders, 5 on authed renders. React's rules-of-hooks require invariant hook order across renders. Worse, the file comment further down (lines 126-128 in the original) explicitly warned about this for the verification gate but did the same anti-pattern for the auth gate immediately above.
**Why no production crash?** On the very first render `isLoadingAuth=true` so the early-return didn't fire — all hooks ran. The bug only triggered when auth state resolved to `unauthenticated` on a later render, reducing the hook count. React's prod build is more lenient but dev mode throws.
**Fix:** moved auth check into a `useEffect` that runs as a side-effect after all hooks have been called. Page returns a loading splash for the brief window between effect-fire and route change. Hook count is now invariant across renders. ✅

### Page 14 — PassengerVerification.jsx

**🟠 HIGH — Rules-of-hooks violation on auth gate**
Same pattern as RequestTrip — inline `if (!authed) { navigate; return null }` placed BEFORE the page's useQuery, useState, useMutation calls. On the first render `isLoadingAuth=true` so the gate didn't fire and all hooks ran. On a later render where auth resolved to false, the gate triggered and ~10 subsequent hooks were skipped. Hook count varied between renders.
**Fix:** moved redirect into a `useEffect` AFTER all hooks. Loading splash bridges the navigation. Hook count invariant. ✅

**False alarm investigated:**
- `upload()` helper at line 88-99 had no MIME/size validation. Looked like the same upload defect from Onboarding/AccountSettings. Verified: validation lives in the `PhotoField` component at line 344-355 — checks `^image/` MIME prefix and 10MB cap before passing the file up. So the upload helper sees only validated files. Not a bug.

### Page 15 — Notifications.jsx

**🟡 MEDIUM — Three mutations missing `onError` handlers**
`createPref`, `togglePref`, `deletePref` all had `onSuccess` but no `onError`. RLS denials and network errors silently kept the UI in its previous state — user clicked save, modal stayed open, nothing toasted, they tried again, still nothing.
**Fix:** added `onError: (err) => toast.error(friendlyError(err, "..."))` to all three. Errors are now visible. ✅

**🟡 MEDIUM — Unbounded max_price input**
The number input had no `min`/`max` attributes, and the mutation did `data.max_price ? Number(data.max_price) : null` with no clamping. A user could type `-50` or `99999999` and it would land in the DB.
**Fix:** added `min="0" max="1000"` to the input (matches RequestTrip.suggested_price bounds); mutation clamps to that range as belt-and-braces (handles edge case of paste / direct DOM manipulation bypassing the input attrs). ✅

### Page 16 — PassengerRequests.jsx

**🟡 MEDIUM — `queryKey: ["passenger-requests-feed"]` not scoped to user**
The feed is global, but the queryKey wasn't scoped to `user?.email`. When User A (subscribed) loaded the page, fetched the feed, then signed out, and User B signed in, react-query happily served User B the cached feed from User A's session. The data is global so it's not a security issue, but it's a stale-cache-across-sessions footgun — User B might see slightly outdated data, and if the feed schema ever changes, weird interactions could happen.
**Fix:** scoped queryKey to `["passenger-requests-feed", user?.email]` so different sessions get isolated cache entries. ✅

**🟡 LOW — navigate-during-render anti-pattern**
Inline `if (!authed) { navigate; return null }` was after all hooks here (so hook count was stable, unlike RequestTrip/PassengerVerification), but calling `navigate()` during render is still a React anti-pattern that strict mode warns about ("Cannot update a component while rendering a different component"). Effects are where side effects belong.
**Fix:** moved to useEffect, returns a loading splash during the brief redirect window. ✅

### Page 17 — MyRequests.jsx

**🟠 HIGH — Rules-of-hooks violation on auth gate**
Same pattern as RequestTrip, PassengerVerification. Inline `if (!authed) { navigate; return null }` between `useState`/`useAuth` (above) and `useQuery`/`useMutation` (below). Hook count was 3 on un-authed renders, 5 on authed renders. Worked in practice because `isLoadingAuth=true` on first render shielded it, but later renders triggering the gate would skip subsequent hooks.
**Fix:** moved to useEffect after all hooks; loading splash bridges navigation. Hook count invariant. ✅

### Page 18 — DriverDashboard.jsx

**🔴 CRITICAL — Driver earnings understated for older trips**
Same anti-pattern as MyTrips. `Booking.list("-created_date", 500)` returned the platform's 500 newest bookings then filtered client-side to `tripIds`. A driver with bookings on trips older than the 500 newest platform bookings silently lost them from this view. **`totalEarnings` is derived from this filtered set** — meaning the driver's REPORTED EARNINGS would be understated. The per-trip breakdown would show ₪0 for older trips that still had paid bookings. Earnings affect tax records and trust — admin pages and driver self-perception would diverge.
**Fix:** query bookings by `.in("trip_id", tripIds)` so we fetch exactly the bookings on this driver's trips, regardless of age. Empty tripIds → skip query entirely. Same fix shape as MyTrips. ✅

**🟡 MEDIUM — Payment method label dictionary used stale ID `'card'` instead of `'credit_card'`**
We standardized payment IDs to `bank_transfer / jawwal_pay / reflect / credit_card` in batch 3. `EarningsTab.methodLabel` here still had `card: "بطاقة 💳"` while CreateTrip emits `credit_card`. Drivers who took credit-card payments saw the raw `credit_card` string in their earnings breakdown (via the `methodLabel[method] || method` fallback) instead of a friendly Arabic label.
**Fix:** changed key from `card` to `credit_card`, matching the canonical ID emitted at trip creation. ✅

### Page 19 — Favorites.jsx

**🔴 CRITICAL — Favorites of older trips silently vanishing**
Identical anti-pattern to the MyTrips critical fix in batch 2. `Trip.list("-created_date", 200)` returned the platform's 200 newest trips, then filtered client-side to `favIds`. A user favoriting a trip in March would lose it from `/favorites` once the platform had 200+ newer trips — user thinks the trip was deleted, but localStorage still has the ID. Confusing UX, same root cause we already fixed twice (MyTrips bookings, now also DriverDashboard bookings).
**Fix:** query trips by `.in("id", favIdsArray)`. Scales with user's favorites count (1-20) instead of platform size. Empty favIds → skip query. ✅

### Page 20 — Feedback.jsx

**🟠 HIGH — `notifyAdmin` awaited inside mutationFn — admin notification failure rejected user's submission**
The comment said "Fire-and-forget; a failure here shouldn't block the user's success toast" but it actually used `await notifyAdmin(...)` inside the mutationFn. If the admin notification insert failed (e.g. RLS edge case, network blip), the WHOLE mutation rejected and the user saw "تعذر إرسال الملاحظة — حاول مجدداً" — **even though their support ticket was already created successfully**. They'd retry, creating duplicate tickets, and admins would see two of every complaint.
**Fix:** moved `notifyAdmin` out of `mutationFn` and into `onSuccess` with explicit `.catch(() => {})`. Ticket creation is now authoritative success; admin ping is best-effort decoration. ✅

**🟡 MEDIUM — Subject and message inputs had no maxLength**
A user could paste 100k characters into either field. DB write either bloats the support_tickets table or fails with an unhelpful Postgres error. Same defect as the Onboarding bio fix.
**Fix:** subject → 200 chars, message → 2000 chars. Live counter on message at 80% / red at 95%. ✅

---

## ✅ Audit Complete

**20 of 20 pages audited.** Comprehensive findings:
- **40+ real bugs** found and fixed across 8 batches
- **4 CRITICAL** bugs (MyTrips/Favorites/DriverDashboard disappearing data, AccountSettings public-bucket privacy issue)
- **0 deferred** beyond the documented follow-ups (legacy public-bucket migration, recurring-trip date UX review, UserProfile semantic acceptance-rate decision, DriverPaymentSetup ID normalization)

**Patterns that recurred across the audit:**
1. **Platform-newest-N anti-pattern** appeared FOUR times: MyTrips (bookings), DriverDashboard (bookings), Favorites (trips), and was almost in batch 1's StatsBar before being noticed. Whenever you see `entity.list("-created_date", N)` followed by a client-side filter, the data invisibly disappears once the platform grows past N rows. Always query by ID set instead.
2. **Rules-of-hooks** auth gate pattern appeared FOUR times: RequestTrip, PassengerVerification, PassengerRequests (mild), MyRequests. Useeffect for auth redirects, not inline early-returns.
3. **Missing `onError` handlers** on mutations meant RLS denials were invisible to users — appeared on Notifications (3 mutations).
4. **Fake marketing numbers** (24/7 support, "thousands of users", 92% acceptance default) appeared on TripDetails, UserProfile, Home/StatsBar. App Store reviewers flag these.
5. **Payment method ID inconsistency** across 6 surfaces — fixed in TripDetails (booking modal + display panel) and DriverDashboard (earnings labels). One outlier remains in DriverPaymentSetup (setup-time UI only, doesn't affect trip data shape).






---

# Component-Level Audit (Phase 2)

After the 20-page audit completed, extending the same methodology to
`src/components/`. Total: 103 component files, 14,616 LOC.

## Scope
- **Audited**: high-traffic, business-logic, mutation-emitting,
  auth-touching, payment-touching, file-upload-touching, modal components
- **Skipped**: `src/components/ui/*` (shadcn-generated primitives —
  vendor wrappers around Radix UI, bugs would be upstream)
- **Spot-checked only**: tiny (<50 LOC) presentational components

## Priority order (largest + highest-impact first)

| # | Component | LOC | Status | Real bugs |
|---|-----------|-----|--------|-----------|
| 1 | DriverTripsList.jsx | 939 | ✅ done | 3 real incl. 1 CRITICAL (delete leaves orphan bookings, optimistic on wrong queryKey x2) |
| 2 | MobileLayout.jsx | 646 | ✅ done | 3 real (stale isMobile, back arrow always to /, logout fire-and-forget) |
| 3 | HowItWorks.jsx | 598 | ✅ done | 0 real (pure presentational mockup) |
| 4 | DriverSubscriptionSection.jsx | 517 | ✅ done | 1 CRITICAL (payment proofs to public bucket) |
| 5 | MapCityPicker.jsx | 472 | ✅ done | 2 real (race in click handler + stale closure on disposed map, duplicate maxZoom key) |
| 6 | HeroSection.jsx | 362 | ✅ done | 0 real (defensive code handles edge cases correctly) |
| 7 | DriverPassengers.jsx | 359 | ✅ done | 2 real (optimistic on wrong queryKey x2, no optimistic on markPaid) |
| 8 | UserActionsMenu.jsx | 357 | ✅ done | 1 CRITICAL (rules-of-hooks violation — hook count varied 8 vs 10 between renders) |
| 9 | RouteMap.jsx | 353 | ✅ done | 1 real (duplicate maxZoom key — same defect as MapCityPicker) |
| 10 | DriverReviewWizard.jsx | 336 | ✅ done | 1 real (notifyUser imported nowhere — runtime crash when driver wrote any public_review/private_message) |
| 11 | Navbar.jsx | 331 | ✅ done | 2 real (no click-outside on profile dropdown, fire-and-forget logout x2) |
| 12 | AdminNotificationBell.jsx | 317 | ✅ done | 1 real (markAllRead no optimistic + no onError) |
| 13 | NotificationBell.jsx | 310 | ✅ done | 0 real (well-considered — mobile-tap race already fixed in code) |
| 14 | UserHistorySection.jsx | 297 | ✅ done | 1 real (cancelRate severity ternary unreachable danger branch) |
| 15 | FeaturedTrips.jsx | 280 | ✅ done | 0 real (defensive code, route dedup well-implemented) |
| 16 | PassengerReviewWizard.jsx | 277 | ✅ done | 1 HIGH (best-effort notifications inside authoritative try → duplicate reviews on retry) |

Plus retroactive fix: **DriverReviewWizard.jsx had the same defect as PassengerReviewWizard** — fixed in the same commit. See component 10 row above; this is a 2nd defect found on a 2nd pass.
| 17 | TripCard.jsx | 275 | ✅ done | Symptom of apiClient.subscribe defect — fixed upstream in this batch |
| 18 | BookingRequestPopup.jsx | 251 | ✅ done | Symptom of apiClient.subscribe defect — fixed upstream in this batch |
| 19 | CityAutocomplete.jsx | 245 | ✅ done | 1 real (outside-click handler missing touchstart) |
| 20 | PullToRefresh.jsx | 221 | ✅ done | 0 real (very carefully implemented; ref-based gesture, stable listeners) |
| ★ | **apiClient.js subscribe()** | (~30 LOC change) | ✅ done | 1 CRITICAL (shared-channel teardown race — see below) |
| 21 | DriverPaymentSetup.jsx | 217 | ✅ done | 2 real (HIGH: data loss — IBAN wiped when user loaded async; payment ID alignment from phase 1 follow-up) |
| 22 | AccountHub.jsx | 211 | ✅ done | 1 real (section state didn't clear when URL param removed) |
| 23 | SuggestCityModal.jsx | 208 | ✅ done | 1 real (best-effort notifications inside authoritative try — same pattern as review wizards) |
| 24 | DriverRatingsDashboard.jsx | 185 | ✅ done | 1 real (review filter missed review_type — driver saw their OWN outgoing reviews mixed with incoming, inflating count + skewing average) |

Plus retroactive: **UserHistorySection.jsx had the same review_type filter defect** — fixed alongside DriverRatingsDashboard. Admin's "متوسط التقييم" card for a driver was averaging ratings the driver gave passengers WITH ratings passengers gave the driver. Same fix.
| 25 | DriverRatePassengers.jsx | 171 | ✅ done | 2 real (HIGH: Review.create missing critical fields; MEDIUM: no onError + missing notifyUser/audit) |
| 26 | DriverVehicleEditor.jsx | 170 | ✅ done | 2 real (HIGH: same async-user data-loss as DriverPaymentSetup; MEDIUM: handleSave try/finally with no catch) |
| 27 | StrikeStatusSection.jsx | 170 | ✅ done | 0 real (clean) |
| 28 | PassengerPaymentsSection.jsx | 169 | ✅ done | 1 LOW (payment method ID shown raw instead of Arabic label) |
| 29 | RequestCard.jsx | 143 | ✅ done | 0 real (purely presentational, no state/effects/mutations) |
| 30 | StatsBar.jsx | 149 | ✅ done | 0 real bugs; deferred follow-ups: User.list() + Trip.list(1000) inefficient at scale (count-via-list anti-pattern) |
| 31 | DashboardFilterBar.jsx | 149 | ✅ done | 0 real (callers documented to debounce; date-range timezone handling correct) |
| 32 | LegalSheet.jsx | 133 | ✅ done | 0 real (carefully implemented — ModalPortal, body scroll lock cleanup, Esc-to-close all correct) |
| 33 | DashboardSidebar.jsx | 148 | ✅ done | 2 real (HIGH: logout button had no onClick — completely non-functional; LOW: mobile tab selector outside-click missing touchstart) |
| 34 | GPSTripTracker.jsx | 132 | ✅ done | 1 HIGH (best-effort passenger notifications inside authoritative Trip.update try → "failed" toast despite trip completed → driver retried → duplicate notifications to passengers) |
| 35 | MyReportsSection.jsx | 104 | ✅ done | 0 real (read-only display, clean) |
| 36 | PreferencesSection.jsx | 101 | ✅ done | 0 real (useEffect-from-props pattern correct, save flow proper) |
| 37 | RequestsTeaser.jsx | 100 | ✅ done | 0 real (role-aware CTA + visibility logic well-commented) |
| 38 | VehicleDetailsSection.jsx | 100 | ✅ done | 1 LOW (fake "50% increase in bookings" marketing stat — replaced with qualitative copy) |
| 39 | BlockedUsersSection.jsx | 100 | ✅ done | 0 real (clean unblock flow with proper cache invalidation) |
| 40 | DashboardCharts.jsx | 94 | ✅ done | 0 real (presentational; the "—" placeholder for month-over-month delta matches Dashboard.jsx — data not wired yet, intentional) |
| 41 | ExpiredTripNotifier.jsx | 90 | ✅ done | 1 MEDIUM (markNotified ran after async insert → 60s refetch fired duplicate notification while insert in-flight) |
| 42 | NotificationPrefsSection.jsx | 90 | ✅ done | 0 real (intentional comingSoon gates documented) |
| 43 | PassengerPaymentSetup.jsx | 81 | ✅ done | 2 real (MEDIUM: card → credit_card alignment + legacy normalizer; MEDIUM: same async-user data-loss as DriverPaymentSetup) |
| 44 | CTASection.jsx | 66 | ✅ done | 1 LOW (fake "thousands of Palestinians" marketing claim — replaced with qualitative copy) |
| 45 | ErrorBoundary.jsx | 62 | ✅ done | 0 real (standard React class error boundary, Sentry capture, recovery UI) |
| 46 | AppLayout.jsx | 61 | ✅ done | 2 real (MEDIUM: NetworkStatus only in desktop branch — mobile users got no offline indicator; LOW: missing orientationchange listener) |
| 47 | Pagination.jsx | 61 | ✅ done | 0 real (RTL-aware chevrons, ellipsis logic correct) |
| 48 | ReviewsList.jsx | 56 | ✅ done | 0 real |
| 49 | RatingSummary.jsx | 52 | ✅ done | 1 MEDIUM (no NaN defense on rating average — same pattern StatsBar already had) |

Plus assorted smaller (<100 LOC) components — spot-checked.


## Component Batch 1 — Findings

### Component 1 — DriverTripsList.jsx (939 LOC)

**🔴 CRITICAL — `deleteMutation` left orphan bookings + no passenger notification**
The trip-delete UI showed a warning: "يوجد X راكب محجوزون — سيتم إلغاء حجوزاتهم" ("X passengers booked — their bookings will be cancelled"). But the `deleteMutation.mutationFn` only called `Trip.delete(id)` — **no booking cancellation logic ran**. Booking.trip_id is `text` (not a UUID FK with CASCADE), so the booking rows stayed in the DB pointing at a now-nonexistent trip. Passengers saw a ghost booking forever with no notification of what happened.
The `cancelMutation` did this correctly (flips bookings + notifies passengers); `deleteMutation` was the broken sibling that the warning text *claimed* behaved the same way but didn't.
**Fix:** before deleting the trip row, fetch active bookings, flip them to `cancelled_by_driver` (with refund_required flag for paid bookings), and notify each passenger. Mirrors cancelMutation's flow. ✅

**🟡 MEDIUM — Optimistic updates only wrote to `["trips"]` queryKey, not `["driver-trips", email]`**
The component renders inside the driver dashboard which reads from `["driver-trips", email]`. The optimistic update only touched `["trips"]` (which is what SearchTrips reads). So when a driver tapped start/complete/delete, the UI didn't update optimistically — there was a ~200ms freeze while invalidate→refetch ran. SearchTrips (the irrelevant cache) got the optimistic benefit, the driver's own dashboard didn't.
**Fix:** apply optimistic updates to both queryKeys. Context now stores both previous snapshots so a rollback on error restores both. ✅

**🟡 MEDIUM — Same bug in deleteMutation's optimistic update**
Identical to above. Fixed alongside.

### Component 2 — MobileLayout.jsx (646 LOC)

**🟡 MEDIUM — `isMobile` computed once at render, never updates**
`const isMobile = window.innerWidth < 1024`. Hard-coded constant for the component lifetime. If user rotates a phone/tablet, opens DevTools, resizes a desktop browser across the 1024 breakpoint, or uses a foldable — the chrome doesn't update. Same issue another batch already fixed in Messages.jsx for the chat composer.
**Fix:** moved to `useState` + resize/orientationchange listener. ✅

**🟡 MEDIUM — Back arrow always navigates to `/`, breaking the back-button mental model**
The mobile header's back arrow rendered a `<Link to="/">` — every back tap from any page jumped to home. User on Home → Search → TripDetails who tapped back went straight to Home, losing their Search context. Standard mobile UX is `navigate(-1)`.
**Fix:** uses `navigate(-1)` when `window.history.length > 1`, falls back to `/` when there's no history (direct URL entry). ✅

**🟡 MEDIUM — Logout was fire-and-forget**
`api.auth.logout()` returns a Promise but the onClick handler didn't await it. If logout failed (network blip, expired refresh token, etc.), the menu closed but the user stayed logged in with no toast — confusing.
**Fix:** awaited inside async handler with explicit error toast. Success path doesn't toast (AuthContext picks up SIGNED_OUT and routes). ✅

### Component 3 — HowItWorks.jsx (598 LOC)

**0 real bugs.** Pure presentational — phone mockup illustrations + a tab toggle + auto-advancing step. No mutations, no API calls, no user input. Skipped.

### Component 4 — DriverSubscriptionSection.jsx (517 LOC)

**🔴 CRITICAL — Subscription payment-proof screenshots uploaded to PUBLIC bucket**
`supabase.storage.from("uploads").upload(...)` then stored the full publicUrl in `driver_subscriptions.proof_url`. Payment proofs are **financial PII** — they commonly include bank / Reflect / Jawwal transaction screenshots showing the driver's bank account number, transaction amount, recipient information, sometimes phone numbers. Anyone with the URL — admins, screenshot leaks, audit log entries — had permanent unauthenticated read access.
Identical defect pattern to the AccountSettings license-docs fix in batch 5 (audit phase 1). Mishwaro's subscription-proof flow regressed back to public storage while the rest of the app converged on private.
**Fix:** route to `uploads-private` bucket; store the path (not URL); display layer already handles both via `licenseUrls.resolveDocumentUrl` pass-through. ✅


## Component Batch 2 — Findings

### Component 5 — MapCityPicker.jsx (472 LOC)

**🟠 HIGH — Race condition in map click → reverse-geocode flow**
`map.on("click", async (e) => { ... await reverseGeocode(...); selectCity(...); })` had two failure modes:
1. **Rapid double-click**: both handlers start, both await Nominatim, results resolve in any order. The second click's loading marker stays orphaned on the map; the FIRST click's later-resolving response can overwrite the SECOND click's selection.
2. **Modal close during await**: cleanup effect (lines 299-306) nulls `leafletMapRef.current` when the modal closes. If the await resolves AFTER cleanup, `selectCity` runs on a disposed map — orphaned imports + potential silent Leaflet errors.
**Fix:** added `clickSeqRef = useRef(0)`. Each click captures `mySeq = ++clickSeqRef.current` then checks `mySeq !== clickSeqRef.current || !leafletMapRef.current` after the await. Stale clicks silently drop their loading marker without selection. ✅

**🟡 LOW — Duplicate `maxZoom` key in tile layer options**
`L.tileLayer(..., { subdomains: "abcd", maxZoom: 20, attribution: "...", maxZoom: 18 })`. JS uses the second value (18), the first is dead. Probably a leftover from when the developer adjusted the cap and didn't remove the old one. Cosmetic but confusing.
**Fix:** removed the dead first key. Kept 18 since that's what was actually being applied. ✅

**False alarm investigated:**
- `nearestCity` uses Euclidean distance in degrees, not great-circle. At Palestine's latitude, 1° longitude ≈ 94km vs 1° latitude ≈ 111km, so there's a small bias. But cities are well-separated (>5km typically) and the 2km cutoff handles edge cases. Not a real bug.

### Component 6 — HeroSection.jsx (362 LOC)

**0 real bugs.** Defensive parsing of admin-edited `hero_city_slides` JSON (try/catch + shape filter + `typeof === "string"` on `s.img`) handles malformed input correctly. The fallback SVG gradient handles the no-slides case. Slide cycling uses `slides.length` (the live array) not the hardcoded fallback length. All edge cases I could think of are already guarded.

### Component 7 — DriverPassengers.jsx (359 LOC)

**🟡 MEDIUM — Optimistic update only touched `["bookings"]` queryKey, not `["driver-bookings"]`**
Same pattern as the DriverTripsList fix in component batch 1. The driver dashboard reads `["driver-bookings", email, tripIds]` (we wired this up in phase 1 batch 8). The optimistic update here only wrote to `["bookings"]` (which the admin dashboard reads). So drivers tapping accept/reject saw no optimistic UI update — ~200ms freeze each tap.
**Fix:** apply optimistic updates to both queryKeys; rollback context stores both previous snapshots. ✅

**🟡 MEDIUM — `markPaid` mutation had no optimistic update at all**
Mark-paid fires once per passenger when the trip ends — typically 2-4 quick taps in a row as the driver confirms cash received. Without optimistic, each tap froze the UI for ~200ms.
**Fix:** added dual-queryKey optimistic update + rollback. Same pattern as updateBooking. ✅

### Component 8 — UserActionsMenu.jsx (357 LOC)

**🔴 CRITICAL — Rules-of-hooks violation, hook count varied between renders**
This component is mounted **pervasively** — TripCard, Messages, profile pages, anywhere a 3-dot user menu appears. Hook order BEFORE the fix:

```js
useAuth          // ← always
useQueryClient   // ← always
useNavigate      // ← always
useState x5      // ← always
if (!user || user.email === targetEmail || isDeletedUserEmail(targetEmail)) return null;
useMutation x2   // ← skipped on render-time guard
```

Hook count: 8 if guards pass, 10 if guards fail. The guards' conditions depend on `user.email` and `targetEmail` — both can change during the component's lifetime. Critical scenarios:
- User logs out → `user` becomes null → next render returns early → hook count drops from 10 to 8 → React crash
- Switch from viewing one user's profile to your own → guard suddenly fires → same drop

The fact that this hasn't been crashing production constantly suggests most usages don't hit the transition. But on every logout, every "view profile" → "back to my profile" navigation, this risks `Rendered fewer hooks than expected`. Audit phase 1 already fixed this pattern in 4 page-level pieces; here it's in a component used everywhere.
**Fix:** moved all early-return guards AFTER both useMutation calls. Render-time guards live immediately before the JSX `return`. Hook count is now invariant — always 10. ✅


## Component Batch 3 — Findings

### Component 9 — RouteMap.jsx (353 LOC)

**🟡 LOW — Duplicate `maxZoom` key in tile-layer options**
Third occurrence of this exact pattern (MapCityPicker had it too). `{ subdomains, maxZoom: 20, attribution, maxZoom: 19 }` — JS uses the second value (19); the first is dead. Cosmetic / source-clarity issue.
**Fix:** removed the dead first key. ✅

**False alarm investigated:**
- The `useEffect` dependency array uses `JSON.stringify(stops)` to detect changes. Since `stops` defaults to `[]` (a fresh array each render), this stringifies every render — but `JSON.stringify([]) === JSON.stringify([])` so the effect doesn't re-fire spuriously. Mild performance overhead, not a bug.
- `onRouteCalculated` is referenced inside the effect but not in the deps array. Standard stale-closure risk if a caller passes a closure capturing fresh state, but most callers pass static handlers. Note, didn't fix.

### Component 10 — DriverReviewWizard.jsx (336 LOC)

**🟠 HIGH — `notifyUser` referenced but never imported — runtime crash on any review with text**
Two call sites:
- Line 77 — notify passenger of new public review
- Line 94 — deliver driver's private message as a notification

Neither was inside the import block. Both bombed with `ReferenceError: notifyUser is not defined` at runtime — but because each was guarded by `if (p.public_review)` / `if (p.private_message)`, **drivers who left both fields empty got success, drivers who wrote anything got a hard crash**.

The whole submit ran inside `Promise.all(data.map(async (p) => { ... }))` — one rejection failed the entire batch. So a driver rating 3 passengers, leaving text for only the first, would see the review for ALL three fail.

Cross-checked: PassengerReviewWizard (the sibling) imports notifyUser correctly. This component was the only one with the missing import. Also ran an audit-wide check (`grep -L "import.*notifyUser" $(grep -l notifyUser src/...)`) — no other components have this defect.
**Fix:** added the missing `import { notifyUser } from "@/lib/notifyUser";` at the top. ✅

### Component 11 — Navbar.jsx (331 LOC)

**🟡 MEDIUM — No click-outside handler on profile dropdown**
`setProfileOpen(true)` opened the dropdown but the only ways to close it were: tap the trigger again, tap a menu item, or navigate away. Tapping anywhere else on the page left it open, blocking other interactive surfaces below (especially on mobile where the dropdown often overlaps page content).
**Fix:** added `profileRef = useRef(null)` on the dropdown wrapper + a useEffect that listens for outside `mousedown` / `touchstart` and closes the dropdown. Same pattern AdminNotificationBell already uses. ✅

**🟡 MEDIUM — Fire-and-forget logout, twice**
Lines 238 (desktop) and 320 (mobile) both did `api.auth.logout(); setX(false)` — promise discarded. If logout failed (network, expired refresh token), the menu closed but the user stayed signed in with no toast. Same defect we fixed in MobileLayout in component batch 1.
**Fix:** extracted a shared `handleLogout` that awaits the promise and toasts on error. Both buttons call it. Success path doesn't toast — AuthContext picks up SIGNED_OUT and routes. ✅

### Component 12 — AdminNotificationBell.jsx (317 LOC)

**🟡 MEDIUM — `markAllRead` had no optimistic update and no `onError`**
The single-notification `markRead` mutation does both (optimistic flip + rollback on error). The bulk `markAllRead` did neither — admin clicked, waited ~200ms for network + invalidate, badge cleared. If the bulk update failed (RLS, network), no toast, no rollback (nothing to roll back), badge silently stayed.
**Fix:** added optimistic flip stamping every visible notification to `is_read: true` immediately; rollback restores the snapshot on error. No toast on error (admin bell is a passive surface; visual rollback is feedback enough). ✅

**False alarm investigated:**
- `getAdminNotifTarget(notif)` routes by emoji prefix in the title, ignoring `notif.link`. Consumer NotificationBell follows `notif.link` when present. Slight inconsistency, but since admin notifications are always generated by `notifyAdmin` (which sets specific titles), this works in practice. Note, didn't fix.


## Component Batch 4 — Findings

### Component 13 — NotificationBell.jsx (310 LOC)

**0 real bugs.** This component has clearly been hardened — the popupRef/btnRef dual-check for outside-click, the dedicated supabase channel `notif-push-${email}`, the seenIdsRef dedup against echo. Everything is well-documented. Note: `seenIdsRef` grows unbounded over very long sessions but the memory profile (≈40 bytes per ID × ~200 notifications per long session ≈ 8KB) makes it not worth fixing.

### Component 14 — UserHistorySection.jsx (297 LOC)

**🟡 MEDIUM — Cancel-rate severity ternary had unreachable danger branch**
`subTone={cancelRate >= 30 ? "warn" : cancelRate >= 50 ? "danger" : "neutral"}`. Left-to-right ternary evaluation means any rate `>= 30` short-circuits into "warn"; the `>= 50` check is never reached. So a user with a **70%** booking cancellation rate showed up as yellow (warn) instead of red (danger). The admin's at-a-glance triage signal for chronic cancellers was effectively broken.
**Fix:** reordered so the higher threshold is checked first — `cancelRate >= 50 ? "danger" : cancelRate >= 30 ? "warn" : "neutral"`. Same pattern as the StrikeAdminPanel just below in the same file (which is already correct: `active >= 3 ? ... : active > 0 ? ...`). ✅

### Component 15 — FeaturedTrips.jsx (280 LOC)

**0 real bugs.** The component over-fetches (20 trips for 4 slots), filters by blocks + expiry, then dedups by `(from_city, to_city, date)` keeping the row with the most available seats — all to prevent a single driver's repeated postings filling the homepage. Well-commented and well-handled. The route-color palette + the gender-aware gradient are presentational, no logic risk.

### Component 16 — PassengerReviewWizard.jsx (277 LOC)

**🟠 HIGH — Best-effort side-effects inside the authoritative try block → duplicate reviews on retry**
`handleSubmit` wrapped the Review.create + 4 awaited side-effects (notifyUser for public, notifyUser for private, notifyAdmin for low-rating, sync logAudit) inside a single try/catch. If ANY side-effect rejected — a flaky network on the notification path, a RLS edge case on the admin notification table — the catch fired `"تعذر إرسال التقييم"` toast. **But the Review row was already saved.** Passenger retried → duplicate review created → driver got two notifications for the same trip → low-rating signals fired twice in admin's queue.

**Fix:** split handleSubmit into two phases:
- Phase 1 (authoritative): `await api.entities.Review.create(...)` in its own try. Failure → toast + return; user can safely retry.
- Phase 2 (best-effort): build a list of notifyUser/notifyAdmin promises, each with `.catch(() => {})`. logAudit wrapped in try/catch defensively. `Promise.allSettled(sideEffects)` is fired-and-forgotten (no await before setStep(5)).

Now the user sees success the moment the review row is saved; side-effects can fail silently without confusing them. ✅

### Retroactive — DriverReviewWizard.jsx (added in batch 3, refixed here)

In batch 3 I fixed the missing `notifyUser` import. Auditing PassengerReviewWizard surfaced **the same best-effort-inside-authoritative defect** in DriverReviewWizard — even worse there because it runs inside `Promise.all(data.map(async (p) => { ... }))` per passenger. If passenger 3's notifyUser failed, the whole Promise.all rejected → driver saw "تعذر إرسال التقييم" → retried → reviews for passengers 1 and 2 (already saved) **got duplicates**.

**Fix:** same restructure as PassengerReviewWizard, adapted for the per-passenger batch:
- Phase 1: `Promise.allSettled` over per-passenger booking-update + review-create. Each per-passenger result is tracked; failure of one passenger does not block the others.
- Phase 2: for each successfully-saved passenger, fire notifyUser + logAudit, each with its own .catch.
- Toast accuracy: if some passengers failed but others succeeded, the driver sees `"تم حفظ X من Y تقييمات. حاول مجدداً لاحقاً للباقي."` rather than a misleading all-or-nothing failure. ✅

## Component Batch 5 — Findings

### 🔴🔴🔴 The big one — apiClient.js `entities.X.subscribe()` shared-channel teardown race

Auditing TripCard's realtime subscription led me back to `api.entities.Trip.subscribe()`, which I assumed was a thin wrapper. It wasn't — it had a critical bug:

```js
subscribe: (callback) => {
  const channelName = `${tableName}-realtime`;
  // Remove any existing channel with same name (cleanup from previous mount)
  try { supabase.removeChannel(supabase.channel(channelName)); } catch {}
  // ... create new channel, register callback ...
}
```

The channel name is `${tableName}-realtime` — **shared across every caller**, not user-scoped, not component-scoped. The comment "cleanup from previous mount" reflects an incorrect mental model: there is no "previous mount" when multiple components mount concurrently. Every new `subscribe()` call **tore down the channel that all existing subscribers depended on** and replaced it with a fresh one registering only the new caller's callback. So:

- 20 TripCards mounting in a search results page → only the **last one** received realtime updates. Other 19 silently dead.
- When any of those cards unmounted → its cleanup removed the channel, killing realtime for everyone.
- DriverTripsList's realtime + DriverPassengers' realtime + NotificationBell's entity fallback + Notifications page's preferences subscription + Messages page + 7 dashboard pages → all racing for the same channel slot.

This was the underlying defect that AdminNotificationBell had already worked around with its own dedicated channel name (see the workaround comment we cleaned up in this batch).

**Impact on real users:**
- Cards on a search results page never updating their seat counts in real time as bookings come in
- Drivers using DriverTripsList not seeing status updates from other devices
- Admins viewing /dashboard/notifications with the consumer bell mounted in chrome → only one of them updating
- Multiple-tab inconsistencies where one tab gets updates and another doesn't

**Fix:** rewrote the subscribe implementation to use a per-channel-name registry. First subscriber creates the Supabase channel; subsequent subscribers add their callback to a shared Set. The channel only gets torn down when the LAST subscriber unsubscribes. Each inbound row fans out to every registered callback. Per-callback try/catch so one bad handler doesn't break delivery to others.

Affects every caller of `api.entities.X.subscribe()` automatically, no per-call changes needed:
- TripCard, FeaturedTrips, SearchTrips, DriverTripsList, DriverDashboard
- BookingRequestPopup, DriverPassengers, DashboardBookings, DashboardTrips
- NotificationBell (consumer), Notifications page
- Messages page
- DashboardLicenses, DashboardUsers, StatsBar

### Component 17 — TripCard.jsx (275 LOC)

No standalone bugs — but TripCard's `useEffect` (line 259) at scale exposed the apiClient defect above. With the apiClient fix, the per-card subscribe call is now efficient (one shared channel, fan-out to all cards). The per-card filtering `if (payload?.new?.id === trip.id) setLiveTrip(payload.new)` already does the right thing for receiving only the relevant updates.

### Component 18 — BookingRequestPopup.jsx (251 LOC)

No new bugs beyond the apiClient defect. The popup polls every 15s as backup AND subscribes to Booking realtime — with the apiClient fix the realtime now works alongside DriverPassengers' subscription instead of fighting it. The `onSuccess` notifyUser is awaited but is wrapped in the mutation's own error handling, so a notification failure shows a soft fail (no success toast) but doesn't trigger a misleading "failed" state. Worth noting but not a duplicate-on-retry risk like the review wizards.

### Component 19 — CityAutocomplete.jsx (245 LOC)

**🟡 LOW — Outside-click handler missing `touchstart`**
Listened only to `mousedown`. On mobile, tap-outside doesn't always synthesise a mousedown (especially across scrollable regions). Other dropdowns in this codebase (NotificationBell, AdminNotificationBell, the Navbar profile menu we fixed in batch 3) listen to both `mousedown` and `touchstart`.
**Fix:** added the touchstart listener. ✅

**False alarm investigated:**
- The filter at line 53 has an unusual second clause: `normQuery.includes(<city first word>)`. Looked like a bug because a 1-2 char query can never contain a 3+ char city's first word. But the second clause's intent is the inverse case — matching multi-word USER input against single-word city names ("السفر إلى رام الله" should match "رام الله"). The asymmetry is by design.

### Component 20 — PullToRefresh.jsx (221 LOC)

**0 real bugs.** This component is unusually well-implemented. Ref-based gesture state (avoiding React batching races on touchend), stable listener attachment (no re-mount churn during a pull), explicit walk-up-the-DOM to find the actual scroll container, `passive: false` only on touchmove so preventDefault works, fallback to documentElement for desktop, refresh-in-progress lockout. All design choices are documented inline.


## Component Batch 6 — Findings

### Component 21 — DriverPaymentSetup.jsx (217 LOC)

**🟠 HIGH — Data loss: previously-saved bank/Reflect/Jawwal/card fields wiped when user loads async**
The state initializers `useState({ bank_iban: user?.bank_iban || "" })` only run on the FIRST render. If the parent passes `user=undefined` on first mount (auth still loading) and `user` resolves later with real data, the local state stays empty. Driver sees blank form, fills in some fields, clicks save → mutation PATCHes profile with `{bank_iban: "", ...}` → **wipes the previously-saved IBAN with an empty string**.

`api.auth.updateMe` is a direct PATCH (verified — no merge logic on the server), so an empty value overwrites whatever was there.

The driver couldn't be expected to know the field was already populated — they saw blank, so they re-typed what they remembered (which usually means: filled in the things visible on screen, left "optional" fields blank).
**Fix:** added `useEffect` that re-hydrates ALL four state objects from `user` when `user.email` first becomes available. Tracked with `hydratedRef` to avoid clobbering in-progress edits when `me` is re-fetched later by another action. ✅

**🟡 MEDIUM — Tab IDs didn't match canonical payment-method schema**
The deferred follow-up from phase 1 batch 3 explicitly noted: "DriverPaymentSetup still uses 'bank' (setup-time UI only)". Updated to `bank_transfer` / `credit_card` to match CreateTrip's emit values and DriverDashboard.methodLabel's decode keys. Setup-time UI only (these IDs never reach booking/trip data shape), but resolves the inconsistency. ✅

### Component 22 — AccountHub.jsx (211 LOC)

**🟡 MEDIUM — Section state didn't clear when URL param was removed**
```js
React.useEffect(() => {
  const fromUrl = searchParams.get("section");
  if (fromUrl) setSection(fromUrl);   // ← only sets when truthy
}, [searchParams]);
```
User on `/account?section=vehicle` had section state `"vehicle"`. If they then navigated (via Link, browser back, etc.) to `/account` with no params, `searchParams.get("section")` returned null, the `if (fromUrl)` guard was false, and section state stayed `"vehicle"` — the URL said "show the master list" but the UI kept showing the vehicle section.
**Fix:** removed the truthiness guard. `setSection(searchParams.get("section") || null)` always tracks the URL. ✅

### Component 23 — SuggestCityModal.jsx (208 LOC)

**🟠 HIGH — Best-effort `notifyAdmin` + `logAudit` inside the authoritative submit try-catch**
Same pattern as PassengerReviewWizard / DriverReviewWizard / Feedback. The `suggest_city` RPC creates the row; then notifyAdmin is awaited; then logAudit is called. All inside a single try-catch. If notifyAdmin failed (RLS edge case for the user's role, network blip), the catch fired with a "failed" toast — but the suggestion was already saved.

Mitigation: the `suggest_city` RPC has built-in idempotency (dedupes by name, bumps duplicate_count). So even if the user retries on the misleading failure toast, no duplicate row is created. But the UX is still wrong — user thinks they failed and might give up.
**Fix:** split into Phase 1 (RPC, authoritative) and Phase 2 (notifyAdmin + logAudit, fire-and-forget with their own .catch). Stage transition happens after Phase 1; Phase 2 runs in the background. ✅

### Component 24 — DriverRatingsDashboard.jsx (185 LOC)

**🟠 HIGH — Review filter missed `review_type` — driver saw their own OUTGOING reviews mixed with incoming**
`Review.filter({ driver_email: user.email })` pulled BOTH directions of reviews:
- Passenger-rates-driver (`review_type='passenger_rates_driver'`) — what the driver SHOULD see here ("how am I doing")
- Driver-rates-passenger (`review_type='driver_rates_passenger'`) — the driver's OWN ratings of passengers (which ALSO carry `driver_email=me` because the driver IS the driver in both directions)

Impact on the "تقييماتي" (My Ratings) tab:
- **Inflated count.** Total review count was inflated by the driver's own outgoing reviews.
- **Skewed average.** A driver rated 4.5 by passengers who gave passengers 3.0 ratings would see ~3.75. Completely misleading reputation signal.
- **Histogram corrupted.** Star distribution included both directions.
- **Confusing display.** `ReviewRow` shows `reviewer_name` — for the driver's own outgoing reviews, that's the driver's own name. So the driver saw their own name appear as a reviewer of themselves.

**Fix:** added `review_type: "passenger_rates_driver"` to the filter. Incoming feedback only. ✅

### Retroactive — UserHistorySection.jsx (same defect, same batch)

Found the same defect by grep — UserHistorySection's admin "متوسط التقييم" card had the same unfiltered Review.filter. Admin investigating a user saw their reputation score corrupted by the user's own outgoing ratings. Same one-line fix (add `review_type: "passenger_rates_driver"`).

**Audit-wide cross-check:** I greped for all `Review.filter` and `Review.list` calls. Other call sites already filter by review_type correctly (UserProfile.jsx, RatingSummary.jsx, ReviewsList.jsx, StatsBar.jsx, MyTrips.jsx, DriverRatePassengers.jsx). Only DriverRatingsDashboard + UserHistorySection were missing the filter.


## Component Batch 7 — Findings

### Component 25 — DriverRatePassengers.jsx (171 LOC)

**🟠 HIGH — Review.create missing critical fields → admin queries broke**

DriverRatePassengers is the "cleanup" surface for drivers who finished a trip without going through DriverReviewWizard (e.g. dismissed the prompt, or rated late). But the Review row it created was missing fields that DriverReviewWizard sets:
- `driver_email` (not just `reviewer_email`) — queries like UserHistorySection's `Review.filter({driver_email: ...})` admin view DEPEND on this column being populated for both directions. Rows from this surface were INVISIBLE to those queries.
- `reviewer_role: "driver"` — used by downstream filters
- `public_review` (mirror of `comment`) — read by RatingSummary

Net effect: a driver who used the wizard had ratings showing up in admin reports; a driver who used this tab created "ghost" ratings invisible to the same reports. Two paths, two data shapes.

**🟡 MEDIUM — No `onError` + missing notifyUser/audit**

The mutation had `onSuccess` (cache invalidate + success toast) but **no `onError`**. RLS denials, network failures → silent. Driver clicked submit, button re-enabled, no feedback. Plus no notifyUser to the passenger (passenger never learns the driver rated them — DriverReviewWizard does this), no logAudit (admin trail incomplete for "driver rates passenger" events that came from this surface vs the wizard).

**Fix:** rewrote the mutation to:
- Write the full Review.create shape matching DriverReviewWizard's exactly.
- Add `onError` with `friendlyError` toast.
- Fire-and-forget notifyUser + logAudit in `onSuccess` (each with `.catch`, matching the defect-resistant pattern from batch 4 — these are best-effort and must not cause "failed" toast if the review succeeded).
- Tagged `source: "rate_passengers_tab"` in the audit metadata so admins can distinguish reviews from this tab vs the wizard if they ever need to. ✅

### Component 26 — DriverVehicleEditor.jsx (170 LOC)

**🟠 HIGH — Same async-user data-loss pattern as DriverPaymentSetup**

The form-init was:
```js
const [form, setForm] = useState(null);
const currentForm = form || { car_model: user?.car_model || "", ... };
const set = (key, val) => setForm((prev) => ({ ...(prev || currentForm), [key]: val }));
```

If the driver types BEFORE `user` resolves from the network (rare but possible with cached pages), `form` becomes a fresh object derived from an EMPTY `currentForm`. From that point, every render reads `form` (not user). User resolves later — irrelevant, form is now locked away. Driver clicks save → wipes saved car_model, car_year, car_plate with empty strings.

Less likely to trigger than DriverPaymentSetup because there are no auto-tabs to click while loading, but the data-loss potential is the same.

**🟡 MEDIUM — `handleSave` try/finally with no catch**

```js
const handleSave = async () => {
  setSaving(true);
  try {
    await api.auth.updateMe(currentForm);
    qc.invalidateQueries({ queryKey: ["me"] });
    toast.success("...");
  } finally {
    setSaving(false);
  }
};
```

Missing `catch` block — errors uncaught, no toast, no feedback. Driver sees the saving spinner clear and assumes success; nothing actually saved. They'd discover the issue later by re-opening the page.

**Fix:** added the `useEffect` + `hydratedRef` rehydration pattern from DriverPaymentSetup (initialise form from `EMPTY_FORM`, then re-hydrate when `user.email` becomes available, gated by hydratedRef to not clobber in-progress edits). Plus explicit `catch` block with `friendlyError` toast. Replaced all `currentForm.X` references with `form.X` since the fallback computation is no longer needed. ✅

### Component 27 — StrikeStatusSection.jsx (170 LOC)

**0 real bugs.** Component is read-only display, clear data flow, well-commented. The 30-day rolling window logic is applied client-side as a fast-path for an accurate live view (mirroring the DB's behaviour). The educational panel at the bottom is a nice touch — surfacing the rules proactively instead of after a user is blocked.

Minor: `Profile.filter({email}, "-created_at", 1)` could be simplified to a `.eq("email", email).maybeSingle()` but it's not a bug, just suboptimal — and `Profile.filter` is the established api surface in this codebase.

### Component 28 — PassengerPaymentsSection.jsx (169 LOC)

**🟢 LOW — Payment method shown raw instead of Arabic label**

`b.payment_method === "cash" ? "نقداً" : b.payment_method` — only cash got Arabic. Non-cash methods (bank_transfer, credit_card, jawwal_pay, reflect) appeared as their raw English IDs in the passenger's payment history rows.

**Fix:** added a `methodLabel` map mirroring DriverDashboard.methodLabel and DriverSubscriptionSection.methodLabels. (Deferred follow-up: extract to a shared `@/lib/paymentMethods` util — currently duplicated across 3 surfaces, but extracting is a refactor that touches more files than this audit scope.) ✅

**Otherwise: 0 real bugs.** This component is exemplary — it's already been hardened with explicit migration comments showing the developer worked through:
- The platform-newest-N anti-pattern (migrated to `.in('id', tripIds)` per-user lookup)
- The cancelled-vs-pending payment_status confusion (explicit `badgeFor` hierarchy where status='cancelled' wins over payment_status='pending', precisely because `cancel_booking` RPC doesn't touch payment_status)
- A `tripById` lookup that gracefully degrades to "رحلة" with date fallback


## Component Batch 8 — Findings

This batch ran unusually clean — **0 real bugs across 574 LOC**. All four components are well-implemented. Notes below for completeness.

### Component 29 — RequestCard.jsx (143 LOC)

Purely presentational. Receives `request` + `mode` + `onClick` + `action` as props; renders a card. No state, no effects, no mutations. The `fmtDate` and `fmtTime` helpers handle edge cases (null, NaN, past dates) gracefully. Minor polish: "بعد 2 أيام" is grammatically incorrect Arabic (should be "بعد يومين" — dual form), but this is a localisation polish item, not a bug.

### Component 30 — StatsBar.jsx (149 LOC)

The data-correctness defenses are good: `validRatings.filter(r => typeof r.rating === "number" && !isNaN(r.rating))` prevents a single bad row producing "NaN/5" on the public homepage. The `public_stats_enabled` + `min_users` gates prevent inflated launch-day stats.

**Deferred follow-ups (NOT fixed — beyond batch scope):**
- `api.entities.User.list()` (line 61) fetches all profile rows just to compute `users.length`. At scale this becomes wasteful (5MB+ for 10k users). Should be a server-side COUNT.
- `Trip.list("-created_date", 1000)` (line 56) fetches up to 1000 trips for `completedTrips` count and `cities` Set derivation. Beyond row 1000, both counts are inaccurate — older completed trips drop off, older route pairs disappear from the unique-city Set. The platform isn't there yet, but this is a marketing surface where inflated/deflated numbers risk app-store scrutiny.

Both are "count-via-list" anti-patterns. The proper fix is a server-side aggregate RPC. Not in this batch; flag for the deferred follow-up list.

### Component 31 — DashboardFilterBar.jsx (149 LOC)

Reusable. Documents its no-debounce contract explicitly ("Page should debounce or use staleTime if needed."). All callers verified to use `setSearchAndReset` style handlers that update react-query keys — react-query handles request cancellation correctly, so no broken behaviour, just inefficiency.

The `resolveDateRange` helper at the bottom correctly interprets local-time dates and converts to UTC ISO bounds — which is the right behaviour for admin filters (admin thinks in local time, data stored in UTC).

### Component 32 — LegalSheet.jsx (133 LOC)

Exemplary. Comments explain every design choice: why a modal not a route navigation (preserves form state), why ModalPortal (escapes parent transform stacking context), why dvh on parent + overflow-y-auto on content (scrollable text while close button stays visible), why both Esc-to-close and backdrop tap (desktop + mobile parity).

Body-scroll-lock cleanup correctly captures `prev = body.style.overflow` and restores it on unmount AND when `kind` changes to null.


## Component Batch 9 — Findings

### Component 33 — DashboardSidebar.jsx (148 LOC)

**🟠 HIGH — The "تسجيل الخروج" (Logout) button had NO onClick handler.**

```jsx
<button className="...">
  <LogOut className="w-4 h-4" />
  تسجيل الخروج
</button>
```

Admin clicks logout → nothing happens. Forces them to navigate to the consumer-side `/account` or `/` to find a working logout. For admin users this is more than a polish issue: dashboard sessions stay open longer than the admin intends, increasing the risk window for shoulder-surfing, shared-device usage, etc.

**Fix:** added a module-level `async function handleLogout()` mirroring the Navbar pattern from batch 3 (proper try/catch with `friendlyError` toast on failure — not a fire-and-forget). Wired it to the button's onClick. ✅

**🟡 LOW — `DashboardMobileTabSelector` outside-click handler missing touchstart**

Same pattern as CityAutocomplete (batch 5), NotificationBell, Navbar profile menu — mousedown alone doesn't reliably fire on mobile tap-outside. Added the symmetric `touchstart` listener + cleanup. ✅

### Component 34 — GPSTripTracker.jsx (132 LOC)

**🟠 HIGH — Best-effort passenger notifications inside the authoritative Trip.update try block**

```js
try {
  await api.entities.Trip.update(trip.id, { status: "completed" });
  await Promise.all(passengers.map(b => notifyUser({ ... })));  // ← awaited best-effort
  qc.invalidateQueries(...);
  toast.success("✅ اكتملت الرحلة!");
  setShowReviewWizard(true);
} catch (err) {
  toast.error(friendlyError(err, "تعذر إنهاء الرحلة"));
}
```

If ANY passenger's notifyUser failed, `Promise.all` rejected, catch fired with "تعذر إنهاء الرحلة" (Failed to complete trip). But the trip WAS already completed. This pattern is worse here than in the review wizards because:

1. **Trip status change is irreversible in practice** — no driver-side "uncomplete" button.
2. **Driver saw "failed"**, tapped the manual completion button again. `Trip.update({status: "completed"})` is a no-op (already completed) but `Promise.all` runs again → **passengers got DUPLICATE "trip completed, rate the driver" notifications**.
3. **The review wizard never opened.** `setShowReviewWizard(true)` is AFTER the awaited notifyUser. So the driver who was supposed to immediately rate passengers ended up at a "failed" toast with no wizard, then had to navigate to the dashboard's rate-passengers tab — the inferior surface we fixed in batch 7.

**Fix:** split into two phases.
- Phase 1 (authoritative): `Trip.update` alone. Failure → toast + return. Driver can safely retry.
- Phase 2 (best-effort): `passengers.map(b => notifyUser({...}).catch(() => {}))`. Each call has its own .catch. The array is `Promise.allSettled`-fired-and-forgotten so the review wizard opens IMMEDIATELY after the trip flip — no waiting for slow notification round-trips. ✅

This is the **fourth** instance of this defect pattern across the audit (Feedback, PassengerReviewWizard, DriverReviewWizard, SuggestCityModal, DriverRatePassengers, now GPSTripTracker). Worth a codebase-wide grep for `Promise.all(... notify` in the future — likely a few more lurking.

### Component 35 — MyReportsSection.jsx (104 LOC)

**0 real bugs.** Read-only display of reports the user filed. CATEGORY_BY_ID lookup, STATUS_DISPLAY mapping, graceful "no reports" empty state, clear admin_note display when present. Comment at line 12-14 explains why reports filed AGAINST the user are intentionally hidden — sound product reasoning.

### Component 36 — PreferencesSection.jsx (101 LOC)

**0 real bugs.** The `useEffect`-from-props pattern at lines 20-24 is correct — syncs local state from user props on dep change, doesn't fire on local-state-only changes, doesn't clobber in-progress edits since the deps are specific user.pref_X fields not the user object itself. Save flow has proper try/catch with friendlyError. Role-aware subtitle text. Tile component is presentational.

Minor edge case (not a bug): if another device updates `pref_smoking` while user is mid-toggle on this device, the effect would fire and overwrite the in-progress edit. Realistic only with two devices logged in simultaneously editing the same field at the same moment — not worth fixing.


## Component Batch 10 — Findings

### Component 37 — RequestsTeaser.jsx (100 LOC)

**0 real bugs.** Role-aware CTA computation, well-commented visibility rules (the comment at lines 38-49 explicitly explains a previous mis-rule that hid the teaser for drivers when openCount was 0 — they fixed it to always show with role-specific empty-state copy so the discovery surface to /passenger-requests is preserved). Uses the SECURITY DEFINER `public_open_requests_count` RPC for the badge so the count works for everyone without needing the subscription gate.

### Component 38 — VehicleDetailsSection.jsx (100 LOC)

**🟢 LOW — Fake "50% increase in bookings" marketing claim**
Line 76 had `💡 وضع راكبين فقط في الخلف يزيد الحجوزات بـ 50%` — a quantitative claim that a pre-launch app cannot prove. Same pattern as the fake-marketing-numbers cleanup from phase 1 (TripDetails, UserProfile, StatsBar). Apps with unprovable stats get scrutinized in app-store review.

**Fix:** replaced with qualitative copy: "💡 وضع راكبين فقط في الخلف يجعل الرحلة أكثر راحة للجميع" (Setting back-row to 2 makes the ride more comfortable for everyone). Same nudge intent (drives drivers toward backRow=2 for comfort), no fabricated stat. ✅

### Component 39 — BlockedUsersSection.jsx (100 LOC)

**0 real bugs.** Unblock flow is clean: mutation with proper onSuccess invalidating ALL caches that filter on blocks (search, trip lists, conversations, the blockUtils cache, the local list). Empty-state copy. The `disabled={isPending}` on every button is suboptimal for bulk-unblock UX (one in-flight disables all), but not wrong.

Code comment at lines 9-11 explicitly documents the intentional product decision to NOT surface blocks AGAINST the user — "would just enable harassment retries" — sound reasoning.

### Component 40 — DashboardCharts.jsx (94 LOC)

**0 real bugs.** Presentational — receives `pieData`, `chartData`, `revenueData`, `totalRevenue` props and renders three recharts surfaces. The recharts import deliberately lives here (lazy-loaded with the dashboard route) instead of in Dashboard.jsx so the ~113KB gzipped chart vendor doesn't enter the main admin bundle.

Minor: line 78 has `<span>— مقارنة بالشهر الماضي</span>` — the em-dash is a placeholder for an unwired month-over-month delta. Same placeholder appears in Dashboard.jsx's stat cards (line 130: `change: "—"`). Not a bug, just a half-finished feature; data hasn't been wired. Worth flagging as a TODO but not in audit scope to wire.


## Component Batch 11 — Findings

### Component 41 — ExpiredTripNotifier.jsx (90 LOC)

**🟡 MEDIUM — markNotified ran AFTER the async insert → duplicate notifications on slow inserts**

```js
(async () => {
  try {
    await supabase.from("notifications").insert({...});
    markNotified(trip.id);  // ← AFTER insert resolves
  } catch (e) { ... }
})();
```

The component refetches every 60s (`refetchInterval: 60_000`). If the Supabase insert takes more than 60s (rare but possible on a slow connection or during a temporary backend hiccup), the next refetch's effect runs while the first insert is still in-flight. `notified.has(trip.id)` is still false → second insert fires → driver gets duplicate "trip expired" notification. Could happen 2-3 times for the same trip if the round-trip is consistently slow.

**Fix:** mark optimistically BEFORE the async insert, and unmark on failure so transient errors still result in a retry on the next refetch instead of being permanently silent. ✅

### Component 42 — NotificationPrefsSection.jsx (90 LOC)

**0 real bugs.** Save flow proper, useEffect-from-props correct, SMS + Email channels intentionally marked `comingSoon` with explicit comment explaining why (no gateways wired into backend yet — surfacing them as actionable would let users disable channels that don't deliver anything, then wonder why they aren't getting messages they never could have received).

### Component 43 — PassengerPaymentSetup.jsx (81 LOC)

**🟡 MEDIUM — Payment method ID inconsistency (`"card"` instead of `"credit_card"`)**
Same canonical-ID alignment as DriverPaymentSetup (batch 6). PassengerPaymentSetup used `"card"` while CreateTrip + DriverDashboard + DriverPaymentSetup use `"credit_card"`. Currently `preferred_payment` isn't cross-referenced with trip-accepted methods so the divergence didn't cause functional bugs, but it locks in the wrong shape for future "driver accepts passenger's preferred method" matcher logic.

**Fix:** changed the METHODS array id to `"credit_card"`. Added `normalizeLegacy(id)` helper that maps existing-passenger `"card"` values to `"credit_card"` at read time, so passengers who already saved the legacy value still see their preferred tile highlighted correctly. New saves write canonical IDs. ✅

**🟡 MEDIUM — Same async-user data-loss pattern as DriverPaymentSetup / DriverVehicleEditor**
`useState(user?.preferred_payment || "cash")` — if user resolved late, state stayed at "cash" default. Click save → PATCH with "cash" → overwrites the user's actual saved preference. Less severe than DriverPaymentSetup (single tile, user would notice the wrong selection), but still data loss potential.

**Fix:** added `useEffect` + `hydratedRef` pattern (same shape as DriverPaymentSetup batch 6). Sync from user once when `user.email` arrives; gated by hydratedRef so background me re-fetches don't clobber in-progress tile selections. ✅

### Component 44 — CTASection.jsx (66 LOC)

**🟢 LOW — Fake "آلاف الفلسطينيين" (thousands of Palestinians) marketing claim**

Pre-launch app does not have "thousands" of users. This is on the HOMEPAGE — one of the most visible marketing surfaces, the exact kind of unprovable quantitative claim app-store reviewers flag for "misleading marketing." Same pattern as the fake-stat cleanup in phase 1 (TripDetails, UserProfile, StatsBar) and batch 10 (VehicleDetailsSection).

**Fix:** replaced with non-quantitative copy: "شارك الطريق مع جيرانك — وفّر المال، وفّر البيئة، وصِل بأمان" (Share the road with your neighbors — save money, save the environment, arrive safely). Conveys the same community + savings + safety messaging without claiming a user count. ✅


## Component Batch 12 — Findings

### Component 45 — ErrorBoundary.jsx (62 LOC)
**0 real bugs.** Standard React class-based error boundary. Sentry capture with componentStack metadata, optional inline `fallback` prop for non-critical subtrees, default recovery UI with reload + home buttons.

### Component 46 — AppLayout.jsx (61 LOC)

**🟡 MEDIUM — NetworkStatus only rendered on desktop branch**
The offline banner + auto-refetch-on-reconnect was inside the `<>...</>` return for desktop layout (line 46) but NOT inside the MobileLayout branch return (line 30-42). Mobile users — who experience network issues FAR more often (cellular signal drops, elevators, switching wifi/cellular, going through tunnels) — got no offline indicator and no auto-refetch when they came back online. Strictly worse coverage for the users who needed it most.

**Fix:** rendered `<NetworkStatus />` in both branches (hoisted into the JSX fragment wrapping MobileLayout too). ✅

**🟢 LOW — Missing `orientationchange` listener**
The breakpoint check `setIsMobile(window.innerWidth < 1024)` ran on `resize` only. Some mobile browsers (Safari iOS in particular) do not fire `resize` on device rotation — they fire `orientationchange`. So a user rotating phone landscape ↔ portrait could end up on the wrong branch's layout until the next true resize.

**Fix:** added the symmetric `orientationchange` listener + cleanup. ✅

### Component 47 — Pagination.jsx (61 LOC)
**0 real bugs.** RTL-aware navigation (ChevronRight for "previous" in RTL, ChevronLeft for "next"), proper disabled states on first/last page, correct ellipsis insertion between non-consecutive page numbers, locale-aware page numbers (`p.toLocaleString("ar")`).

### Component 48 — ReviewsList.jsx (56 LOC)
**0 real bugs.** Already filters by `review_type: "passenger_rates_driver"` (this was the right behaviour the whole time — what DriverRatingsDashboard / UserHistorySection were missing in batch 6). Loading skeleton, empty state, graceful date fallback ("—" for old base44 rows missing `created_at`).

### Component 49 — RatingSummary.jsx (52 LOC)

**🟡 MEDIUM — No NaN defense on rating average**
`avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length` — if any review row had `rating === null`, the reduce produces NaN, the `.toFixed(1)` displays "NaN" on the driver's public profile rating card. Same defensive-filter pattern StatsBar already had (added in phase 1), missing here.

Less likely to trigger than the corresponding admin surface (the filter `review_type='passenger_rates_driver'` already excludes most odd rows), but null `rating` is possible for soft-deleted reviews, partial inserts, or schema drift.

**Fix:** added `validReviews = reviews.filter(r => typeof r.rating === 'number' && !isNaN(r.rating))` and use it for both the average AND the histogram counts AND the denominator in the bar widths. Driver's profile rating now never displays "NaN/5" even if one bad row sneaks in. ✅

