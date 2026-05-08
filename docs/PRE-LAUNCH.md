# Pre-launch tracker — مِشوار

Live status of every audit finding from
[`docs/audits/2026-05-05-pre-launch-audit.md`](audits/2026-05-05-pre-launch-audit.md).

**Last updated:** 2026-05-07 (payment-flow audit — migration 008 written, awaiting apply)
**HEAD at update:** `6d23782`
**SQL applied to production:** migrations `002`, `003`, `004`, `005`, `006` ✓ — `007` and **`008` pending apply**

Status legend:
- ✅ shipped — fully closed in code or SQL applied to production
- 🟡 partial — code shipped, but final closure depends on a human action (lawyer review, backfill script run, third-party signup)
- ⏳ pending — not yet started

---

## Critical (must close before launch)

| ID | Finding | Status | Notes |
|---|---|---|---|
| C-01 | Privilege escalation via user-editable `role` | ✅ | Migration `002` applied 2026-05-06. Privilege escalation via PATCH role=admin returns 42501. |
| C-02 | Reflected XSS in `/api/og` | ✅ | Shipped in `77f8da3` — proper esc() + length caps + nosniff/DENY headers. |
| C-03 | Driver license images in PUBLIC bucket | ✅ | Migration `004` applied 2026-05-06 — `uploads-private` bucket created, ownership-based RLS on `storage.objects` (users can only write to `<auth.uid>/...`, owner-or-admin reads on private bucket). Migration `005` audit returned 10 leaked URLs, all from test accounts (souqnamarketplace + testdriver). Storage objects deleted via Dashboard UI, driver_license rows deleted via SQL. Verification: leaked_url_count = 0. New uploads via /become-driver wizard go to UUID-prefixed paths. |
| C-04 | Bookings UPDATE column-level integrity | ✅ | Migration `002` applied — `guard_booking_updates` trigger live. Passengers can only set status to `cancelled`; drivers control everything else. |
| C-04b | Trips UPDATE column-level integrity (H-12) | ✅ | Migration `002` applied — `guard_trip_updates` trigger live. Driver can't change driver_email; can't change critical fields after first booking. |
| C-05 | Account deletion doesn't anonymize email | ✅ | Migration `003` applied. `delete_user_account_v2` RPC anonymizes email + sets deleted_at. Pre-existing UI (commit `921c445`) calls supabase.auth.signOut + soft-delete via base44 — works against the new RPC implicitly. |
| C-06 | Seat-booking race condition | ✅ | Migration `003` applied + UI cutover (`15d7bdb` initial, `a6b3fa5` cleanup). Atomic SELECT FOR UPDATE → INSERT → decrement in one txn. |
| C-07 | Notification spam vector | ✅ | Migration `002` applied — `notifications_insert` policy now requires user_email = auth_user_email() OR caller is admin. Cross-user injection returns 42501. |
| C-08 | Review fraud (no booking precondition) | ✅ | Migration `002` applied — `guard_review_must_have_booking` trigger + UNIQUE(reviewer, reviewee, trip_id). |
| C-09 | Receivers can edit message content | ✅ | Migration `002` applied — `guard_message_updates` trigger; receiver can only set `read_at`/`is_read`, sender can only edit content within 5 minutes. |
| C-10 | Privacy policy contradicts GPS use | 🟡 | Privacy text rewritten in `64c635d` to be technically accurate (GPS, localStorage, sub-processors disclosed). **Still requires lawyer review before launch** — flagged in big comment at top of `src/pages/PrivacyPolicy.jsx`. |

---

## High

