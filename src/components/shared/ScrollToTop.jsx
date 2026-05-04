import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scrolls to top whenever the route changes (excluding hash-only changes).
 * Mount once inside <BrowserRouter> in App.jsx.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}
