import { ErrorBoundary } from '@/components/ErrorBoundary';

// Per-page error fallback (smaller than full-page).
// `error` and `componentStack` are injected by ErrorBoundary via cloneElement
// when this is passed as the `fallback` prop. We surface them behind a tap-
// to-reveal toggle so mobile users (no DevTools) can still capture the real
// failure reason without us shipping a separate debug build.
const PageErrorFallback = ({ onReset, error, componentStack }) => {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8" dir="rtl">
      <div className="text-center max-w-xs">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <h3 className="font-bold text-foreground mb-2">فشل تحميل هذه الصفحة</h3>
        <p className="text-sm text-muted-foreground mb-4">يرجى المحاولة مجدداً</p>
        <div className="flex gap-3 justify-center">
          <button onClick={onReset || (() => window.location.reload())}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
            إعادة المحاولة
          </button>
          <a href="/" className="px-4 py-2 bg-muted text-foreground rounded-xl text-sm font-medium">
            الرئيسية
          </a>
        </div>
        {error && (
          <div className="mt-6">
            <button
              onClick={() => setShowDetails(s => !s)}
              className="text-xs text-muted-foreground underline">
              {showDetails ? "إخفاء التفاصيل التقنية" : "عرض التفاصيل التقنية"}
            </button>
            {showDetails && (
              <pre className="mt-2 p-3 bg-muted/40 rounded-lg text-[10px] leading-snug text-foreground/80 overflow-auto max-h-64 whitespace-pre-wrap break-all text-left" dir="ltr">
                {String(error?.message || error)}
                {error?.stack ? `\n\n${error.stack}` : ""}
                {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

import AppLayout from './components/layout/AppLayout';
import { lazy, Suspense, useState } from 'react';

import ScrollToTop from "@/components/shared/ScrollToTop";
// Code splitting — each page loads on demand
const Home             = lazy(() => import('./pages/Home'));
const SearchTrips      = lazy(() => import('./pages/SearchTrips'));
const TripDetails      = lazy(() => import('./pages/TripDetails'));
const MyTrips          = lazy(() => import('./pages/MyTrips'));
const Favorites        = lazy(() => import('./pages/Favorites'));
const Messages         = lazy(() => import('./pages/Messages'));
const CreateTrip       = lazy(() => import('./pages/CreateTrip'));
const RequestTrip      = lazy(() => import('./pages/RequestTrip'));
const MyRequests       = lazy(() => import('./pages/MyRequests'));
const PassengerRequests= lazy(() => import('./pages/PassengerRequests'));
const RequestDetails   = lazy(() => import('./pages/RequestDetails'));
const PassengerVerification = lazy(() => import('./pages/PassengerVerification'));
const HowItWorks       = lazy(() => import('./pages/HowItWorks'));
const Community        = lazy(() => import('./pages/Community'));
const Help             = lazy(() => import('./pages/Help'));
const Dashboard        = lazy(() => import('./pages/Dashboard'));
const DriverDashboard  = lazy(() => import('./pages/DriverDashboard'));
const Notifications    = lazy(() => import('./pages/Notifications'));
const UserProfile      = lazy(() => import('./pages/UserProfile'));
const Onboarding       = lazy(() => import('./pages/Onboarding'));
const BecomeDriver     = lazy(() => import('./pages/BecomeDriver'));
const AboutUs          = lazy(() => import('./pages/AboutUs'));
const Blog             = lazy(() => import('./pages/Blog'));
const Safety           = lazy(() => import('./pages/Safety'));
const AccountSettings  = lazy(() => import('./pages/AccountSettings'));
const AccountHub       = lazy(() => import('./components/account/AccountHub'));
const Login            = lazy(() => import('./pages/Login'));
const BookingConfirmation = lazy(() => import('./pages/BookingConfirmation'));
const Feedback = lazy(() => import('./pages/Feedback'));
const PrivacyPolicy    = lazy(() => import('./pages/PrivacyPolicy'));
const Terms            = lazy(() => import('./pages/Terms'));

// SEO landing pages — Arabic-keyword-targeted public routes. Lazy-loaded
// so the main bundle stays lean for users who never visit them. Each
// page renders the SeoLandingLayout shell with hand-written Arabic copy.
const RouteRamallahNablus     = lazy(() => import('./pages/seo/RouteRamallahNablus'));
const RouteJerusalemBethlehem = lazy(() => import('./pages/seo/RouteJerusalemBethlehem'));
const RouteHebronJerusalem    = lazy(() => import('./pages/seo/RouteHebronJerusalem'));
const CityRamallah            = lazy(() => import('./pages/seo/CityRamallah'));
const CityNablus              = lazy(() => import('./pages/seo/CityNablus'));

// Page-level loading fallback
const PageFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
  </div>
);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, isAuthenticated, authChecked, user } = useAuth();
  const location = useLocation();

  // Show loading spinner while checking auth
  if (isLoadingPublicSettings || isLoadingAuth || !authChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mx-auto mb-3">
            <span className="text-primary-foreground font-bold text-xl">م</span>
          </div>
          <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin mx-auto"></div>
        </div>
      </div>
    );
  }

  // Public routes — accessible without sign-in
  const PUBLIC_PATHS = new Set([
    "/", "/search", "/how-it-works", "/community", "/help", "/support", "/contact",
    "/about", "/about-us", "/blog", "/safety", "/privacy", "/privacy-policy", "/terms", "/terms-of-service",
  ]);
  // /trip/:id is also public (view-only) — handled by prefix
  const isPublicPath = PUBLIC_PATHS.has(location.pathname) || location.pathname.startsWith("/trip/");

  // Not authenticated AND trying to access a protected route → redirect to login
  if (!isAuthenticated) {
    if (location.pathname === "/login") return <Login />;
    if (!isPublicPath) {
      return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
    }
    // else fall through to render the public page
  }

  // Redirect to onboarding if logged-in user hasn't completed it
  // Paths a partially-onboarded user can visit without being redirected to onboarding.
  // Public browsing pages are allowed so the "الرئيسية" button on onboarding step 0 works.
  const onboardingExempt = new Set([
    "/onboarding", "/dashboard",
    "/", "/search", "/how-it-works", "/community", "/help", "/login",
  ]);
  const needsOnboarding = (
    isAuthenticated &&
    user &&
    !user.onboarding_completed &&
    !onboardingExempt.has(location.pathname) &&
    !location.pathname.startsWith("/trip/")
  );
  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <ErrorBoundary fallback={<PageErrorFallback />}><Suspense fallback={<PageFallback />}><Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<AppLayout />}>
        {/* PUBLIC pages — viewable without sign-in */}
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<SearchTrips />} />
        <Route path="/trip/:id" element={<TripDetails />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/community" element={<Community />} />
        <Route path="/help" element={<Help />} />
        {/* Aliases for /help — App Store + Play Store reviewers expect
            "support"; some users land via "contact". Same Help page,
            different entry points. Mirrors the /privacy + /privacy-policy
            dual-route pattern. */}
        <Route path="/support" element={<Help />} />
        <Route path="/contact" element={<Help />} />
        <Route path="/about" element={<AboutUs />} />
        <Route path="/about-us" element={<AboutUs />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/safety" element={<Safety />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/terms-of-service" element={<Terms />} />

        {/* SEO landing pages — public, Arabic-keyword-targeted. Built to
            rank on queries like "رحلات رام الله نابلس" / "مشاوير القدس".
            Each page is a hand-written Arabic article + FAQ + CTAs into
            /search and /request-trip. */}
        <Route path="/routes/ramallah-nablus"     element={<RouteRamallahNablus />} />
        <Route path="/routes/jerusalem-bethlehem" element={<RouteJerusalemBethlehem />} />
        <Route path="/routes/hebron-jerusalem"    element={<RouteHebronJerusalem />} />
        <Route path="/cities/ramallah"            element={<CityRamallah />} />
        <Route path="/cities/nablus"              element={<CityNablus />} />

        {/* PROTECTED pages — require sign-in */}
        <Route path="/my-trips" element={<MyTrips />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/create-trip" element={<CreateTrip />} />
        <Route path="/request-trip" element={<RequestTrip />} />
        <Route path="/my-requests" element={<MyRequests />} />
        <Route path="/passenger-requests" element={<PassengerRequests />} />
        <Route path="/passenger-requests/:id" element={<RequestDetails />} />
        <Route path="/verify-passenger" element={<PassengerVerification />} />
        <Route path="/driver" element={<DriverDashboard />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<UserProfile />} />
        <Route path="/settings" element={<AccountHub />} />
        <Route path="/booking-confirmation" element={<BookingConfirmation />} />
        <Route path="/account-settings" element={<AccountHub />} />
        <Route path="/account-settings/profile" element={<AccountSettings />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/become-driver" element={<BecomeDriver />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes></Suspense></ErrorBoundary>
  );
};

function App() {
  return (
    <HelmetProvider>
      <ErrorBoundary><AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
            <Routes>
              {/* Public login route — always accessible */}
              <Route path="/login" element={<Login />} />
              {/* All other routes go through auth check */}
              <Route path="/*" element={<AuthenticatedApp />} />
            </Routes>
          </Router>
          <Toaster />
          <SonnerToaster position="top-center" richColors />
        </QueryClientProvider>
      </AuthProvider></ErrorBoundary>
    </HelmetProvider>
  )
}

export default App
