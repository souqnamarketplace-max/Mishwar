# Pre-launch tracker — مِشوار

Live status of every audit finding from
[`docs/audits/2026-05-05-pre-launch-audit.md`](audits/2026-05-05-pre-launch-audit.md).

**Last updated:** 2026-05-06 (overnight remediation session)
**HEAD at update:** `09ae8c2`

Status legend:
- ✅ shipped — fully closed in code or SQL applied
- 📦 staged — code/SQL ready in repo but requires a manual step (apply migration, run backfill, lawyer review)
- ⏳ pending — not yet started

---

## Critical (must close before launch)

| ID | Finding | Status | Notes |
|---|---|---|---|
| C-01 | Privilege escalation via user-editable `role` | 📦 | Migration `002` ready. Apply in Supabase SQL Editor. |
| C-02 | Reflected XSS in `/api/og` | ✅ | Shipped in `77f8da3` — proper esc() + length caps + nosniff/DENY headers. |
| C-03 | Driver license images in PUBLIC bucket | 📦 | Code: upload paths now UUID-prefixed (`9816411`). SQL: migration `004` ready. Backfill: not yet written. |
| C-04 | Bookings UPDATE column-level integrity | 📦 | Migration `002` includes guard_booking_updates trigger. |
| C-04b | Trips UPDATE column-level integrity (H-12) | 📦 | Migration `002` includes guard_trip_updates. |
| C-05 | Account deletion doesn't anonymize email | 📦 | RPC `delete_user_account_v2` ready in migration `003`. UI cutover pending — old flow still runs until cutover commit. |
| C-06 | Seat-booking race condition | 📦/✅ | RPC ready in migration `003`. UI cutover ✅ shipped in `15d7bdb` with graceful fallback — works whether or not migration is applied. |
| C-07 | Notification spam vector | 📦 | Migration `002` tightens `notifications_insert`. |
| C-08 | Review fraud (no booking precondition) | 📦 | Migration `002` adds `guard_review_must_have_booking` + unique index. |
| C-09 | Receivers can edit message content | 📦 | Migration `002` splits messages_update + adds receiver guard trigger. |
| C-10 | Privacy policy contradicts GPS use | ⏳ | Lawyer engagement required. ~$200-500 per audit. |

---

## High

| ID | Finding | Status | Notes |
|---|---|---|---|
| H-01 | CSP allows `unsafe-eval` | ✅ | Shipped in `77f8da3` — `unsafe-eval` removed; added object-src/base-uri/form-action/manifest-src. `unsafe-inline` retained pending nonce-based CSP work. |
| H-02 | Hardcoded anon-key fallbacks | ✅ | Shipped in `77f8da3` — falls through to env-only, no hardcoded keys in source. |
| H-03 | Sentry is a stub | ⏳ | Plan: `npm i @sentry/react` + uncomment init in `src/lib/sentry.js`. |
| H-04 | Password floor 6 chars | ✅ | Shipped in `42a5d4e` — raised to 8 chars + score≥3 + common-password block. |
| H-05 | SECURITY DEFINER missing search_path | 📦 | Migration `002` ALTERs every known SECURITY DEFINER function. |
| H-06 | No CAPTCHA on signup | ⏳ | Enable in Supabase Dashboard → Auth → enable Captcha protection (hCaptcha integration). |
| H-07 | Phone never verified | ⏳ | Twilio integration. Drivers required, passengers optional. |
| H-08 | Realtime publication may not be enabled | ⏳ | Run `ALTER PUBLICATION supabase_realtime ADD TABLE messages, notifications;` in SQL editor. |
| H-09 | `notif_push=false` drops in-app notifications | ⏳ | Schema change: split into `notif_push` and `notif_in_app`. |
| H-10 | Account deletion preconditions client-side | 📦 | RPC `delete_user_account_v2` (migration 003) does server-side preconditions. UI cutover pending. |
| H-11 | File upload MIME via client claim only | ⏳ | Magic-byte validation via Edge Function for licenses. |
| H-12 | trips_update_driver no WITH CHECK | 📦 | See C-04b above. |

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
| M-07 | Plaintext payment columns | ⏳ | pgsodium encryption or audit-logged side table. |
| M-08 | No backup procedure documented | ⏳ | Confirm Supabase plan; document in DEPLOY.md. |
| M-09 | No alerting | ⏳ | Vercel email + Supabase quota + UptimeRobot. |
| M-10 | No rate limiting on /api routes | ⏳ | Upstash Redis or in-memory. |
| M-11 | OG cache too aggressive | ✅ | Shipped in `77f8da3` — lowered to s-maxage=30, swr=60. |
| M-12 | available_seats negative-clamp | 📦 | Migration `002` verifies/adds CHECK constraint. |
| M-13 | Hardcoded test driver emails | ⏳ | Audit prod for `*@mishware.com` accounts. |
| M-14 | No dependency update strategy | ⏳ | Add Dependabot config. |

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
| L-07 | Static "Last updated" date on legal pages | ⏳ | Auto-stamp from build. |
| L-08 | Inconsistent localStorage parse error handling | ✅ | `src/lib/session.js` helper added (`42a5d4e`). Existing call sites still work; new code uses helper. |
| L-09 | Raw error strings in toasts | ⏳ | Whitelist friendly messages by error code. |
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

---

## Apply order tomorrow morning

When you wake up, the deploy sequence is:

1. **Take a Supabase backup.** Dashboard → Database → Backups → "Create backup now". Skip only if you accept the risk.

2. **Apply migration 002.** Open SQL editor, paste `migrations/002_phase0_security_hardening.sql` in one go, run. Confirm every line in the output starts with `✓`. If anything fails, the transaction rolls back — fix and retry.

3. **Verify migration 002 didn't break anything.** Hit the production URL, log in as a regular user, browse trips, send a message. ~5 minutes.

4. **Apply migration 003.** Paste `migrations/003_phase1_atomic_rpcs.sql`. Confirm `✓` on book_seat and delete_user_account_v2. After this, the RPC path in `src/pages/TripDetails.jsx` activates automatically — book a test trip and confirm the booking lands.

5. **Optional: apply migration 004.** Storage hardening. Confirm test license uploads still work afterward — the upload code now writes UUID-prefixed paths so it should be fine.

6. **Run the C-01 exploit confirm.** Open browser dev console as a regular user, attempt:
   ```javascript
   fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${MY_UUID}`, {
     method: 'PATCH',
     headers: { apikey: ANON, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
     body: JSON.stringify({ role: 'admin' })
   }).then(r => r.text()).then(console.log)
   ```
   Expected: `42501` / "modifying role requires admin". If that returns success, the migration didn't apply correctly.

7. **Enable hCaptcha.** Supabase Dashboard → Auth → enable Captcha protection. ~2 minutes.

8. **Confirm realtime publication includes messages + notifications.** SQL Editor → run:
   ```sql
   SELECT pubname, schemaname, tablename
   FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime';
   ```
   Should list `messages` and `notifications`. If not, run:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
   ```

That's everything that's deployable from the work in this repo. The remaining items in the table above need a human in the loop — lawyer for privacy policy, decision on Twilio for SMS verification, etc.