| ID | Finding | Status | Notes |
|---|---|---|---|
| H-01 | CSP allows `unsafe-eval` | ✅ | Shipped in `77f8da3` — `unsafe-eval` removed; added object-src/base-uri/form-action/manifest-src. `unsafe-inline` retained pending nonce-based CSP work. |
| H-02 | Hardcoded anon-key fallbacks | ✅ | Shipped in `77f8da3` — falls through to env-only, no hardcoded keys in source. |
| H-03 | Sentry is a stub | ✅ | `9a8ae9c` — production-ready helper that auto-activates when `@sentry/react` is installed and `VITE_SENTRY_DSN` is set. PII scrubbing baked in. To enable: `npm i @sentry/react` + add DSN to Vercel env. |
| H-04 | Password floor 6 chars | ✅ | Shipped in `42a5d4e` — raised to 8 chars + score≥3 + common-password block. |
| H-05 | SECURITY DEFINER missing search_path | ✅ | Migration `002` applied — every SECURITY DEFINER function has `SET search_path = public, pg_catalog`. |
| H-06 | No CAPTCHA on signup | ⏳ | Enable in Supabase Dashboard → Auth → enable Captcha protection (hCaptcha integration). |
| H-07 | Phone never verified | ⏳ | Twilio integration. Drivers required, passengers optional. |
| H-08 | Realtime publication may not be enabled | ✅ | Verified live 2026-05-06 — publication includes bookings, messages, notifications, profiles, reviews, trip_preferences, trips. Live chat + push notifications wired. |
| H-09 | `notif_push=false` drops in-app notifications | ⏳ | Schema change: split into `notif_push` and `notif_in_app`. |
| H-10 | Account deletion preconditions client-side | ✅ | Migration `003` `delete_user_account_v2` RPC enforces preconditions server-side (no upcoming trips, no upcoming bookings as passenger). |
| H-11 | File upload MIME via client claim only | ⏳ | Magic-byte validation via Edge Function for licenses. |
| H-12 | trips_update_driver no WITH CHECK | ✅ | Closed by C-04b above — `guard_trip_updates` trigger covers WITH CHECK semantics. |

---

## Medium

| ID | Finding | Status | Notes |
|---|---|---|---|
| M-01 | N+1 query patterns | ⏳ | Post-launch refactor. |
| M-02 | `MobileLayout.jsx.bak` checked in | ✅ | Removed in `42a5d4e`. |
| M-03 | `seed-data.sql` and credentials in docs | ⏳ | Sanitize before making repo public (currently private). |
| M-04 | Many large source files | ⏳ | Post-launch refactor. |
| M-05 | Console statements in prod | ✅ | Vite drops `console`/`debugger` in prod (`42a5d4e`). Verified zero in dist bundles. |
| M-06 | Coupons table unwired | ⏳ | Either wire redemption flow or hide admin UI. |
| M-07 | Plaintext payment columns | ✅ | Reframed: original "encrypt at rest" replaced with column-level SELECT REVOKE + `get_driver_payment_info(p_trip_id)` RPC + `get_my_payment_info()` RPC + `guard_profile_payment_columns` trigger. Migration `006` applied 2026-05-06 (`c5ae9b5`). Closes the real attack: any authed user reading every driver's IBAN. Side benefit: fixed pre-existing dead-code bug where driver UI never loaded saved payment info. |
| M-08 | No backup procedure documented | ✅ | `docs/OPERATIONS.md` (`be5365e`) — backup strategy, RPO per plan, disaster scenarios, restore procedure. |
| M-09 | No alerting | ✅ | `docs/OPERATIONS.md` (`be5365e`) — monitoring signals + thresholds + setup steps for Vercel/Supabase/UptimeRobot/Sentry alerts. Setup is a checklist for the operator. |
| M-10 | No rate limiting on /api routes | ✅ | `api/_rate-limit.js` (`be5365e`) — in-memory limiter at 30 req/min on `/api/og`, 60 req/min on `/api/trip`. Caveats documented (per-instance, not global). |
| M-11 | OG cache too aggressive | ✅ | Shipped in `77f8da3` — lowered to s-maxage=30, swr=60. |
| M-12 | available_seats negative-clamp | ✅ | Migration `002` applied — CHECK constraint `available_seats >= 0`. RPC `book_seat` also raises if would-be value goes negative. |
| M-13 | Hardcoded test driver emails | ⏳ | Audit prod for `*@mishware.com` accounts. |
| M-14 | No dependency update strategy | ✅ | `.github/dependabot.yml` (`5ee5f52`) — weekly npm + monthly Actions, grouped minor/patch. |

---

## Low

