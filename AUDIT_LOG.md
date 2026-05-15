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
| 5 | Messages.jsx | 1126 | pending | |
| 6 | CreateTrip.jsx | 1188 | pending | |
| 7 | Onboarding.jsx | 712 | pending | |
| 8 | Login.jsx | 859 | pending | |
| 9 | AccountSettings.jsx | 1340 | pending | |
| 10 | BecomeDriver.jsx | 717 | pending | |
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





