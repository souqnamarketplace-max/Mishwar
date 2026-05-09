# Post-deploy smoke test — مشوارو

A 5-10 minute click-through that verifies the most-broken-if-broken paths
still work. Run after:

- Applying any SQL migration to the production Supabase project
- Merging a multi-commit batch to main
- Any change touching auth, RLS, booking flow, or storage

---

## 0. Setup (once)

Create three test accounts on production. Save their credentials in your
password manager:

- `smoke-passenger@example.com` — passenger account, no driver perms
- `smoke-driver@example.com` — driver account, license approved
- `souqnamarketplace@gmail.com` — admin (already exists; just keep
  password handy)

Use a VPN or different browser profiles so you can be logged in as
multiple roles simultaneously. Personal recommendation: Chrome (admin),
Firefox (driver), Safari Private (passenger).

---

## 1. Auth flow (1 min)

In Safari Private (signed out):

- [ ] Open `/` → page renders, hero slideshow advances every few seconds
- [ ] Click "تسجيل الدخول" → login page loads
- [ ] Click "إنشاء حساب جديد" → register page loads
- [ ] Try to sign up with password `Abc123` → rejected with "8 chars
      minimum" message (audit H-04 active)
- [ ] Try `password` → rejected with "common password" message
- [ ] Sign in as `smoke-passenger` → land on home, top-right shows avatar

If any of these fail: AuthContext or Login form regression. Check
recent commits to `src/lib/AuthContext.jsx` or `src/pages/Login.jsx`.

---

## 2. Privilege escalation IS DEAD (30 sec) — CRITICAL

In dev tools console of `smoke-passenger`'s browser, paste and run:

```js
const url   = "https://dimtdwahtwaslmnuakij.supabase.co";
const anon  = "<your VITE_SUPABASE_ANON_KEY>";
const auth  = JSON.parse(localStorage.getItem(
  Object.keys(localStorage).find(k => k.endsWith("-auth-token"))));
fetch(`${url}/rest/v1/profiles?id=eq.${auth.user.id}`, {
  method: "PATCH",
  headers: { apikey: anon, Authorization: `Bearer ${auth.access_token}`,
             "Content-Type": "application/json", "Prefer": "return=representation" },
  body: JSON.stringify({ role: "admin" })
}).then(r => r.text()).then(console.log)
```

**Expected:** error response with `code: "42501"` and message `modifying
role requires admin`. No row returned with `role: "admin"`.

If this returns success: migration 002 reverted. Stop everything and
re-apply migration 002.

---

## 3. Booking flow (2 min)

As `smoke-driver`:

- [ ] Go to `/create-trip`
- [ ] Create a trip: any city pair, today's date, time 1 hour from now,
      price ₪50, 2 seats
- [ ] Confirm trip appears under "/my-trips" in "as driver" section
- [ ] Note the trip URL — you'll need it

As `smoke-passenger` (different browser):