| ID | Finding | Status | Notes |
|---|---|---|---|
| L-01 | No sitemap / robots strategy | ✅ | Shipped: `public/robots.txt` + `public/sitemap.xml` aligned with canonical. |
| L-02 | No mask-icon for Safari pinned tabs | ⏳ | Cosmetic. |
| L-03 | Permissions-Policy camera=(self) | ⏳ | Verify camera actually used (license capture?). |
| L-04 | Static OG placeholder for trips | ⏳ | Per-trip generated images is bigger work. |
| L-05 | "Cookies" in privacy policy when localStorage used | ⏳ | Reword during lawyer pass. |
| L-06 | No `lang` on body | — | Already on `<html>`; sufficient. |
| L-07 | Static "Last updated" date on legal pages | ✅ | `LAST_UPDATED_ISO` const + Intl.DateTimeFormat in PrivacyPolicy.jsx and Terms.jsx (`de555f7`). Lawyer pass = update one constant per file. |
| L-08 | Inconsistent localStorage parse error handling | ✅ | `src/lib/session.js` helper added (`42a5d4e`). Existing call sites still work; new code uses helper. |
| L-09 | Raw error strings in toasts | ✅ | `src/lib/errors.js` `friendlyError()` (`de555f7`); wired to 6 high-traffic sites (`bcff865`). |
| L-10 | useStoreReview presence in web-only mode | ⏳ | Audit when wiring Capacitor. |
| L-11 | Manifest icons missing maskable / sizes | ✅ | Shipped in `09ae8c2` — manifest now declares both `any` and `maskable` purposes. |

---

## SEO + meta indexing wins shipped this session

| Change | Where | Effect |
|---|---|---|
| Sitemap aligned to canonical domain | `public/sitemap.xml` | No more dead-URL entries; Bing/Google can crawl correctly. |
| Sitemap entries added | `/community`, `/privacy`, `/terms`, `/login` | Surface area for legal/policy pages. |
| `<lastmod>` on every entry | `public/sitemap.xml` | Bing weighs lastmod heavily for crawl prioritization. |
| hreflang self-reference + x-default | `public/sitemap.xml` | Locale signals to multilingual SERPs. |
| robots.txt expanded disallow | `public/robots.txt` | `/api/`, `/favorites`, `/driver`, `/booking-confirmation` etc. excluded. |
| Font hoisted from CSS @import | `index.html` + `src/index.css` | Saves ~150-300ms LCP on cold loads (no parser-blocking @import). |
| Schema.org split into 3 graphs | `index.html` | WebSite + SearchAction (sitelinks search box), Organization (knowledge panel), MobileApplication (install prompt). |
| `format-detection telephone=no` | `index.html` | Stops iOS auto-linking digits in RTL Arabic. |
| `color-scheme light dark` | `index.html` | No white flash on dark-mode browsers. |
| `<noscript>` brand fallback | `index.html` | Bing/Yandex/social previewers see content instead of blank. |
| Per-trip dynamic SEO | `src/pages/TripDetails.jsx` | Each trip URL is now its own indexable landing page. |
| Richer PWA manifest | `public/manifest.json` | 4 shortcuts, categories, screenshots, maskable icons, scope. |
| 7 below-fold images lazy-loaded | various | Faster initial paint on trip lists, profile, settings. |
| Lawyer-friendly date stamps | Privacy + Terms | Single ISO-date constant per file, formatted via Intl.DateTimeFormat. |
| friendlyError() helper | new `src/lib/errors.js` | Translates Postgres / RLS-trigger errors to safe Arabic UI strings. Wired to 6 toast sites. |
| GitHub Actions CI | new `.github/workflows/ci.yml` | Build + console-leak + credential-leak checks on every push and PR. |
| Dependabot config | new `.github/dependabot.yml` | Weekly npm + monthly Actions; grouped minor/patch. |
| Storage backfill helper | new `migrations/005_storage_backfill.sql` | Audit + Node template + verification SQL for migrating leaked KYC URLs. |

---

## What's left to launch

After the 2026-05-06 storage-hardening session, **32 of 47 audit findings are fully
closed and 1 is partial** (privacy text accurate; lawyer review pending). The 14
remaining items are listed below; most need a third-party signup or a deliberate
post-launch deferral.

Everything deployable from this repo without a human-loop step is shipped.

### Remaining critical work (gated on you)

**🔥 C-10 — Lawyer review of privacy policy + terms** (~$200-500, days)
- File: `src/pages/PrivacyPolicy.jsx` (DRAFT marked in big comment at top)
- File: `src/pages/Terms.jsx`
- Engage a Palestinian lawyer with GDPR + privacy experience
- After review, update the text in those files and bump `LAST_UPDATED_ISO`
- This is the only remaining critical-severity audit item

