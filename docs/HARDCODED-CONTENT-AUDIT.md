# Hardcoded content audit — مِشوار

A sweep of every place in the app where hardcoded content stands in for
what should be either real data, configurable settings, or honestly absent.

Generated 2026-05-06. HEAD: `0b3bdba`.

---

## 🔴 MUST FIX before launch (ethical / legal / App Store rejection risk)

These are **false claims about your business** that ship in the bundle.
App Store and Play Store reviewers reject for misleading marketing, and
publishing fake testimonials in the EU/UK violates consumer protection
law. These need to either be removed or replaced with real data.

### 1. Fake user-count stats — `src/components/home/StatsBar.jsx`

**What's wrong:** lines 71, 80 show "10,000+ travelers" and "5,000+
completed trips" until real database counts pass arbitrary thresholds
(>100). The comment in the code literally calls it
`"aspirational fallback"`. On a launch-day app with 5 real users, every
visitor sees these inflated numbers as fact.

**Fix options:**

A. **Honest mode (recommended for launch):** show real numbers without
   fallback inflation. New app + small numbers is fine — say "نمنح
   التنقل العادل لمجتمع مِشوار" without specific counts.

B. **Hide stats until a real threshold:** if `users.length < 100`, don't
   render the StatsBar at all. The home page works without it.

C. **Pull thresholds from `app_settings` table** so admin can flip on
   public stats display when ready. New columns: `public_stats_enabled`,
   `public_stats_min_users`.

### 2. Fake testimonials — `src/components/home/TrustBadges.jsx`

