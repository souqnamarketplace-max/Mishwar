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
| 13 | NotificationBell.jsx | 310 | pending | |
| 14 | UserHistorySection.jsx | 297 | pending | |
| 15 | FeaturedTrips.jsx | 280 | pending | |
| 16 | PassengerReviewWizard.jsx | 277 | pending | |
| 17 | TripCard.jsx | 275 | pending | |
| 18 | BookingRequestPopup.jsx | 251 | pending | |
| 19 | CityAutocomplete.jsx | 245 | pending | |
| 20 | PullToRefresh.jsx | 221 | pending | |
| 21 | DriverPaymentSetup.jsx | 217 | pending | |
| 22 | AccountHub.jsx | 211 | pending | |
| 23 | SuggestCityModal.jsx | 208 | pending | |
| 24 | DriverRatingsDashboard.jsx | 185 | pending | |
| 25 | DriverRatePassengers.jsx | 171 | pending | |
| 26 | DriverVehicleEditor.jsx | 170 | pending | |
| 27 | StrikeStatusSection.jsx | 170 | pending | |
| 28 | PassengerPaymentsSection.jsx | 169 | pending | |
| 29 | RequestCard.jsx | 143 | pending | |
| 30 | StatsBar.jsx | 149 | pending | |
| 31 | DashboardFilterBar.jsx | 149 | pending | |
| 32 | LegalSheet.jsx | 133 | pending | |
| 33 | GPSTripTracker.jsx | 132 | pending | |
| 34 | MyReportsSection.jsx | 104 | pending | |
| 35 | PreferencesSection.jsx | 101 | pending | |

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