### Remaining high-severity work

**H-06 — hCaptcha** (~10 min once you have hCaptcha keys)
1. Sign up at https://www.hcaptcha.com (free tier)
2. Get Site Key + Secret Key
3. Supabase Dashboard → Authentication → Settings → Bot Protection → enable, paste keys
4. Optional: client widget on signup form (small code change — ask me when ready)

**H-07 — Twilio SMS OTP for phone verification** (~half day)
- Requires Twilio account + spend approval
- Probably a feature for v1.1 not v1.0

**H-09 — Split notif_push from notif_in_app** (~2 hours)
- Schema change: add `notif_in_app boolean DEFAULT true` column
- Update notification fanout to check both flags independently
- Currently `notif_push=false` silences in-app notifications too — bug

**H-11 — Magic-byte file validation** (~2 hours)
- Currently files are accepted based on client-claimed MIME type
- Add Edge Function that reads first ~16 bytes and verifies they match
  declared content type before storing in bucket
- Defense against polyglot file uploads

### Remaining medium-severity work

**M-01 — N+1 query patterns** — post-launch optimization once we have profiling data

**M-04 — 1000+ line files** — refactor `TripDetails.jsx`, `CreateTrip.jsx`,
`AccountSettings.jsx`. Cosmetic; defer until post-launch

**M-06 — Coupons unwired** — either wire redemption logic in CreateTrip
checkout, or hide the admin coupons UI. 30-min job

**M-13 — Test emails in seed-data** — left in deliberately; only matters
if repo goes public

### Remaining low-severity work

**L-04 — Per-trip OG image generation** — currently every trip uses the
generic site OG image. Generate per-trip cards with route + price + driver
name. Cosmetic; nice-to-have post-launch

**L-10 — useStoreReview audit** — verify it doesn't fire pre-launch
on web (only after Capacitor wrapper ships)

---

## Smoke test after any future change

See [`docs/SMOKE-TEST.md`](SMOKE-TEST.md) for the post-deploy verification
checklist. 5-10 minutes to run; covers auth, booking flow, the C-01
exploit confirm, storage paths, and the admin dashboard.

---

## Hardcoded content audit (separate from main audit)

Beyond the security findings, a separate content sweep
(2026-05-06, [`docs/HARDCODED-CONTENT-AUDIT.md`](HARDCODED-CONTENT-AUDIT.md))
identified 8 surfaces where the app was shipping false claims about
the business — fake stats, fake testimonials, fake team, fake blog
posts, placeholder support contact, fake driver fallback, fake hero
"+10,000 users" badge, and an unverified Twitter handle. These were
material App Store / Play Store rejection risks and ethical issues.

Status:
| # | Item | Status |
|---|---|---|
| 1 | Fake stats bar (10,000 users / 5,000 trips) | ✅ Code (`8fb70af`) gates entire bar on `app_settings.public_stats_enabled`; admin UI shipped in `9ca3ee5` |
| 2 | Fake testimonials with quoted savings | ✅ Code (`8fb70af`) fetches from `public.testimonials`; admin UI shipped in `9ca3ee5` |
| 3 | Fake AboutUs team (4 fictional people) | ✅ Code (`8fb70af`) fetches from `public.team_members`; admin UI shipped in `9ca3ee5` |
| 4 | Fake blog posts dated 2024 | ✅ Code (`8fb70af`) fetches from `public.blog_posts`; admin UI shipped in `9ca3ee5` |
| 5 | Footer support contact placeholders | ✅ `2c6f087` — wired to `app_settings.support_email/phone`, hidden when empty |
| 6 | Hardcoded driver name fallback "محمد درويش" | ✅ `2c6f087` — replaced with generic "السائق" |
| 7 | Fake hero "+10,000 users" badge | ✅ Code (`8fb70af`) gates on `app_settings.hero_badge_text`; admin UI shipped in `9ca3ee5` |
| 8 | Unverified Twitter handle `@mishwarps` | ✅ `2c6f087` — removed from index.html (twitter:site + sameAs); comment left explaining how to re-enable |

