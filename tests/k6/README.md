# Mishwaro — k6 Load Tests

Performance and load tests for the Mishwaro carpooling platform.

## Install k6

```bash
# Mac (Homebrew)
brew install k6

# Verify
k6 version
```

## Test files

| File | Purpose | When to run |
|------|---------|-------------|
| `00_smoke.js` | Sanity check — 1 user, 30s | Before every production deploy |
| `01_public_pages.js` | All public Vercel CDN pages | After major frontend changes |
| `02_api_supabase.js` | Supabase REST API endpoints | After DB migrations |
| `03_trip_search.js` | Trip search flow | After RLS or index changes |
| `04_user_journey.js` | Full anonymous user journey | Pre-launch stress test |

## Run commands

```bash
cd /Users/katykate/Desktop/projects/Mishwaro

# Smoke test (always run this first)
k6 run tests/k6/00_smoke.js

# Public pages load test
k6 run tests/k6/01_public_pages.js

# Supabase API test
k6 run tests/k6/02_api_supabase.js

# Trip search
k6 run tests/k6/03_trip_search.js

# Full user journey (stress test)
k6 run tests/k6/04_user_journey.js
```

## Override targets

```bash
# Test against local dev
k6 run -e BASE_URL=http://localhost:5173 tests/k6/00_smoke.js

# Test against staging preview
k6 run -e BASE_URL=https://mishwar-git-dev-team.vercel.app tests/k6/00_smoke.js

# Custom VUs and duration
k6 run --vus 20 --duration 2m tests/k6/02_api_supabase.js

# Custom stages
k6 run --stage 30s:10,1m:50,30s:0 tests/k6/04_user_journey.js
```

## Output with HTML report

```bash
# Install k6 reporter
brew install k6

# Run with JSON output then view
k6 run --out json=results.json tests/k6/04_user_journey.js
```

## Understanding results

Key metrics to watch:

| Metric | What it means | Target |
|--------|--------------|--------|
| `http_req_duration p(95)` | 95% of requests complete in this time | <800ms for DB, <300ms for static |
| `http_req_failed rate` | % of requests that errored | <1% |
| `checks rate` | % of assertions that passed | >99% |
| `http_reqs/s` | Requests per second throughput | Informational |
| `vus_max` | Peak concurrent users during test | Should match target VUs |

## Load profiles defined in config.js

- **SMOKE** — 1 VU, 30s. Just verify it works.
- **LOAD** — Ramp to 10 VUs, hold 1min, ramp down. Normal daily traffic.
- **STRESS** — Ramp to 50-100 VUs. Friday evening peak when everyone is traveling.
- **SOAK** — 10 VUs for 10 minutes. Catches memory leaks and DB connection exhaustion.
