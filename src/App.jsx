import { ErrorBoundary } from '@/components/ErrorBoundary';
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

  // Not authenticated → show Login page
  if (!isAuthenticated) {
    // Allow /login route to render directly
    if (location.pathname === '/login') {
      return <Login />;
    }
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // Redirect to onboarding if not completed
  const onboardingPaths = ["/onboarding", "/dashboard"];
  const needsOnboarding = user && !user.onboarding_completed && !onboardingPaths.includes(location.pathname);
  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <Suspense fallback={<PageFallback />}><Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<SearchTrips />} />
        <Route path="/trip/:id" element={<TripDetails />} />
        <Route path="/my-trips" element={<MyTrips />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/create-trip" element={<CreateTrip />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/community" element={<Community />} />
        <Route path="/help" element={<Help />} />
        <Route path="/driver" element={<DriverDashboard />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<UserProfile />} />
        <Route path="/about" element={<AboutUs />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/safety" element={<Safety />} />
        <Route path="/settings" element={<AccountSettings />} />
        <Route path="/booking-confirmation" element={<BookingConfirmation />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />
      </Route>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes></Suspense>
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