- [ ] Open the trip URL → page loads, shows driver name + price
- [ ] Click "احجز مقعدك" → confirm modal → "تأكيد"
- [ ] Booking success toast appears within 2 seconds
- [ ] Land on `/booking-confirmation?trip=...` page
- [ ] Page shows trip details + payment instructions
- [ ] If trip method was bank_transfer: bank details visible (audit M-07
      working — passenger can see driver's payment info via RPC)
- [ ] If trip method was cash: "ادفع للسائق نقداً" visible

If booking failed: most likely the book_seat RPC isn't deployed
(migration 003 missing) — apply it.

---

## 4. Concurrent booking race (90 sec) — CRITICAL

This is the test that confirms migration 003's atomicity guarantee.

Setup: as `smoke-driver`, create a trip with **available_seats=1**.

In two browser windows (passenger A and a second passenger account if
you have one — or fake by clearing the booking and redoing), open the
trip URL on both. Count "3, 2, 1, click both Book buttons".

**Expected:** exactly ONE booking succeeds. The other shows "لم يتبقَ
عدد كافٍ من المقاعد".

If both succeed: book_seat RPC isn't being called. Check
`src/pages/TripDetails.jsx` bookingMutation — should be a direct
`supabase.rpc("book_seat", ...)`.

---

## 5. Storage — license upload (1 min)

As `smoke-driver` going through onboarding:

- [ ] Upload a license image
- [ ] In Supabase Dashboard → Storage → Browse `uploads` bucket
- [ ] Confirm the new file is at path `<driver-uuid>/...` (UUID-prefixed
      per audit C-03 fix). NOT `public/timestamp.jpg`.

If files are landing at `public/...`: the storage upload code regressed.
Check `src/api/base44Client.js`, `src/pages/Onboarding.jsx`,
`src/pages/AccountSettings.jsx` — all three should use UUID prefix.

---

## 6. Messages composer — deleted user gate (1 min)

Hardest to test without an actual deleted user, but if you have one:

- [ ] Go to Messages, open a conversation with a `*@deleted.local` user
- [ ] Composer should show "⚪️ هذا المستخدم حذف حسابه"
- [ ] No send button or input visible

If composer is open and accepts text: deleted-user gate regressed
(commit `921c445`). Check `src/pages/Messages.jsx`
`activeIsDeleted` branch.

---

## 7. Notification spam guardrail (30 sec) — SECURITY

In `smoke-passenger`'s console:

```js
// Try to send a notification to admin pretending it's from the system
const url = "https://dimtdwahtwaslmnuakij.supabase.co";
const auth = JSON.parse(localStorage.getItem(
  Object.keys(localStorage).find(k => k.endsWith("-auth-token"))));
fetch(`${url}/rest/v1/notifications`, {
  method: "POST",
  headers: { apikey: "<your VITE_SUPABASE_ANON_KEY>",
             Authorization: `Bearer ${auth.access_token}`,
             "Content-Type": "application/json" },
  body: JSON.stringify({
    user_email: "souqnamarketplace@gmail.com",
    title: "[INJECTION TEST]",
    message: "If you see this, the gate failed",
    type: "system",
  })
}).then(r => r.text()).then(console.log)
```

**Expected:** `403` / `42501` / "new row violates row-level security
policy". The notification does NOT appear in admin's notification bell.

If admin sees the test notification: migration 002 §C-07 reverted.

---

## 8. Admin dashboard (1 min)

As admin (`souqnamarketplace`):

- [ ] Open `/dashboard` → loads without crash, NO error boundary fallback
- [ ] Top bar shows: title, broadcast button, **🔔 admin bell** (NEW),
      avatar — all four side by side
- [ ] Charts render (recharts lazy-loaded chunk works)
- [ ] Click "Users" tab → list of users renders, trip counts accurate
- [ ] Click "Trips" tab → filters bar visible (search + status + date range)
- [ ] Click "Bookings" tab → filters bar with status + payment status
- [ ] Click "Logs" tab → audit log entries visible
- [ ] Click "Reports" tab → report list with category filter
- [ ] Click "المدن المقترحة" (Cities) tab — NEW — should show 3 sub-tabs
- [ ] Click "Licenses" tab → if any licenses pending, click one →
      modal shows the license image. After migration 004 + backfill,
      the image URL will be a signed URL like `...?token=...` not a
      direct public URL.

If `/dashboard` 404s for non-admin: client-side gate is working but
that's belt+suspenders — the real gate is RLS on every admin-restricted
table.

If the page shows "حدث خطأ غير متوقع" error boundary: something in
the dashboard render path is throwing. Open DevTools → Console → look
for the stack trace. Most recent suspect: NotificationBell vs
AdminNotificationBell channel race (fixed in 991e049).

---

## 9. Admin notification bell (1 min) — NEW

The dashboard has a dedicated bell that surfaces admin notifications
in real-time (with a 30s polling fallback).

As admin on `/dashboard`:

- [ ] Click the 🔔 in the top bar → dropdown opens
- [ ] If unread: red badge with count (capped at "9+")
- [ ] Each row shows: emoji + title + message snippet + Arabic date
- [ ] Click a row → marks as read + navigates to relevant dashboard tab:
      - 💳 اشتراك → /dashboard?tab=subscriptions
      - 🚩 بلاغ → /dashboard?tab=reports
      - 🪪 رخصة → /dashboard?tab=licenses
      - 🗺️ مدينة → /dashboard?tab=cities
      - 💡/⚠️/💚 شكوى/اقتراح/إشادة → /dashboard?tab=feedback
      - ⚠️ تقييم منخفض → /dashboard?tab=reviews
- [ ] Click "تحديد الكل كمقروء" → all unread badges disappear

In another browser/incognito as a regular user:

- [ ] Submit a city suggestion via home page autocomplete (type a fake
      village name → tap "اقتراح إضافة")
- [ ] Submit feedback at `/feedback`
- [ ] Within 30 sec, admin's bell badge increments

If badge doesn't increment within 60 sec: realtime channel issue.
Polling fallback should still pick it up at the 30s mark — if even
polling misses it, check Supabase → notifications table → confirm
the row was created with `user_email = souqnamarketplace@gmail.com`.

---

## 10. City suggestion flow (1 min) — NEW

As any signed-in user (not necessarily admin):

- [ ] Home page → click "من أين تنطلق؟" → type a fake village name
- [ ] Dropdown shows "لا توجد نتائج" + highlighted "اقترح إضافة" button
- [ ] Tap suggest button → modal opens with name pre-filled
- [ ] Add an optional landmark note → submit
- [ ] Green "تم إرسال اقتراحك ✓" confirmation

As admin:

- [ ] `/dashboard?tab=cities` → "قيد المراجعة" tab → see the suggestion
- [ ] Higher `duplicate_count` if multiple users suggested same name
- [ ] Click "موافقة وإضافة الإحداثيات"
- [ ] Paste a Google Maps URL → lat/lng auto-fill
- [ ] Submit → green "تمت الموافقة وأُضيفت المدينة ✓"
- [ ] Within 5 min, the new city appears in autocomplete for ALL users

---

## 11. Driver subscription (1 min)

As driver:

- [ ] `/driver` → if subscription required, see "اشترك الآن" card
- [ ] Tap → submit a payment with method + reference
- [ ] Success toast → admin gets a 💳 notification

As admin:

- [ ] `/dashboard?tab=subscriptions` → see the new pending row
- [ ] Click "موافقة" → status flips to active, period_end set
- [ ] Driver can now post trips (subscription gate passed)

---

## 12. Pull-to-refresh (mobile only)

On a real phone or Chrome DevTools device emulation:

- [ ] Open home page → swipe down from top → spinner appears with rotation
- [ ] Past ~80px threshold → release → React Query invalidates, data refetches
- [ ] Release before threshold → snaps back, no refetch
- [ ] At any scrolled-down position → swipe down → no spinner (correct)

If swipe feels sticky or unresponsive: the listener-churn fix in 0463ed2
might have regressed.

---

## 13. Filter system (admin) (90 sec) — NEW

Visit each of these tabs and exercise the filters:

| Tab | Filters to test |
|---|---|
| Trips | Search "نابلس" → see only Nablus trips; status=completed → only completed; date=7 days |
| Bookings | Payment status=paid → only paid bookings; combined with status filter |
| Reviews | Rating=1 → only 1-star reviews; date=30 days |
| Reports | Category dropdown shows REPORT_CATEGORIES; combined with status tabs |
| Notifications | Type=license_approved → only those |
| Offers | active=true → only active coupons; search by code |
| Payments | Same as Bookings filters |

UUID paste-to-jump test:

- [ ] Copy any row's id from `/dashboard?tab=trips` (right-click → inspect)
- [ ] Paste it into the search box on the Trips tab → exact row appears
- [ ] (Same UUID logic should work on any filter-enabled page)

---

## 14. Build & CI (passive)

- [ ] Open https://github.com/souqnamarketplace-max/Mishwar/actions
- [ ] Most recent run on main: green checkmark
- [ ] If red: click into it → see which step failed → most likely the
      "console-leak" or "credential-leak" guards. Report back.

---

## 15. Sentry (when wired)

After H-03 activation (npm i @sentry/react + DSN set):

- [ ] In dev tools, intentionally trigger an error
- [ ] Wait 60 sec, check Sentry dashboard → event appeared
- [ ] beforeSend scrubbed the email (you'll see `***@***` not the
      actual email in the Sentry event)

---

## Failure escalation

If any test fails, in order:

1. **Identify the commit range** since the last known-good state.
   `git log --oneline <last-good>..HEAD`
2. **Roll back at Vercel** if it's a code issue: Dashboard → Deployments
   → previous green build → "Promote to Production"
3. **Restore from Supabase backup** if it's a DB issue. Take a snapshot
   first so you can compare.
4. **Send to me with:** the commit SHAs, the test that failed, the exact
   error message (or screenshot of the unexpected behavior).
