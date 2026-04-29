# مِشوار — Palestinian Rideshare Platform

A React + Supabase rideshare app for Palestine, with Arabic RTL UI.

## Quick Start

```bash
npm install
npm run dev   # → http://localhost:5173
npm run build # → production build in dist/
```

## Setup (one-time)

1. **Database**: Run `supabase-production.sql` in Supabase SQL Editor
2. **Admin user**:
   ```sql
   INSERT INTO public.profiles (id, email, full_name, role, onboarding_completed, is_active)
   SELECT id, email, 'مدير النظام', 'admin', true, true
   FROM auth.users WHERE email = 'YOUR_ADMIN_EMAIL'
   ON CONFLICT (id) DO UPDATE SET role = 'admin', onboarding_completed = true;
   ```
3. **Storage bucket**: Already created by `supabase-production.sql`
4. **Environment**: copy `.env.example` to `.env` and fill in values

## Project Structure

```
src/
├── api/              # Supabase API wrappers (base44Client.js)
├── components/
│   ├── home/         # Landing page sections
│   ├── layout/       # Navbar, Footer, MobileLayout
│   ├── shared/       # Reusable: TripCard, MapCityPicker, EmptyState
│   ├── dashboard/    # Admin dashboard widgets
│   └── ui/           # Radix UI primitives
├── hooks/            # useSEO, usePaginatedData
├── lib/              # supabase, AuthContext, validation, sentry, adminAudit
├── pages/            # All route pages (lazy loaded)
└── App.jsx           # Router + auth gate
```

## Production Checklist

- [ ] Set real `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- [ ] Set `VITE_SENTRY_DSN` for error tracking
- [ ] Replace placeholders in `index.html`: GA_MEASUREMENT_ID, PIXEL_ID
- [ ] Update WhatsApp number in `Footer.jsx` (currently `0599-000-000`)
- [ ] Update social URLs in `Footer.jsx` (Facebook, Instagram, Twitter)
- [ ] Update support emails in `Help.jsx` and `PrivacyPolicy.jsx`
- [ ] Add real `/public/og-image.png` (1200×630)
- [ ] Verify domain & update `sitemap.xml` URLs
- [ ] Run `npm install` after package.json changes (removed unused deps)

## Database Schema

12 tables: profiles, trips, bookings, reviews, messages, notifications, driver_licenses, coupons, app_settings, announcements, support_tickets, trip_preferences. Plus admin_audit_log + login_attempts.

50+ RLS policies. 9 triggers. 3 RPCs (delete_user_account, broadcast_notification, cancel_booking). All in `supabase-production.sql`.

## Auth Flow

`AuthContext.jsx` reads session from `localStorage` directly (instant), bypassing slow `supabase.auth.getSession()` network calls. Token refresh happens in background via `onAuthStateChange`.

## Deployment

- Vercel: `vercel.json` is pre-configured with security headers
- Netlify: `_headers` is pre-configured
- Both: SPA rewrites in place

