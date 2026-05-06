# Operations runbook — مِشوار

Audit findings closed by following this runbook: M-08 (backups), M-09 (alerting), and
the incident-response side of M-10 (rate limiting).

## Backups & disaster recovery (M-08)

### Current state
- **Database:** Supabase manages PITR (point-in-time recovery) automatically. Retention
  depends on plan:
  - Free: daily backup, 7-day retention
  - Pro: daily backup + PITR (any point in last 7 days)
  - Team/Enterprise: longer retention, longer PITR window
- **Files (Storage):** Supabase Storage replicates underneath but does not give you a
  point-in-time view. Files are durable but if a buggy script deletes them, recovery
  is harder than for the DB.
- **Code:** GitHub is the source of truth. Vercel deploys from main automatically.

### Required actions before launch
1. **Confirm Supabase plan supports your RPO target.** For an app handling money &
   bookings, Pro tier minimum (PITR + daily backups). Free tier is acceptable only
   for closed beta.
2. **Take a manual backup before every migration.** Supabase Dashboard → Database →
   Backups → "Create backup now". This gives you a known-good restore point if a
   migration goes wrong.
3. **Test restore at least once.** Spin up a fresh Supabase project, restore the
   most recent backup into it, run smoke tests. Schedule this quarterly.
4. **Document your restore procedure.** Create `RESTORE.md` with step-by-step
   instructions a non-expert could follow. Include: where backups live, how to
   download, how to point the app at a restored DB, who to call if it goes wrong.

### Disaster scenarios
| Scenario | Recovery approach |
|---|---|
| Bad migration corrupts data | PITR to just before migration ran |
| Vercel outage | Wait it out (no failover today). Future: deploy mirror on Cloudflare Pages or Netlify |
| Supabase outage | App is down for the duration. No real-time alternative. |
| Storage data loss | Restore from Supabase Storage backups. Public files (avatars, car photos) are non-critical; license files are critical and should be backed up to a separate bucket nightly via cron once volume justifies |
| Compromised admin account | Run the SQL in `migrations/002` against the compromised UUID to revoke admin role. Audit `admin_audit_log` for damage. Rotate Supabase JWT secret. |
| Compromised anon key | Rotate via Supabase Dashboard → Settings → API → Reset anon key. Update `VITE_SUPABASE_ANON_KEY` in Vercel env. Redeploy. Old key becomes invalid within seconds. |

---

## Monitoring & alerting (M-09)

### What to monitor
| Signal | Threshold | Tool |
|---|---|---|
| Production HTTP 5xx rate | > 1% over 5 min | Vercel logs + Sentry once wired |
| `/api/trip` latency p95 | > 2s | Vercel Analytics (Pro) |
| Supabase project quota | > 80% used | Supabase Dashboard alerts |
| Supabase Auth failure rate | spike vs 7-day avg | Supabase logs (manual today) |
| Daily active users | drop > 30% week-over-week | Vercel Analytics or Plausible |
| Build failures on main | any | GitHub Actions email (already on) |
| Booking RPC error rate | > 1% | Sentry breadcrumbs once wired |
| Storage growth rate | sudden spike | Supabase Dashboard manual review |

### Setup steps
1. **Vercel Notifications.** Settings → Notifications → enable email on:
   - Deployment fails
   - First deployment after PR
2. **Supabase quota alerts.** Dashboard → Reports → set quota alert at 80% on:
   - Database size
   - Egress bandwidth
   - Auth users
3. **Uptime monitoring.** Free tier of UptimeRobot or Better Stack:
   - GET https://mishwar-nu.vercel.app/ every 5 min, alert on 2 consecutive failures
   - GET https://mishwar-nu.vercel.app/api/trip?id=00000000-0000-0000-0000-000000000000
     every 5 min — should return 200 even for invalid id
   - Alert via email + Telegram/SMS for after-hours
4. **Once Sentry is wired (H-03):** alert on:
   - new error type (1+ event in 24h after never-seen)
   - error rate spike (>2x rolling 24h average)
5. **Sentry digest:** weekly summary email so issues don't get lost

### Where alerts should go
- **Pre-launch:** all alerts to operator email (`souqnamarketplace@gmail.com`)
- **Post-launch with team:** to a shared Telegram or Slack channel
- **For critical alerts (5xx storm, all-down):** consider SMS via UptimeRobot's
  free tier offers 2 SMS/month; upgrade if needed

### Logs you'll need during an incident
| Log | Where | Retention |
|---|---|---|
| Vercel function logs | Vercel Dashboard → Logs | 7 days (Free) / 30 days (Pro) |
| Supabase Postgres logs | Dashboard → Database → Logs | 24 hours (Free) / 7 days (Pro) |
| Supabase Auth logs | Dashboard → Auth → Logs | 24 hours / 7 days |
| Browser errors (frontend) | Sentry once wired | 30 days (Sentry free) |
| RLS denial events | Postgres logs filtered for `42501` | same as Postgres logs |

