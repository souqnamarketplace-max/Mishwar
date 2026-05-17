import React, { createContext, useState, useContext, useEffect } from 'react';
import { toast } from "sonner";
import { captureException, setSentryUser, clearSentryUser } from "@/lib/sentry";
import { supabase } from '@/lib/supabase';
import { queryClientInstance } from '@/lib/query-client';
import { invalidateBlockCache } from "@/lib/blockUtils";
import { api } from '@/api/apiClient';
import { readLocalSession, readSessionToken } from "@/lib/session";
import { registerNativePush, unregisterNativePush } from "@/lib/pushNotifications";

// Historical alias — the context referenced the function under this name.
// Both old and new names resolve to the same helper so any in-flight
// changes don't conflict.
const readSessionFromStorage = readLocalSession;

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  // ─── Password recovery flag ─────────────────────────────────────────
  // True when the user landed here via a "Reset Password" email link.
  // Two ways this gets set:
  //   1. Lazy initializer below — checks the URL hash for type=recovery
  //      synchronously on first render, BEFORE any other useEffect
  //      runs. This is the fast path for the implicit-flow recovery
  //      URL format (#access_token=...&type=recovery&...).
  //   2. PASSWORD_RECOVERY event in onAuthStateChange — Supabase fires
  //      this after processing the URL. This is the canonical signal,
  //      and it covers BOTH implicit AND PKCE flows (?code=...).
  //
  // The lazy initializer is the critical fix: previously this state
  // was set inside a useEffect, which runs AFTER the auth-redirect
  // useEffect on Login.jsx, so the redirect-home code fired BEFORE
  // recoveryMode flipped to true → user landed on home, not on the
  // password-set form.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => {
    if (typeof window === 'undefined') return false;
    // Implicit flow: #access_token=...&type=recovery
    if (window.location.hash.includes('type=recovery')) return true;
    // PKCE flow: we can't tell from ?code= alone whether this is
    // recovery vs normal sign-in — the PASSWORD_RECOVERY event below
    // will catch it after Supabase exchanges the code.
    return false;
  });

  useEffect(() => {
    // Hard safeguard: never let auth loading hang for more than 8 seconds
    const failsafe = setTimeout(() => {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }, 8000);

    // Check current session on mount
    checkUserAuth().finally(() => clearTimeout(failsafe));

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        // Tag Sentry events with user.id (NOT email — PII protection).
        // Helps cluster errors by user without leaking PII.
        setSentryUser(session.user.id);
        await loadUserProfile(session.user);
      } else if (event === 'SIGNED_OUT') {
        clearSentryUser();
        setUser(null);
        // Mirror the setQueryData(["me"], fullUser) call from
        // loadUserProfile — without this, components consuming the
        // ["me"] query directly via useQuery (AppLayout → MobileLayout,
        // Navbar) retain the stale user object after SIGNED_OUT events
        // that don't go through api.auth.logout()'s hard reload:
        //   - server-side session expiry / refresh token revoked
        //   - another tab signing out
        //   - any programmatic supabase.auth.signOut() that skips the
        //     window.location.href = '/login' redirect
        // In those scenarios the user prop into MobileLayout stayed
        // truthy and the React tree kept rendering the authenticated
        // UI. Setting null here makes the query consumers immediately
        // reflect the logged-out state.
        try { queryClientInstance.setQueryData(["me"], null); } catch {}
        invalidateBlockCache();
        setIsAuthenticated(false);
        setAuthError(null);
        // Always clear recovery flag on signout — covers the cancel-
        // recovery flow + general defense in case state got stuck.
        setIsPasswordRecovery(false);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Silently refresh user data
        setSentryUser(session.user.id);
        await loadUserProfile(session.user);
      } else if (event === 'PASSWORD_RECOVERY') {
        // Canonical recovery signal from supabase-js. Fires once
        // detectSessionInUrl has parsed the URL fragments AND determined
        // the session is a recovery one. Works for both implicit flow
        // (hash-based URLs) and PKCE flow (query-based URLs after code
        // exchange). We deliberately do NOT call loadUserProfile here
        // because we don't want isAuthenticated=true while in recovery —
        // the user is in a constrained state where the only allowed
        // action is updateUser({password}), and surfacing them as
        // "logged in" would let them navigate around in a broken state.
        setIsPasswordRecovery(true);
      } else if (event === 'USER_UPDATED' && session?.user) {
        // Fired after supabase.auth.updateUser({password}) succeeds at
        // the end of the recovery flow. Now that the password change
        // landed, transition the user into a normal authenticated state
        // and clear the recovery flag — they can navigate freely from
        // here. Without this branch, isAuthenticated would lag (stuck
        // false from the recovery state) until the next page reload.
        setSentryUser(session.user.id);
        await loadUserProfile(session.user);
        setIsPasswordRecovery(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Native push registration. When the user transitions to authenticated,
  // ask iOS/Android for permission (if not already granted) and upsert
  // the device's FCM/APNS token into device_tokens. The effect re-runs
  // whenever isAuthenticated changes, so:
  //   - Login (false → true): registerNativePush() fires; if granted,
  //     token gets upserted. Idempotent — if already registered, the
  //     RPC just bumps last_seen_at.
  //   - Logout (handled in logout() below, not here, so the unregister
  //     completes BEFORE supabase.auth.signOut() invalidates the JWT
  //     the RPC needs).
  // No-op on web (Capacitor.isNativePlatform() is false → early return).
  useEffect(() => {
    if (isAuthenticated) {
      registerNativePush().catch(() => {
        // Errors are captured to Sentry inside registerNativePush.
        // Swallow here so a push registration failure doesn't crash
        // the auth flow.
      });
    }
  }, [isAuthenticated]);

  const loadUserProfile = async (authUser) => {
    try {
      // Direct REST fetch — supabase-js client hangs silently after token refresh
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
      // readSessionToken returns null if the token is expired / missing /
      // unparseable — we fall back to ANON_KEY so RLS handles authz.
      const userToken = readSessionToken() || ANON_KEY;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let profile = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(authUser.id)}&limit=1`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${userToken}` },
          signal: ctrl.signal,
        });
        if (r.ok) {
          const rows = await r.json();
          profile = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          // ─── Deleted account guard ───
          // If profile.deleted_at is set, this account was soft-deleted.
          // Sign the user out immediately and prevent re-entry.
          if (profile?.deleted_at) {
            await supabase.auth.signOut();
            setUser(null);
            setTimeout(() => {
              toast.error("هذا الحساب تم حذفه. للاسترداد، تواصل مع الدعم.");
            }, 100);
            return;
          }
        }
      } finally {
        clearTimeout(timer);
      }

      // Fetch payment info via the SECURITY DEFINER RPC. After migration 006
      // these columns are no longer SELECTable directly from `profiles` —
      // the RPC bypasses that. If the RPC isn't deployed yet, payment is
      // null and the existing UI behaves as before.
      let payment = null;
      try {
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 4000);
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_payment_info`, {
            method: 'POST',
            headers: {
              apikey: ANON_KEY,
              Authorization: `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
            body: '{}',
            signal: ctrl2.signal,
          });
          if (r.ok) {
            const rows = await r.json();
            payment = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          }
        } finally {
          clearTimeout(timer2);
        }
      } catch {
        // RPC not deployed / transient error — leave payment null
      }

      const fullUser = {
        id: authUser.id,
        email: authUser.email,
        full_name: profile?.full_name ?? authUser.user_metadata?.full_name ?? authUser.email?.split('@')[0] ?? '',
        avatar_url: profile?.avatar_url ?? null,
        role: profile?.role ?? 'user',
        account_type: profile?.account_type ?? 'passenger',
        phone: profile?.phone ?? null,
        gender: profile?.gender ?? null,
        bio: profile?.bio ?? null,
        car_model: profile?.car_model ?? null,
        car_year: profile?.car_year ?? null,
        car_color: profile?.car_color ?? null,
        car_plate: profile?.car_plate ?? null,
        car_image: profile?.car_image ?? null,
        driver_note: profile?.driver_note ?? null,
        onboarding_completed: profile?.onboarding_completed ?? false,
        verification_pending: profile?.verification_pending ?? false,
        total_rating: profile?.total_rating ?? 0,
        total_reviews: profile?.total_reviews ?? 0,
        is_active: profile?.is_active ?? true,
        created_at: profile?.created_at ?? authUser.created_at,
        // ── Trip preferences (denormalized) ──
        pref_smoking:    profile?.pref_smoking    ?? null,
        pref_chattiness: profile?.pref_chattiness ?? null,
        pref_pets:       profile?.pref_pets       ?? null,
        vehicle_luggage: profile?.vehicle_luggage ?? null,
        vehicle_back_row: profile?.vehicle_back_row ?? null,
        // ── Payment fields (via get_my_payment_info RPC, owner-only) ──
        bank_name:           payment?.bank_name           ?? null,
        bank_account_name:   payment?.bank_account_name   ?? null,
        bank_account_number: payment?.bank_account_number ?? null,
        bank_iban:           payment?.bank_iban           ?? null,
        jawwal_pay_number:   payment?.jawwal_pay_number   ?? null,
        reflect_number:      payment?.reflect_number      ?? null,
        card_holder_name:    payment?.card_holder_name    ?? null,
        card_last_four:      payment?.card_last_four      ?? null,
        preferred_payment:   payment?.preferred_payment   ?? null,
      };
      setUser(fullUser);
      try { queryClientInstance.setQueryData(["me"], fullUser); } catch {}
      setIsAuthenticated(true);
      setAuthError(null);

      // ─── Native push registration ───
      // Fire-and-forget. Idempotent — safe to call on every auth state
      // transition (sign-in, token refresh, app boot with existing
      // session). On native iOS / Android this:
      //   1. Asks the OS for push permission (only once — iOS won't
      //      re-prompt after the first answer)
      //   2. Calls Push.register() which triggers APNS registration
      //      and adds the "Notifications" row to Settings → Mishwaro
      //   3. Receives the FCM token via the 'registration' listener
      //   4. Upserts the token into device_tokens via RPC
      // On web this is a no-op (Capacitor.isNativePlatform() = false).
      //
      // We deliberately don't await this — push registration shouldn't
      // gate the rest of the auth flow. If APNS is slow or unreachable
      // (e.g. behind a corporate proxy), the user still gets in and
      // realtime notifications still work; only the lock-screen banners
      // are deferred until the token resolves.
      //
      // Errors are captured inside registerNativePush via captureException
      // so we don't need a try/catch here.
      registerNativePush();
    } catch (err) {
      captureException(err, { msg: 'Profile load error:' });
      // Even on error, set the user as authenticated with basic info
      setUser({
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.user_metadata?.full_name ?? '',
        role: 'user',
        account_type: 'passenger',
        onboarding_completed: false,
      });
      setIsAuthenticated(true);
      setAuthError(null);
      // Same fire-and-forget native push registration as the success
      // path above. We attempt it even when the profile fetch failed —
      // the device should still receive push notifications regardless
      // of whether the profile RPC was reachable.
      registerNativePush();
    }
  };

  /**
   * Re-fetch the current user's profile from DB.
   * Use after updates to keep the AuthContext state in sync (e.g., after onboarding,
   * profile update, role change). Doesn't toggle isLoadingAuth — non-blocking.
   */
  const refreshUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await loadUserProfile(session.user);
      }
    } catch (err) {
      captureException(err, { msg: 'refreshUser failed:' });
    }
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);

      // Step 1: Read session from localStorage instantly (no network)
      const stored = readSessionFromStorage();

      if (stored?.user) {
        // CRITICAL: set isAuthenticated immediately with basic info from session.
        // This way, even if the profile fetch (loadUserProfile) is slow or hangs,
        // the user can still navigate. The profile data fills in shortly after.
        const basicUser = {
          id: stored.user.id,
          email: stored.user.email,
          full_name: stored.user.user_metadata?.full_name ?? stored.user.email?.split("@")[0] ?? "",
          role: "user",
          account_type: "passenger",
          onboarding_completed: true,  // assume true to avoid bouncing to onboarding while profile loads
        };
        setUser(basicUser);
        setIsAuthenticated(true);

        // Also seed React Query cache so any useQuery(["me"]) gets instant data instead of hanging
        try {
          queryClientInstance.setQueryData(["me"], basicUser);
        } catch {}

        // Now load full profile in the background (will overwrite the basic info)
        loadUserProfile(stored.user).catch(() => {});

        // And trigger Supabase to verify/refresh token (non-blocking)
        supabase.auth.getSession().catch(() => {});
      } else {
        // No local session — try network with timeout
        try {
          const { data: { session } } = await Promise.race([
            supabase.auth.getSession(),
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
          ]);
          if (session?.user) {
            await loadUserProfile(session.user);
          } else {
            setIsAuthenticated(false);
            setUser(null);
            setAuthError({ type: 'auth_required', message: 'Authentication required' });
          }
        } catch {
          setIsAuthenticated(false);
          setUser(null);
          setAuthError({ type: 'auth_required', message: 'Authentication required' });
        }
      }
    } catch (error) {
      captureException(error, { msg: 'Auth check failed:' });
      setIsAuthenticated(false);
      setAuthError({ type: 'unknown', message: error.message });
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  /**
   * Sign in with email + password.
   * Called from the Login page.
   */
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    // Log attempt (best-effort, non-blocking)
    supabase.from('login_attempts').insert({
      email,
      success: !error,
    }).then(() => {}, () => {});
    
    if (error) {
      // User-friendly Arabic errors
      if (error.message?.includes('Invalid')) {
        throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
      }
      if (error.message?.includes('Email not confirmed')) {
        throw new Error('يجب تأكيد البريد الإلكتروني أولاً. تحقق من بريدك');
      }
      if (error.message?.includes('rate limit')) {
        throw new Error('محاولات كثيرة جداً. حاول مرة أخرى بعد دقائق');
      }
      throw error;
    }
    
    // Immediately load profile so isAuthenticated=true before Login.jsx calls navigate()
    if (data.user) {
      await loadUserProfile(data.user);
    }
    return data;
  };

  /**
   * Sign up a new user.
   * Called from the Login page.
   *
   * IMPORTANT: emailRedirectTo. The confirmation email Supabase sends
   * contains a link that, when clicked, calls Supabase's verify endpoint
   * and THEN redirects the user. Without an emailRedirectTo, the redirect
   * falls back to whatever's configured in the Supabase dashboard's
   * "Site URL" — which can be wrong, missing, or a stale preview URL.
   *
   * Setting it here pins the redirect to wherever the user actually
   * signed up from. window.location.origin gives us the correct host
   * for production, preview deploys, and localhost development without
   * any environment-specific config.
   */
  const register = async (email, password, fullNameOrOptions, maybeOptions) => {
    // Backwards-compatible signature.
    //   Old:  register(email, password, fullName)
    //   New:  register(email, password, fullName, { dob, terms_version, terms_accepted_at })
    //
    // The login form has been updated to pass the new options object with
    // age + consent metadata; any other caller (e.g. an admin "create
    // test user" flow or a script) can still pass just the name and the
    // handle_new_user trigger will fill profiles.date_of_birth = NULL.
    // The CHECK constraint on profiles.date_of_birth allows NULL, so old
    // callers don't break — but the user won't be able to do anything
    // age-gated until they fill DOB via the account settings page.
    const fullName = typeof fullNameOrOptions === "string"
      ? fullNameOrOptions
      : fullNameOrOptions?.full_name;
    const opts = (typeof fullNameOrOptions === "object" && fullNameOrOptions !== null)
      ? fullNameOrOptions
      : (maybeOptions || {});

    const meta = { full_name: fullName };
    if (opts.dob) meta.date_of_birth = opts.dob;
    if (opts.terms_version) meta.terms_version = opts.terms_version;
    if (opts.terms_accepted_at) meta.terms_accepted_at = opts.terms_accepted_at;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: meta,
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) throw error;
    return data;
  };

  /**
   * Resend the email confirmation link to a user who didn't receive it
   * the first time. Most common cause of "I can't log in" reports —
   * the original email went to spam, was throttled by Supabase, or the
   * user mistyped their address. Supabase's resend has its own rate
   * limit (1/min by default) so the UI should disable the button briefly.
   */
  const resendConfirmation = async (email) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) throw error;
  };

  const logout = async (shouldRedirect = true) => {
    // Delete this device's push token BEFORE signOut, so auth.email()
    // still resolves to the current user inside the delete RPC. If we
    // signed out first the JWT would be gone and the RPC would 401.
    // Errors are captured to Sentry inside unregisterNativePush and
    // swallowed here — a failed token cleanup must not block logout.
    try { await unregisterNativePush(); } catch {}
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    setAuthChecked(false);
    if (shouldRedirect) {
      window.location.href = '/login';
    }
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      login,
      register,
      resendConfirmation,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth, // alias for compat
      refreshUser,
      // Recovery-flow flag + clear helper. Login.jsx reads these to
      // (1) suppress the auto-redirect-when-authenticated and (2) show
      // the dedicated "set new password" UI instead of the login form.
      isPasswordRecovery,
      exitPasswordRecovery: () => setIsPasswordRecovery(false),
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