**What's wrong:** lines 12-49 hardcode 4 fake testimonials with
specific quoted figures ("I saved more than ₪200 last month", "I have
regular passengers and earnings cover the car payment"). These look
real to users and reviewers — they're not.

**Fix options:**

A. **Remove the testimonial carousel entirely.** Trust badges (sections
   above) keep the section meaningful without fabricated quotes.

B. **New `testimonials` table** + admin UI. Wire the carousel to
   `Testimonial.filter({ is_published: true })`. Empty array = section
   hidden. Earn real testimonials post-launch from real users with
   their consent and real names.

### 3. Fake team — `src/pages/AboutUs.jsx`

**What's wrong:** lines 13-18 list 4 fake team members ("أحمد سالم
المؤسس والرئيس التنفيذي", etc.). None of these people exist.

**Fix options:**

A. **List real founders/team only.** If you're solo, say "تم تطوير
   مِشوار من قبل [your name]" and skip the fake team grid.

B. **Remove the team section.** AboutUs reads fine with just values +
   mission paragraphs.

C. **Move to `app_settings.team_members` JSON column** — admin-editable
   list. Empty = section hidden.

### 4. Fake blog posts — `src/pages/Blog.jsx`

**What's wrong:** lines 7-44 hardcode 4 fake blog posts dated 2024,
including "مِشوار launches in Nablus — 50+ verified drivers" — a
specific factual claim that's almost certainly untrue today.

**Fix options:**

A. **Remove the Blog page from the route table** until you have real
   posts. Removes the link from Footer too.

B. **New `blog_posts` table** (already exists in schema based on
   `BlogPost` entity references in `dashboardEntities`). Wire to live
   data. Empty array → "قريباً سننشر مقالاتنا" empty state.

### 5. Fake support contact info — `src/components/layout/Footer.jsx`

**What's wrong:**
- line 116-118: `support@mishwaro.com` (wrong domain — brand is
  `mishwar.ps` everywhere else, including the privacy policy)
- line 126-128: `+970599000000` / `0599-000-000` — placeholder phone
  number with all zeros

**Fix:** Footer should pull from `app_settings.support_email` and
`app_settings.support_phone` like Help.jsx already does
(`src/pages/Help.jsx:29-30` is the correct pattern). Then admin sets
real values once in `/dashboard/settings`.

### 6. Hardcoded fallback driver name — `src/pages/TripDetails.jsx:388`

**What's wrong:** if `trip.driver_name` is null/undefined, the trip
page shows the made-up name "محمد درويش" with a "verified" badge.

**Fix:** change `{trip.driver_name || "محمد درويش"}` to
`{trip.driver_name || "السائق"}` (generic word "the driver"). One-line
change.

### 7. Fake hero claim — `src/components/home/HeroSection.jsx:174,258`

**What's wrong:** "+10,000 مستخدم يثقون بنا 🇵🇸" displayed prominently
on the hero. Same false-claim problem as StatsBar.

**Fix:** Remove the badge until you have real users to count, OR pull
from `app_settings`, OR change wording to a non-numeric claim
("نخدم مجتمع مِشوار في فلسطين" — "we serve the Mishwar community
in Palestine").

### 8. Twitter handle — `index.html:107` + `index.html:65`

**What's wrong:** Schema.org `sameAs` and Twitter card meta both
reference `@mishwarps` / `https://twitter.com/mishwarps`. If that
account doesn't exist or isn't yours, you're directing search-engine
trust signals to nothing (or worse, someone else's account).

**Fix:** confirm you own `@mishwarps`, or change the handle, or remove
the Twitter card meta + Schema.org `sameAs` entry.

---

## 🟡 SHOULD make configurable (works today but should hit live data)

These currently have hardcoded values that work, but should pull from
`app_settings` so an admin can change them without a deploy.

### 9. Service-level claims — `src/pages/Safety.jsx`

Lines 21-26 claim "24/7 support" and "we monitor trip quality
continuously and take immediate action on complaints." If these
aren't true, rewrite the copy to what IS true.

**Fix:** rewrite to factual claims, OR add a `service_features` JSON
column on `app_settings` so each claim is admin-editable + can be
disabled until it's actually offered.

### 10. Cancellation policy — multiple places

The 2-hour cancellation rule is hardcoded as a string in Help.jsx,
Safety.jsx, and Terms.jsx. If the policy ever changes, three places
to edit (and risk inconsistency).

**Fix:** add `cancellation_window_hours INT DEFAULT 2` to
`app_settings`, render the value into the strings via
`{settings.cancellation_window_hours}`.

### 11. Commission rate — partially live

`app_settings.commission_rate` exists in the schema but I don't see
it surfaced anywhere in the UI. Drivers should see what cut goes to
the platform.

**Fix:** add to driver onboarding ("نأخذ {commission_rate}% عمولة من
كل رحلة") and to the trip-create confirmation.

### 12. Quick suggested routes — `src/components/home/HeroSection.jsx:200-213`

Three hardcoded city pairs (`رام الله ← نابلس` etc.) act as
suggested searches. Fine for cold start but should eventually reflect
the actually-popular routes (which `Community.jsx` already computes).

**Fix:** replace with a 3-route query against trips:
```
SELECT from_city, to_city, COUNT(*) AS n
FROM trips
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY from_city, to_city
ORDER BY n DESC LIMIT 3
```
Wrap in a SECURITY INVOKER view or RPC. Hardcoded list becomes the
fallback for empty results.

---

## 🟢 OK as-is (deliberately static configuration, not "data")

These are hardcoded but legitimately so — they're configuration, not
content claiming to be live.

- **City list** (`src/lib/cities.js`) — 324 Palestinian localities.
  This is reference geography. Hardcoded is right.
- **City coordinates** (`src/lib/mapUtils.js` CITY_COORDS) — 363 lat/lng
  pairs. Reference data. Hardcoded is right.
- **City color palette** (`FeaturedTrips.jsx` CITY_COLORS) — visual
  branding. Hardcoded is right.
- **Form placeholders** ("محمد أحمد" in Login.jsx as a sample name format,
  "مثال: كيا سبورتاج" for car model) — clearly marked example formats.
- **HowItWorks mockup screens** (`HowItWorks.jsx`) — fake driver names
  appear inside phone-frame illustrations that are clearly mockup
  screenshots showing what the app looks like. Like a marketing visual.
  Fine.
- **Permanent legal text** — Terms, Privacy Policy bodies. Hardcoded is
  right because they're legal documents (and lawyer review per C-10
  will edit them in code, not at runtime).

---

## Priority recommendation

For launch, fix items 1-7 in this order:

1. **#5 Footer support contact** (10 min — already-have-the-pattern fix)
2. **#6 driver name fallback** (1-line change)
3. **#1 StatsBar** (decide: hide or make conditional)
4. **#7 hero "+10,000" badge** (decide: remove or replace)
5. **#3 AboutUs team** (decide: list real or hide)
6. **#2 testimonials carousel** (decide: hide or build admin UI)
7. **#4 blog page** (decide: hide route or build admin UI)
8. **#8 Twitter handle** (verify you own it)

Items 9-12 are nice-to-haves; can defer.

---

## What I can do next

If you tell me how you want to handle each of items 1-8, I can ship the
code changes in a single commit batch. The "easy" ones (5, 6, 8) I can
do without input. For the others I need decisions:

- **Hide vs make-admin-editable** for testimonials, team, blog, stats
  badge, and StatsBar. Hiding is faster (1 day to launch); admin-editable
  is more flexible but takes a few hours of new admin-UI work per item.

Tell me what you want for each and I'll execute.