---

## Incident response

When something breaks in production, work this checklist:

### 1. Triage (first 5 minutes)
- Visit https://mishwar-nu.vercel.app/ in incognito — does it load?
- Check Vercel Dashboard → Deployments → most recent deploy: green or rolled?
- Check Supabase Dashboard → Health: project running, no notices?

### 2. Containment (next 10 minutes)
- If a recent deploy correlates: **roll back** via Vercel Dashboard → Deployments →
  previous green build → "Promote to Production"
- If a recent migration correlates: identify which one, plan rollback (most are
  idempotent and safe to re-run; some require explicit rollback SQL)
- If credential / role issue: rotate the affected secret, revoke the compromised
  account

### 3. Communication
- Post status to a public page (consider statuspage.io free tier later)
- For pre-launch, just message active testers directly
- Telegram/Twitter post if it's user-impacting and lasted > 30 min

### 4. Post-mortem
- Within 48h, write a short doc covering:
  - Timeline (UTC)
  - Root cause
  - What we knew when
  - What we did
  - What we'll change to prevent recurrence
- Add the prevention to this runbook or to a CI check

### Common quick fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| All Supabase calls 401 | Anon key rotated, Vercel env stale | Update `VITE_SUPABASE_ANON_KEY` in Vercel, redeploy |
| All bookings fail with PGRST202 | book_seat RPC was dropped | Re-run migration 003 |
| Mass-spam notifications appear | C-07 fix not applied | Re-run migration 002 §5 |
| Real-time messages not delivering | Publication missing tables | `ALTER PUBLICATION supabase_realtime ADD TABLE messages, notifications;` |
| 429 from /api/trip on real users | Rate limit too tight, or bot traffic | Bump max in api/trip.js, or block at Vercel firewall |
| Sentry not capturing | DSN not set / package not installed | npm i @sentry/react + set VITE_SENTRY_DSN + redeploy |

---

## Pre-deploy checklist

Before every production deploy from main:

- [ ] CI green on the commit being deployed
- [ ] No raw credentials in the diff (`git diff origin/main..HEAD | grep -i "sb_publishable\|sb_secret"`)
- [ ] If migration files changed, review and apply to Supabase BEFORE Vercel deploys the
      code that depends on them (Vercel auto-deploys; this means: apply SQL first, then
      `git push` the code; if you push code first, the new code gracefully falls through
      to legacy paths, but try to avoid relying on that)
- [ ] Spot-check the `/dashboard` route loads as admin
- [ ] Spot-check booking flow as a regular user

For migrations specifically:

- [ ] Backup taken (Supabase Dashboard or `pg_dump`)
- [ ] Migration is idempotent (re-running shouldn't break anything)
- [ ] Migration has a verification block at the bottom that prints PASS/FAIL
- [ ] If migration alters policy, run the C-01-style exploit confirm afterward

---

## Tools, accounts, secrets

| Service | Purpose | Account | Notes |
|---|---|---|---|
| Vercel | Deployment, OG functions | souqnamarketplace@gmail.com | Free / Hobby |
| Supabase | DB, Auth, Storage, Realtime | souqnamarketplace@gmail.com | Verify plan supports PITR |
| GitHub | Source, CI, Dependabot | souqnamarketplace-max | Repo private |
| Sentry | Error tracking | TBD | Pending H-03 |
| Twilio | SMS OTP | TBD | Pending H-07 |
| UptimeRobot or BetterStack | Uptime monitoring | TBD | Sign up before launch |
| MapTiler | Map tiles | TBD | Free tier 100k requests/mo |
| OpenStreetMap (Nominatim, Valhalla) | Geocoding, routing | n/a (public) | Rate-limited; consider hosted alternative once volume picks up |

### Secret inventory
Document somewhere that's NOT in the repo:
- Supabase anon key (public, in Vercel env)
- Supabase service-role key (NEVER expose; only used in admin scripts)
- GitHub PAT (rotate quarterly)
- Sentry DSN (when wired)
- Twilio credentials (when wired)
- MapTiler key (currently in code somewhere — audit and move to env)

---

## Related docs

- [`/docs/PRE-LAUNCH.md`](PRE-LAUNCH.md) — audit-finding tracker (status of every C/H/M/L)
- [`/docs/audits/2026-05-05-pre-launch-audit.md`](audits/2026-05-05-pre-launch-audit.md) — full audit
- [`/migrations/`](../migrations) — all SQL migrations, numbered and ordered
- [`/DEPLOY.md`](../DEPLOY.md) — production deployment instructions
- [`/WAKEUP.md`](../WAKEUP.md) — overnight remediation summary
