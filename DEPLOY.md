# Deployment Playbook — مِشوار on Vercel

## 1. Push to GitHub

Open Terminal in your project folder:
```bash
cd ~/Downloads/Mishwar

# Verify .env will NOT be committed
cat .gitignore | grep ".env"

# Commit + push
git add .
git status                           # review what's about to be committed
git commit -m "Production-ready: passenger/driver flows, public routes, seed data, bug fixes"
git push origin main                 # or 'master' depending on your branch
```

If `git push` complains about diverged branches:
```bash
git pull --rebase origin main
git push origin main
```

## 2. Vercel Auto-Deploys

Since you already imported the repo, Vercel will auto-build on push. Watch the build at:
https://vercel.com/your-username/mishwar/deployments

## 3. Set Environment Variables (CRITICAL — first deploy will fail without these)

Go to: **Vercel → Project → Settings → Environment Variables**

Add these 2 variables (apply to **Production**, **Preview**, and **Development**):

```
VITE_SUPABASE_URL       = https://dimtdwahtwaslmnuakij.supabase.co
VITE_SUPABASE_ANON_KEY  = sb_publishable_LlK5ig0ruElVt3Z6j0FNkQ_MAGvKRC_
```

Optional (only if you set up Sentry later):
```
VITE_SENTRY_DSN         = (leave blank for now)
VITE_DEBUG_SENTRY       = (leave blank)
VITE_APP_VERSION        = 1.0.0
```

After adding env vars, click **Deployments → ⋮ on latest → Redeploy** to apply.

## 4. Update Supabase Auth Settings

The OAuth redirect URLs must include your Vercel domain:

1. Open **Supabase Dashboard → Authentication → URL Configuration**
2. Add to **Site URL**:
   ```
   https://your-app.vercel.app
   ```
3. Add to **Redirect URLs** (all of these):
   ```
   https://your-app.vercel.app/**
   https://your-app.vercel.app/login
   https://your-app.vercel.app/onboarding
   ```

If you have a custom domain, add it too.

## 5. Build Config (already in vercel.json — no action needed)

Vercel auto-detects Vite. The included `vercel.json` handles:
- ✅ SPA routing (all routes → index.html)
- ✅ Security headers (X-Frame-Options, HSTS, etc.)

Build settings in Vercel UI should be:
- Framework Preset: **Vite**
- Build Command: `npm run build` (default)
- Output Directory: `dist` (default)
- Install Command: `npm install` (default)

## 6. Post-Deploy Verification

1. Visit https://your-app.vercel.app — Home should load **without sign-in**
2. Click "ابحث عن رحلة" — should show trips from seeded DB
3. Click a trip card → should show details (no booking yet, redirects to login)
4. Sign in as engallam27@gmail.com — should land on home with profile loaded
5. Visit /my-trips — should show 4 bookings
6. Visit /messages — should show conversation with souqnamarketplace

## 7. Common Issues

**"Failed to fetch" on first load**
→ Check Vercel deployment logs for build errors
→ Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in env vars

**Auth redirects to localhost**
→ Step 4 — add your Vercel URL to Supabase redirect URLs

**Blank page after deploy**
→ Open browser DevTools → Console for the actual error
→ 99% of the time it's a missing env var

**"Element type is invalid" or routes 404**
→ vercel.json rewrites should handle this, but verify it deployed:
   https://your-app.vercel.app/some-random-route should NOT 404

**Old code still showing after push**
→ Vercel caches aggressively. Hard refresh (Cmd+Shift+R) or
   click "Redeploy" without "Use existing build cache" in Vercel