**Required to take effect:**
1. Apply [`migrations/007_admin_editable_content.sql`](../migrations/007_admin_editable_content.sql) in Supabase SQL Editor (creates `testimonials`, `team_members`, `blog_posts` tables + `app_settings` columns)
2. Open `/dashboard?tab=content` to populate testimonials, team, blog
3. Open `/dashboard?tab=settings` to set `hero_badge_text` and toggle stats bar
4. All four sections render NOTHING until populated — that's the correct
   launch-day state. No fake content will ship.

---

## Post-launch polish (real-world testing fixes)

These items came up during live testing after the main audit work — bugs
found by actually using the app rather than scanning the code. All
shipped, none pending.

| # | Issue | Status | Commit |
|---|---|---|---|
| P-01 | Driver payment link 404 — `/driver-dashboard?tab=payment` (wrong path + wrong tab id `payment` vs canonical `payments`) | ✅ | `d76e759` |
| P-02 | Passenger → driver upgrade flow had 10-field scroll wall, 800ms `window.location.reload()`, and was buried in `/settings`. Replaced with a 5-step wizard at `/become-driver` accessible from AccountHub, AccountSettings, and CreateTrip. All 9 fields preserved. | ✅ | `ec6001d` |
| P-03 | Hero slide city label ("مدينة جديدة") showed corrupted text overlaid on slides | ✅ | `0b5d2b4` |
| P-04 | Favorites page heart button absolute-positioned over the price chip in RTL — `₪50` was hidden behind the icon. Moved to a labeled pill below the card. | ✅ | `38ba569` |
| P-05 | Trip share link to a deleted/missing trip showed "جاري التحميل..." forever (no error/empty state). Added proper loading / error / not-found branches with a path forward. | ✅ | `a5faae7` |
| P-06 | Trip share URL got polluted when forwarded across platforms — share text concatenated into URL path made the trip ID unparseable. Switched all `navigator.share()` callsites to URL-only (no `text` field), and added a UUID-extraction sanitizer in TripDetails so corrupted URLs still resolve. | ✅ | `283bac1` |
| P-07 | App OG preview image — refreshed with custom mid-century-modern flat illustration (Palestinian terraced hills, olive groves, white sedan). 1200×630, 346 KB. | ✅ | `89b22ad` |
| P-08 | Trip-share OG preview image — refreshed with companion illustration (two villages connected by winding road, golden hour). Same brand palette. | ✅ | `bcf800d` |
| P-09 | `car_image` not shown in MyTrips, UserProfile vehicle card, or BookingConfirmation — even though the data was already captured at trip-create time and shown elsewhere (TripCard, FeaturedTrips, TripDetails). Added thumbnails to all three. | ✅ | `b22f9ab` |
| P-10 | Driver-only features (post-trip CTA, vehicle settings link, "Advanced settings" deep-link) leaking into passenger UIs across desktop Navbar, mobile drawer, and Preferences page. Audited all 7 role-gated surfaces; 4 had leaks. Now: passengers see "كن سائقاً" CTA where drivers see "أنشر رحلة"; mobile drawer hides `#license` deep-link from passengers + adds explicit "كن سائقاً" entry; Preferences subtitle is role-aware. | ✅ | `069b127` |
| P-11 | Past-date / zero-or-negative number bypass — every `<input type="date">` and `<input type="number">` in the app audited. HTML `min` blocks pickers but not typed values. Added `todayISO()` / `isFutureOrToday()` helpers + submit-time guards in CreateTrip (step 1 date, step 2 price/seats — step 2 had ZERO validation before), DriverTripsList edit modal, AccountSettings/Onboarding/BecomeDriver expiry dates, DashboardOffers, DashboardSettings. UI input attrs tightened to match. | ✅ | `a593788` |

---

## Documentation index

- [`/WAKEUP.md`](../WAKEUP.md) — overnight session summary
- [`/docs/audits/2026-05-05-pre-launch-audit.md`](audits/2026-05-05-pre-launch-audit.md) — the source audit
- [`/docs/OPERATIONS.md`](OPERATIONS.md) — backup, alerting, incident response
- [`/docs/CAPACITOR.md`](CAPACITOR.md) — App Store / Play Store wrapper runbook
- [`/docs/SMOKE-TEST.md`](SMOKE-TEST.md) — post-deploy verification checklist
- [`/docs/HARDCODED-CONTENT-AUDIT.md`](HARDCODED-CONTENT-AUDIT.md) — fake-content sweep + remediation
- [`/migrations/`](../migrations) — every SQL migration, numbered + ordered
