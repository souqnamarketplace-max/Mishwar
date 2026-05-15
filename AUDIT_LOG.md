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
| 3 | TripDetails.jsx | 1126 | pending | |
| 4 | MyTrips.jsx | 643 | pending | |
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



