import { ErrorBoundary } from '@/components/ErrorBoundary';

// Per-page error fallback (smaller than full-page)
const PageErrorFallback = ({ onReset }) => (
  <div className="min-h-[60vh] flex items-center justify-center p-8" dir="rtl">
    <div className="text-center max-w-xs">
      <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h3 className="font-bold text-foreground mb-2">فشل تحميل هذه الصفحة</h3>
      <p className="text-sm text-muted-foreground mb-4">يرجى المحاولة مجدداً</p>
      <button onClick={onReset || (() => window.location.reload())}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
        إعادة المحاولة
      </button>
    </div>
  </div>
);
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

import AppLayout from './components/layout/AppLayout';
import { lazy, Suspense } from 'react';

// Code splitting — each page loads on demand
const Home             = lazy(() => import('./pages/Home'));
const SearchTrips      = lazy(() => import('./pages/SearchTrips'));
const TripDetails      = lazy(() => import('./pages/TripDetails'));
const MyTrips          = lazy(() => import('./pages/MyTrips'));
const Favorites        = lazy(() => import('./pages/Favorites'));
const Messages         = lazy(() => import('./pages/Messages'));
const CreateTrip       = lazy(() => import('./pages/CreateTrip'));
const HowItWorks       = lazy(() => import('./pages/HowItWorks'));
const Community        = lazy(() => import('./pages/Community'));
const Help             = lazy(() => import('./pages/Help'));
const Dashboard        = lazy(() => import('./pages/Dashboard'));
const DriverDashboard  = lazy(() => import('./pages/DriverDashboard'));
const Notifications    = lazy(() => import('./pages/Notifications'));
const UserProfile      = lazy(() => import('./pages/UserProfile'));
const Onboarding       = lazy(() => import('./pages/Onboarding'));
const AboutUs          = lazy(() => import('./pages/AboutUs'));
const Blog             = lazy(() => import('./pages/Blog'));
const Safety           = lazy(() => import('./pages/Safety'));
const AccountSettings  = lazy(() => import('./pages/AccountSettings'));
const Login            = lazy(() => import('./pages/Login'));
const BookingConfirmation = lazy(() => import('./pages/BookingConfirmation'));
const Feedback = lazy(() => import('./pages/Feedback'));
const PrivacyPolicy    = lazy(() => import('./pages/PrivacyPolicy'));
const Terms            = lazy(() => import('./pages/Terms'));

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
    "/", "/search", "/how-it-works", "/community", "/help",
    "/about", "/blog", "/safety", "/privacy", "/terms",
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
        <Route path="/about" element={<AboutUs />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/safety" element={<Safety />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />

        {/* PROTECTED pages — require sign-in */}
        <Route path="/my-trips" element={<MyTrips />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/create-trip" element={<CreateTrip />} />
        <Route path="/driver" element={<DriverDashboard />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<UserProfile />} />
        <Route path="/settings" element={<AccountSettings />} />
        <Route path="/booking-confirmation" element={<BookingConfirmation />} />
      </Route>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes></Suspense></ErrorBoundary>
  );
};

function App() {
  return (
    <ErrorBoundary><AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
  )
}

export default App
