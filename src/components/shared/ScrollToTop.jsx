import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scrolls to top whenever the route changes (excluding hash-only changes).
 * Mount once inside <BrowserRouter> in App.jsx.
 *
 * Handles BOTH window scroll and the mobile inner scroll container.
 * On mobile, MobileLayout wraps the app in `fixed inset-0` and the actual
 * scroll container is `<main data-mobile-content className="overflow-y-auto">`.
 * window.scrollY is always 0 there, so window.scrollTo is a no-op on
 * mobile — meaning route changes on mobile DON'T scroll to top, leaving
 * users at whatever inner scrollTop they had from the previous route.
 * PullToRefresh's comments document the same DOM layout. We scroll both
 * targets defensively so it works regardless of which layout is active.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Window scroll (desktop layout where this matters)
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    // Mobile inner scroll container — MobileLayout marks it with
    // data-mobile-content. If absent (desktop or before mount), the
    // querySelector returns null and we silently skip.
    const mobileScroller = document.querySelector("[data-mobile-content]");
    if (mobileScroller) mobileScroller.scrollTop = 0;
  }, [pathname]);
  return null;
}
