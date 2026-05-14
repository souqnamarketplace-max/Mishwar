/**
 * useOnboardingGate — client-side guard that blocks write actions for
 * users who haven't finished onboarding, and redirects them to the
 * onboarding page with a returnTo so they land back on the original
 * page when they're done.
 *
 * WHY THIS EXISTS
 * Migration 034 added the server-side onboarding precheck on book_seat
 * and the RLS-level guards on trips, messages, and trip_requests. The
 * server is now the security boundary — a non-onboarded user calling
 * book_seat directly gets a 42501 RAISE EXCEPTION. But seeing that as
 * "profile incomplete — finish onboarding before booking" in a red
 * toast is a poor first impression for a brand-new Google signup who
 * just tapped "Book". Better UX: detect the gap BEFORE the RPC fires,
 * explain what's happening in friendly Arabic, and walk the user to
 * the onboarding page so they can finish in one go.
 *
 * The hook returns a single function: requireOnboarding(returnTo).
 * Call it as the first line of any write handler. If it returns false,
 * the caller should bail out (the hook has already taken over the
 * UX — toast + navigate). If it returns true, the user is onboarded
 * and the caller can proceed with its mutation.
 *
 * USAGE
 *   const requireOnboarding = useOnboardingGate();
 *
 *   const handleBook = () => {
 *     if (!requireOnboarding(`/trip/${trip.id}`)) return;
 *     bookMutation.mutate(trip);
 *   };
 *
 * The returnTo argument tells /onboarding where to send the user when
 * they finish. The onboarding page reads ?returnTo=... and navigates
 * there after a successful save; if the param is omitted it falls back
 * to "/" (home). Always pass an explicit returnTo for non-home actions
 * so the user lands back where they were trying to do something.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";

export function useOnboardingGate() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  return useCallback(
    (returnTo) => {
      // Unauthenticated users → /login. This case shouldn't normally
      // hit the gate because most write surfaces are behind a login
      // check already, but a paranoid caller is a happy caller.
      if (!isAuthenticated) {
        toast.error("سجل الدخول أولاً");
        navigate(`/login?returnTo=${encodeURIComponent(returnTo || "/")}`);
        return false;
      }

      // The auth context's user object can be momentarily undefined
      // between login and the first /me fetch. Don't block actions on
      // that race; allow them and let the server check do its job. The
      // race window is short (<1s) and the server will reject if the
      // user is actually not onboarded.
      if (!user) return true;

      if (user.onboarding_completed === true) return true;

      // Final gate — not onboarded. Toast + redirect.
      toast.error("أكمل ملفك الشخصي أولاً لإتمام هذا الإجراء", {
        description: "نحتاج رقم هاتفك وبعض المعلومات الأساسية قبل البدء.",
      });
      navigate(`/onboarding?returnTo=${encodeURIComponent(returnTo || "/")}`);
      return false;
    },
    [isAuthenticated, user, navigate]
  );
}

export default useOnboardingGate;
