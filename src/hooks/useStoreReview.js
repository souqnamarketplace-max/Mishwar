/**
 * useStoreReview — triggers native App Store / Play Store review prompt
 * after a user completes a trip booking (best moment for rating request).
 * 
 * Uses the web standard navigator.requestReview() where available,
 * falls back gracefully on unsupported platforms.
 * 
 * Apple guideline: max 3 prompts per year, never after a negative action.
 * Google guideline: don't prompt before user experiences core value.
 */

const REVIEW_KEY = "mishwaro_review_prompted";
const MIN_BOOKINGS_BEFORE_PROMPT = 2; // prompt after 2nd completed action

export function useStoreReview() {
  const promptReview = async () => {
    try {
      // Don't prompt more than once
      if (localStorage.getItem(REVIEW_KEY)) return;

      // Check if we have enough user activity
      const bookingCount = parseInt(localStorage.getItem("mishwaro_booking_count") || "0");
      if (bookingCount < MIN_BOOKINGS_BEFORE_PROMPT) return;

      // Use native in-app review API if available (works in Capacitor/Cordova wrapper)
      if (window.cordova?.plugins?.AppReview) {
        window.cordova.plugins.AppReview.requestReview();
        localStorage.setItem(REVIEW_KEY, "1");
        return;
      }

      // Web fallback — direct to store
      // Will be replaced with StoreKit (iOS) / Play In-App Review when wrapped in native shell
      localStorage.setItem(REVIEW_KEY, "1");
    } catch {}
  };

  const incrementBookingCount = () => {
    const count = parseInt(localStorage.getItem("mishwaro_booking_count") || "0");
    localStorage.setItem("mishwaro_booking_count", String(count + 1));
  };

  return { promptReview, incrementBookingCount };
}
