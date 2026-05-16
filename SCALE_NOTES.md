# مشوارو — Scale & Load Notes

This document captures the load-readiness audit done before opening to
significant traffic. It's living: update it when channels are added or
queries change.

Last reviewed: 2026-05-15.

## Realtime channels per user session

Each browser session opens N Supabase realtime channels. Supabase
imposes a hard cap per project: **500 concurrent channels on Pro tier**,
~10,000 on Team. Knowing channels-per-user × peak-concurrent-users tells
you what tier you need.

### Regular passenger / driver (post-login)

| Channel name | Source | Notes |
|---|---|---|
| `trips-realtime` | Shared `Trip.subscribe()` (apiClient registry) | Used by every TripCard, SearchTrips, DriverTripsList, FeaturedTrips, MyTrips, etc. ONE channel total. |
| `bookings-realtime` | Shared `Booking.subscribe()` | Used by DriverPassengers, BookingRequestPopup, DriverDashboard, MyTrips. ONE channel total. |
| `notifications-realtime` | Shared `Notification.subscribe()` | Used by the Notifications page only (NotificationBell's shared sub was removed for scale). |
| `messages-realtime` | Shared `Message.subscribe()` | Used by Messages page. |
| `notif-push-${userEmail}` | NotificationBell direct (filtered INSERT) | Per-user filtered channel for push toasts. |
| `unread-msgs-${userEmail}` | useUnreadMessageCount direct | Per-user filtered channel for the badge count. |

**Total per regular session: ~6 channels** (4 shared globally + 2 per-user).

### Admin on dashboard pages

Admins additionally open:

| Channel name | Source |
|---|---|
| `profiles-realtime` | DashboardUsers |
| `driverlicense-realtime` | DashboardLicenses |
| `review-realtime` | (StatsBar's Review sub was removed for scale.) |

**Total per admin session: ~7-8 channels.**

### Channel-count math for capacity planning

```
peak_concurrent_users × ~4 channels/user ≤ project_realtime_channel_limit
```

The limit is **per-project**, not org-wide, and depends on Compute size:

| Compute size | ~Realtime channel ceiling | ~Concurrent users supported |
|---|---|---|
| Micro (default Pro) | ~100 | ~25 |
| Small | ~200 | ~50 |
| Medium | ~500 | ~125 |
| Large | ~1,000 | ~250 |
| XL+ | scales further | — |

**Current setup (verified 2026-05-15):** Pro plan, TAWSELA project on
Micro Compute. Capacity ceiling: ~25-50 concurrent realtime users. The
PostgREST/HTTP side scales further (a few thousand req/sec), so REST
endpoints (search, book_seat, etc.) handle far more users than realtime
does. **The bottleneck is realtime.**

### When to upgrade

Watch Supabase dashboard → TAWSELA project → Logs Explorer for:

  - `"too many connections"` errors
  - Realtime `"channel error"` or `"max connections"` messages
  - HTTP 503 / 504 spikes during peak commute hours

Watch Reports → Database for:

  - Memory consistently >70% (Micro has 1GB; very easy to saturate)
  - CPU >50% sustained for >5 min

When ANY of these appear: upgrade TAWSELA to Small Compute (dashboard
→ Settings → Compute and Disk). Takes ~10 min, brief project restart,
no code changes. Doubles RAM and roughly doubles realtime ceiling.

The other two projects (Souqnin, MiNest) can stay on Micro as they're
not the rideshare's hot path.

### Channels removed for scale (don't reintroduce without reason)

1. **NotificationBell.jsx** — secondary `Notification.subscribe()` shared-
   channel listener. Its only job was catching cross-tab `is_read` UPDATEs
   in the rare case a user has the same account open in 2+ tabs. The
   filtered per-user `notif-push-` channel handles INSERTs; cross-tab
   UPDATEs reconcile on 30s staleTime. Removed in commit before launch.

2. **Notifications.jsx** — `TripPreference.subscribe()`. Saved-route alert
   preferences are low-frequency; the 60s staleTime is fine when the
   user is on the page. Removed.

3. **StatsBar.jsx** — `Review.subscribe()`. Homepage stats refresh every
   60s via staleTime; reviews submit at low frequency (once per
   completed trip). Realtime was overkill. Removed.

If you're tempted to add a per-user filtered channel for a new feature,
first check whether the polling cost (one query every 30-60s) is
acceptable. Realtime channels are expensive at scale; polling scales
linearly with users but doesn't hit hard caps.

## Database query hot paths + indexes

Indexes added in **migration 056** to support the four highest-frequency
queries:

| Query | Index | Frequency |
|---|---|---|
| `SearchTrips` — `WHERE status IN (...) AND date >= today` | `idx_trips_date_status` on `trips(date, status)` | Every passenger app open |
| Driver dashboards — `WHERE trip_id = X AND status IN (...)` | `idx_bookings_trip_status` on `bookings(trip_id, status)` | Every driver dashboard view |
| `MyTrips` — `WHERE passenger_email = X ORDER BY created_at DESC` | `idx_bookings_passenger_created` on `bookings(passenger_email, created_at DESC)` | Every "my bookings" page |
| NotificationBell — `WHERE user_email = X ORDER BY created_at DESC` | `idx_notifications_user_created` on `notifications(user_email, created_at DESC)` | Every page mount with the bell |

Before this migration, all four queries were sequential scans against
their parent tables.

## Realtime publication

Tables in the `supabase_realtime` publication (i.e. tables whose
`postgres_changes` events actually fire):

| Table | Added in | Notes |
|---|---|---|
| `messages` | Migration 051 | Powers the chat badge + Messages page realtime. |
| `trips` | Migration 057 | Was silently absent until 057 — `Trip.subscribe()` opened a channel but received no events. |
| `bookings` | Migration 057 | Same — affected 18+ subscribe call sites. |
| `notifications` | Migration 057 | Same. |

Each table also has `REPLICA IDENTITY FULL` set, so the realtime payload
includes the OLD row on UPDATE/DELETE for diff-based handlers.

## Booking concurrency

`book_seat` RPC (migrations 003 → 045 → 053 → 054) takes a
`SELECT ... FOR UPDATE` lock on the trip row before the seat-availability
check. Concurrent callers serialize on the lock; only one passenger can
acquire the last seat. The other concurrent callers wake up to find
`available_seats < p_seats` and get a clean Arabic toast.

Migration 053 closed a related double-decrement bug where the
`notify_driver_on_booking` trigger ALSO decremented seats AFTER the
RPC's own decrement. Verified working post-fix.

## Search query payload

`SearchTrips` query selects explicit columns (commit before launch),
not `SELECT *`. Cut payload by ~50% — the full `trips` row has 30+
columns including `amenities` JSONB, `recurring_days` JSONB,
`driver_note`, and others unused on the search page. Full row is still
fetched in `TripDetails` when the user clicks through.

## What's NOT been done (deferred until measured)

- **Server-side from/to filtering in SearchTrips.** Current client-side
  matching supports stop-aware routes (a Ramallah → Jenin trip with a
  Nablus stop matches a Ramallah → Nablus search) via JSONB walking +
  city-synonym tolerance. Replicating that in a single SQL query is
  complex and risks subtly changing what passengers see. The 500-row
  LIMIT + 30s staleTime + new index is sufficient for the launch
  target. Revisit if cities-per-trip grows or trip volume exceeds
  ~1000 active rows.

- **Result virtualization (`react-window`).** Unnecessary today —
  typical search returns <50 rows after filtering. Revisit if mobile
  scrolling lags at 500-row search results.

- **Read replica or materialized view for search.** Premature. Postgres
  with proper indexes handles 5000+ search queries/sec single-node.

## Action items still pending

1. **Verify Supabase tier** in dashboard before launch. Document the
   plan's channel limit here so we know our ceiling.
2. **Verify migrations 056 and 057 applied** in production. Confirm
   `idx_trips_date_status` exists via `\d trips` and the publication
   includes the four core tables.
3. **Smoke test under load.** Once 056/057 applied, hit `/search`
   simultaneously from ~50 devices. Search should feel instant; no
   degradation in trip card render time. If yes, scaling for 100s of
   concurrent users is comfortable.
